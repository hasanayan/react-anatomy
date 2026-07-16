import type { KnipConfig } from "knip";

const config: KnipConfig = {
  rules: {
    types: "off",
  },
  ignoreBinaries: ["stage"],
  workspaces: {
    "packages/core": {
      entry: ["src/solve/place-labels.worker.ts", "src/**/*.test.{ts,tsx}"],
      project: "src/**",
    },
    "packages/storybook": {
      project: "src/**",
    },
    "packages/playground": {
      entry: [".storybook/{main,preview}.ts", "src/**/*.stories.tsx"],
      project: "src/**",
      ignoreDependencies: ["@react-anatomy/core", "playwright"],
    },
  },
};

export default config;
