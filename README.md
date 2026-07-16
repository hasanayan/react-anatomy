<p align="center">
  <img src="assets/logo.png" alt="react-anatomy — beautifully annotate component slots with no effort" width="640" />
</p>

A deterministic overlay that labels the anatomy of a component — every part
marked with a `data-slot` attribute gets a callout in a gutter outside the
frame, reached by a leader that provably never crosses another. Built for
anatomy documentation.

## Packages

- **[`@react-anatomy/core`](packages/core)** — the placement engine and the
  `SlotAnnotations` React overlay. Storybook-agnostic; peer-depends on React.
- **[`@react-anatomy/storybook`](packages/storybook)** — a Storybook addon that
  overlays the annotations from a `slotAnnotations` story parameter.
- **`playground`** (private) — a Storybook host that consumes the two packages
  through their public API and demonstrates the overlay over a small hand-rolled
  card.

## Working in the repo

```sh
pnpm install
pnpm build      # tsc --build over core + storybook
pnpm test       # the placement + collection suites (vitest)
pnpm lint       # eslint (--max-warnings=0) + prettier + knip + depcheck
pnpm storybook  # the playground, consuming the built packages
```

The placement algorithm and its guarantees are specified in
[`packages/core/docs/anatomy-labelling-spec.md`](packages/core/docs/anatomy-labelling-spec.md).

Requires Node 24 and pnpm 11.8.0 (provisioned via `devEngines`).

MIT licensed.
