import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/react-vite", options: {} },
  // The overlay builds its solver worker with `new Worker(new URL(...))` inside
  // the built `@react-anatomy/core`. Pre-bundling the package with esbuild would
  // flatten that URL and the worker would never resolve, so both workspace
  // packages are kept out of dep optimisation: Vite then serves their ESM
  // as-is and its worker plugin sees the `new URL` pattern across the boundary.
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    optimizeDeps: {
      ...viteConfig.optimizeDeps,
      exclude: [
        ...(viteConfig.optimizeDeps?.exclude ?? []),
        "@react-anatomy/core",
        "@react-anatomy/storybook",
      ],
    },
  }),
};

export default config;
