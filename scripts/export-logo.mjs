// Renders scripts/generate-logo.html and exports the logo to assets/logo.png.
// Run from the repo root: pnpm logo
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
// playwright is a dependency of the playground package, so resolve it from there
const { chromium } = createRequire(
  path.join(repoRoot, "packages", "playground", "package.json"),
)("playwright");
const outFile = path.join(repoRoot, "assets", "logo.png");

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(
  "file://" + path.join(repoRoot, "scripts", "generate-logo.html"),
);

await page.waitForSelector("body[data-ready]");
const svg = page.locator("#preview svg");
// strip preview-only chrome so the export is just the logo, with transparent corners
await page.addStyleTag({
  content:
    "body { background: transparent; } #preview svg { box-shadow: none; border-radius: 0; }",
});
await svg.screenshot({ path: outFile, omitBackground: true });

await browser.close();
console.log(`wrote ${outFile}`);
