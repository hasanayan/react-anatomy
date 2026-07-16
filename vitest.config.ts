import { defineConfig } from "vitest/config";

// The two moved test files: the placement engine (pure, but happy in any
// environment) and the region collector (needs a DOM to build a `data-slot`
// tree). jsdom covers both, and lays nothing out — which is exactly why the
// engine tests hand-build their rects.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
  },
});
