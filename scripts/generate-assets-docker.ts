// Runs `pnpm assets` inside the pinned Playwright container — the same image CI
// uses. The committed PNG/GIF bytes depend on the font stack and Chromium build,
// which differ between a dev's macOS and CI's Linux; regenerating here is the
// only way to reproduce exactly what the CI check will compare against. Reach
// for it whenever a story change means the assets need refreshing.
//
// Anonymous volumes shadow every node_modules (so the host's native macOS
// install is never touched by the container's Linux install) and the pnpm
// store (which pnpm forces onto the repo's volume to hardlink, so it can't be
// relocated with a flag) — leaving the host working tree untouched but for the
// regenerated assets.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

// Keep in lockstep with playwright in package.json and the container tag in
// .github/workflows/ci.yml.
const image = "mcr.microsoft.com/playwright:v1.61.1-noble";
const pnpmVersion = "11.8.0";

// Container-only paths kept off the host mount via anonymous volumes.
const isolated = [
  "/repo/node_modules",
  "/repo/packages/core/node_modules",
  "/repo/packages/storybook/node_modules",
  "/repo/packages/playground/node_modules",
  "/repo/.pnpm-store",
];

const inner = [
  "git config --global --add safe.directory /repo",
  "corepack enable",
  `corepack prepare pnpm@${pnpmVersion} --activate`,
  "pnpm install --frozen-lockfile",
  "pnpm assets",
].join(" && ");

execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "-e",
    "CI=true",
    "-v",
    `${process.cwd()}:/repo`,
    "-w",
    "/repo",
    ...isolated.flatMap((path) => ["-v", path]),
    image,
    "bash",
    "-c",
    inner,
  ],
  { stdio: "inherit" },
);

// Docker leaves the anonymous-volume mountpoints behind as empty dirs on the
// host; only `.pnpm-store` sits inside the repo, so sweep it back up.
rmSync(join(process.cwd(), ".pnpm-store"), { recursive: true, force: true });
