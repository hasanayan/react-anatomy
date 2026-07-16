# @react-anatomy/storybook

A Storybook addon that overlays
[`@react-anatomy/core`](https://www.npmjs.com/package/@react-anatomy/core)'s
anatomy labels from a story parameter.

## Setup

```ts
// .storybook/preview.ts
import { decorators } from "@react-anatomy/storybook/preview";

export default { decorators };
```

## Use

Set the `slotAnnotations` parameter on any story whose component marks its parts
with `data-slot`:

```ts
export const Anatomy = {
  parameters: { slotAnnotations: { boundary: true } },
  render: () => <Card>{/* … */}</Card>,
};
```

- `true` — annotate the outermost slots.
- `{ scope }` — annotate the slots inside the element carrying that `data-slot`.
- `{ depth }` — a number or `"all"` for a static diagram; omit for a navigable
  drill-down.
- `{ boundary }` — outline the component's own edge.

The addon derives the root breadcrumb from the story context — the `scope` when
there is one, otherwise the last segment of the story title — and passes it to
the core overlay as `rootLabel`. The core component knows the DOM but not what
the component is called; Storybook does, so the addon answers it.

Peer dependencies: `storybook`, `@storybook/react-vite` (v10), `react`. MIT
licensed.
