# @react-anatomy/core

The placement engine and the `SlotAnnotations` React overlay behind
[react-anatomy](https://github.com/). Draws a labelled anatomy diagram over any
rendered tree whose parts are marked with `data-slot` attributes — no coupling
to the components involved, and no Storybook dependency.

```tsx
import { SlotAnnotations } from "@react-anatomy/core";

<SlotAnnotations rootLabel="Card" boundary>
  <Card>{/* parts marked with data-slot */}</Card>
</SlotAnnotations>;
```

## What it does

- Discovers every `data-slot` under the wrapper from the live DOM and builds the
  containment tree.
- Places one label per zone in a gutter outside the frame, reached by a leader
  that leaves the zone perpendicular to the nearest rail. Because every fan on a
  side spans one x-interval, order is preserved and **leaders cannot cross** —
  that theorem is the whole construction. See
  [`docs/anatomy-labelling-spec.md`](docs/anatomy-labelling-spec.md).
- Solves off the main thread. The engine is a pure function of zones, label
  sizes and constants (§6), so the answer is identical wherever it runs.
- Navigates: left unpinned, the overlay opens on the outermost slots and drills
  down a level per click, with breadcrumbs back.

## Props

`children`, `scope`, `depth` (`number | "all"`), `boundary`, `rootLabel`,
`className`. Leave `depth` unset for the navigable overlay; set it for a static
diagram. `rootLabel` names the first breadcrumb — the DOM has no name for the
component, so the host supplies one.

## The worker across the package boundary

The overlay builds its solver with
`new Worker(new URL("./place-labels.worker.js", import.meta.url), { type: "module" })`.
For that URL to resolve in a consuming app, this package ships as **unbundled
ESM**: `dist/place-labels.worker.js` sits next to `dist/slot-annotations.js`,
and a Vite host resolves the sibling and runs it as a real worker. Keep the
package out of dependency pre-bundling (`optimizeDeps.exclude`) so the `new URL`
pattern survives — the playground's `.storybook/main.ts` shows the one line
needed. For a host where a worker is unavailable, inject a synchronous solver
into the overlay's `solver` prop: `createSyncSolver()` runs the same solve on
the calling thread.

Peer dependencies: `react`, `react-dom` (v19). MIT licensed.
