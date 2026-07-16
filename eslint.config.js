import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Flat config, inlined — no separate config package. The type-checked rules run
// against the workspace's own tsconfigs via the project service; config files
// that sit outside those projects have the type-aware rules switched back off so
// they still lint without a program.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/storybook-static/**",
      "**/node_modules/**",
      "scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      import: importPlugin,
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      "import/prefer-default-export": "error",
      "import/order": [
        "error",
        {
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
        },
      ],
    },
  },
  {
    // Config and test files run in Node and are not part of the emitting
    // projects, so type-aware linting is turned off for them.
    files: ["**/*.config.{ts,js}", "**/.storybook/**", "**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
