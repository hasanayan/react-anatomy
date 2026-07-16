// Regenerates the README assets from the playground stories: the three static
// diagram PNGs and the "deep dive" drill-down GIF. It builds the playground into
// a static Storybook, serves it, drives the overlay with a headless browser, and
// encodes the frames — so the images can never drift from what the addon renders.
//
// The output is byte-deterministic (see `settle`), which is what lets CI gate on
// an unchanged working tree. But those bytes depend on the font stack and browser
// build, so a local `pnpm assets` on macOS will NOT match CI's Linux bytes — use
// `pnpm assets:docker` to regenerate in the same container CI runs.
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
import type { Browser, Locator, Page } from "playwright";
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
    res.setHeader(
      "Content-Type",
      mime[extname(file)] ?? "application/octet-stream",
    );
    createReadStream(file)
      .on("error", () => res.writeHead(404).end("not found"))
      .pipe(res);
  });
}

function storyUrl(id: string): string {
  return `http://localhost:${port}/iframe.html?id=${id}&viewMode=story`;
}

// Determinism gate. The overlay solves off a worker and fades its labels in, so
// a naive timed screenshot lands on a different frame every run — fatal for a CI
// diff check. Wait for fonts, then poll the leader count until it stops changing:
// that is the solve landing. `animations: "disabled"` at capture time then jumps
// any in-flight transition to its end, so identical DOM yields identical bytes.
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const leaders = page.locator("#storybook-root svg path");
  let previous = -1;
  for (let poll = 0; poll < 50; poll++) {
    const count = await leaders.count();
    if (count > 0 && count === previous) {
      return;
    }
    previous = count;
    await page.waitForTimeout(120);
  }
}

async function shoot(target: Locator): Promise<Buffer> {
  return target.screenshot({ animations: "disabled" });
}

async function main(): Promise<void> {
  buildStorybook();
  await mkdir(assetsDir, { recursive: true });

  const server = serve();
  await new Promise<void>((r) => server.listen(port, r));
  // --no-sandbox lets Chromium run as root inside the CI container; it has no
  // effect on what gets rendered, so local and CI frames stay identical.
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  try {
    await captureStills(browser);
    await captureDeepDive(browser);
  } finally {
    await browser.close();
    server.close();
  }
  console.log("done → assets/");
}

async function captureStills(browser: Browser): Promise<void> {
  const page = await browser.newPage({ deviceScaleFactor: stillScale });
  await page.setViewportSize({ width: 900, height: 720 });
  for (const { id, file } of stills) {
    await page.goto(storyUrl(id), { waitUntil: "networkidle" });
    await settle(page);
    await writeFile(
      join(assetsDir, file),
      await shoot(page.locator("#storybook-root")),
    );
    console.log("still  →", file);
  }
  await page.close();
}

// Each drill-down level held for `holdMs`, encoded as one settled frame. There
// is no in-between animation to sample: capturing the fade would tie the frames
// to wall-clock timing and break reproducibility, so the GIF is a clean
// slideshow of the levels instead — click, land, hold, dive again.
const dive = [
  { hold: 1600 }, // outermost slots
  { hold: 1800, into: "heading" }, // into the heading row
  { hold: 1800, into: "text" }, // into the title/subtitle pair
  { hold: 2000, into: "Card" }, // breadcrumb back to the top (root == story name)
];

async function captureDeepDive(browser: Browser): Promise<void> {
  const page = await browser.newPage({ deviceScaleFactor: gifScale });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(storyUrl("components-card--anatomy"), {
    waitUntil: "networkidle",
  });
  const root = page.locator("#storybook-root");

  const frames: { buffer: Buffer; delayMs: number }[] = [];
  for (const step of dive) {
    if (step.into) {
      await page
        .getByRole("button", { name: step.into, exact: true })
        .first()
        .click();
    }
    await settle(page);
    frames.push({ buffer: await shoot(root), delayMs: step.hold });
  }

  await page.close();
  await encodeGif(frames, join(assetsDir, "deep-dive.gif"));
  console.log("gif    → deep-dive.gif", `(${frames.length} frames)`);
}

async function encodeGif(
  frames: { buffer: Buffer; delayMs: number }[],
  out: string,
): Promise<void> {
  const gif = GIFEncoder();
  let width = 0;
  let height = 0;
  for (const { buffer, delayMs } of frames) {
    const { data, width: w, height: h } = PNG.sync.read(buffer);
    // Frames can differ by a pixel as the breadcrumb text changes width; pin to
    // the first frame's size so every frame indexes the same canvas.
    width ||= w;
    height ||= h;
    const rgba = sizeTo(data, w, h, width, height);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, width, height, { palette, delay: delayMs });
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
