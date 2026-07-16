// Release-workflow guard: the pushed tag must match the version both published
// packages carry, so a stale or hand-made tag cannot publish the wrong code.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const tag = process.argv[2];

for (const dir of ["packages/core", "packages/storybook"]) {
  const { name, version } = JSON.parse(
    readFileSync(resolve(root, dir, "package.json"), "utf8"),
  ) as { name: string; version: string };
  if (`v${version}` !== tag) {
    console.error(`tag ${tag ?? "(none)"} does not match ${name}@${version}`);
    process.exit(1);
  }
}
