// Regenerates the README assets from the playground stories: the three static
// diagram PNGs and the animated "deep dive" GIF. It builds the playground into
// a static Storybook, serves it, drives the overlay with a headless browser,
// and encodes the frames — so the images can never drift from what the addon
// actually renders. Run with `pnpm assets`.
//
// GIF encoding is pure JS (gifenc + pngjs) on purpose: no ffmpeg, no native
// build step, so the script runs anywhere the repo already installs.
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import gifenc from "gifenc";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const { applyPalette, GIFEncoder, quantize } = gifenc;

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const staticDir = join(root, "packages/playground/storybook-static");
const assetsDir = join(root, "assets");
const port = 6399;
// 2x for the still PNGs (crisp on retina); 1x for the GIF to keep it small.
const stillScale = 2;
const gifScale = 1;

const stills = [
  { id: "components-card--anatomy", file: "anatomy.png" },
  { id: "components-card--anatomy-all-levels", file: "anatomy-all.png" },
  { id: "components-card--heading-anatomy", file: "heading-anatomy.png" },
];

const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function buildStorybook(): void {
  if (process.env.SKIP_BUILD) {
    console.log("SKIP_BUILD set — reusing existing storybook-static");
    return;
  }
  console.log("building static Storybook…");
  execFileSync("pnpm", ["build:storybook"], { cwd: root, stdio: "inherit" });
}

function serve(): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = join(staticDir, url === "/" ? "/index.html" : url);
    if (!file.startsWith(staticDir)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
    createReadStream(file)
      .on("error", () => res.writeHead(404).end("not found"))
      .pipe(res);
  });
}

// The overlay solves off a worker, so a fixed wait is more reliable here than
// any DOM signal: give the labels time to appear and their fade to finish.
function storyUrl(id: string): string {
  return `http://localhost:${port}/iframe.html?id=${id}&viewMode=story`;
}

async function main(): Promise<void> {
  buildStorybook();
  await mkdir(assetsDir, { recursive: true });

  const server = serve();
  await new Promise<void>((r) => server.listen(port, r));
  const browser = await chromium.launch();

  try {
    await captureStills(browser);
    await captureDeepDive(browser);
  } finally {
    await browser.close();
    server.close();
  }
  console.log("done → assets/");
}

async function captureStills(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
  const page = await browser.newPage({ deviceScaleFactor: stillScale });
  await page.setViewportSize({ width: 900, height: 720 });
  for (const { id, file } of stills) {
    await page.goto(storyUrl(id), { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.locator("#storybook-root").screenshot({ path: join(assetsDir, file) });
    console.log("still  →", file);
  }
  await page.close();
}

async function captureDeepDive(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
  const page = await browser.newPage({ deviceScaleFactor: gifScale });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(storyUrl("components-card--anatomy"), { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const root = page.locator("#storybook-root");
  const frames: Buffer[] = [];
  const frameGap = 90;
  // Hold on the current view for `ms`, sampling a frame each ~90ms so the GIF
  // captures the fade after a click, not just the endpoints.
  const hold = async (ms: number): Promise<void> => {
    for (let elapsed = 0; elapsed < ms; elapsed += frameGap) {
      frames.push(await root.screenshot());
      await page.waitForTimeout(frameGap);
    }
  };
  const dive = async (name: string): Promise<void> => {
    await page.getByRole("button", { name, exact: true }).first().click();
  };

  await hold(1100); // outermost slots
  await dive("heading");
  await hold(1400); // into the heading row
  await dive("text");
  await hold(1400); // into the title/subtitle pair
  // The addon names the root breadcrumb after the story ("Components/Card").
  await page.getByRole("button", { name: "Card", exact: true }).click();
  await hold(1500); // back to the top

  await page.close();
  await encodeGif(frames, join(assetsDir, "deep-dive.gif"));
  console.log("gif    → deep-dive.gif", `(${frames.length} frames)`);
}

async function encodeGif(pngBuffers: Buffer[], out: string): Promise<void> {
  const gif = GIFEncoder();
  let width = 0;
  let height = 0;
  for (const buffer of pngBuffers) {
    const { data, width: w, height: h } = PNG.sync.read(buffer);
    // Frames can differ by a pixel as the breadcrumb text changes width; pin to
    // the first frame's size so every frame indexes the same canvas.
    width ||= w;
    height ||= h;
    const rgba = sizeTo(data, w, h, width, height);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, width, height, { palette, delay: 90 });
  }
  gif.finish();
  await writeFile(out, gif.bytes());
}

// Crop or pad an RGBA buffer to a target size (top-left anchored), so a
// one-pixel reflow between frames doesn't throw off the encoder.
function sizeTo(
  data: Buffer,
  w: number,
  h: number,
  tw: number,
  th: number,
): Uint8Array {
  if (w === tw && h === th) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  const out = new Uint8Array(tw * th * 4).fill(255);
  const rows = Math.min(h, th);
  const cols = Math.min(w, tw);
  for (let y = 0; y < rows; y++) {
    const from = y * w * 4;
    const to = y * tw * 4;
    out.set(data.subarray(from, from + cols * 4), to);
  }
  return out;
}

await main();
