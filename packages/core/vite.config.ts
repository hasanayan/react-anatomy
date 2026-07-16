import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

// Library build. The one job Vite does here that tsc could not is inline the
// solver worker: `solve/worker-solver.ts` imports it with `?worker&inline`, so
// the worker's code lands in `index.js` as a base64 blob and no separate worker
// file ships. That removes the `new URL(...)` worker file that made every
// consuming host add `optimizeDeps.exclude`. Types are emitted separately by tsc
// (`emitDeclarationOnly`); this config owns the JS bundle only.
export default defineConfig({
  build: {
    // tsc writes the declarations into `dist` first; leave them in place.
    emptyOutDir: false,
    lib: {
      entry: resolve(fileURLToPath(new URL("./src/index.ts", import.meta.url))),
      formats: ["es"],
      // Keep the exact filename the package's exports map already points at.
      fileName: () => "index.js",
    },
    rollupOptions: {
      // react and react-dom are peers — they must resolve to the host's single
      // copy, never be bundled in.
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
  },
});
