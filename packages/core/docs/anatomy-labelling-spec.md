# Anatomy labeling — implementation spec

Deterministic placement of callout labels around a component, for Storybook anatomy docs.

Zones are rects, they nest. Each zone gets one label outside the frame, connected by a leader line. Output must be a pure function of geometry — identical bytes in CI and locally, forever.

**Scale:** 6–12 zones. Not a general graph layout problem. Do not reach for one.

---

## 1. Definitions

| Term        | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| **Zone**    | A rect inside the component. Zones nest. Has a `depth` (nesting level).  |
| **Frame**   | The component's bounding box.                                            |
| **Gutter**  | Strip outside the frame, one per side, holding that side's labels.       |
| **Rail**    | The frame edge on one side. Every leader on that side passes through it. |
| **Anchor**  | A point on a zone's edge. Slides along a segment.                        |
| **Segment** | A candidate span of edge the anchor may occupy.                          |
| **Leader**  | `anchor → stub → fan → label`.                                           |
| **Stub**    | Perpendicular to the rail. From anchor to rail.                          |
| **Fan**     | Rail to label edge. Straight.                                            |
| **σ**       | An assignment: `zone → (side, segment)`.                                 |
| `X₀`        | Rail coordinate. Where stubs end and fans begin.                         |
| `X₁`        | Label edge coordinate. Where fans end.                                   |

Axis note: left/right rails stack labels by **height**; top/bottom rails stack by **width**. Same algorithm, different extent. Read "y" below as "position along the rail axis."

---

## 2. Hard rules

Never violated. If they can't all hold, throw.

1. Anchors sit on zone edges. Never interiors.
2. Deeper zones own shared spans. A shallower zone cannot anchor on a span a deeper zone covers on the same line.
3. Inset spans by corner radius + stub cap. Drop spans shorter than `minRun`.
4. Labels never overlap. This is a constraint, not a cost.
5. Labels stay inside the gutter.
6. Per side, label order = anchor order. Never reordered.
7. Realized anchors must be monotone after clamping (staircase check). Else reject the assignment.
8. All fans on a side span one x-interval: `[X₁, X₀]`.
9. Zero candidates for a zone → throw. Name the zone.
10. Zero surviving assignments → throw. Name the layout.
11. ~~Corners belong to left/right. Top/bottom rails shrink to inner width.~~ **Withdrawn.** Top/bottom rails span the reserved canvas: `[frameLeft − padding.left, frameRight + padding.right]`. End labels may overhang the frame and sit over a corner.

Explicitly **not** hard:

- Same-depth shared spans → allowed, preference tier 1.
- Leader crossings → allowed, preference tier 2.

### Why rule 11 was withdrawn

It was defending against a collision the gutter geometry already prevents, and it was not defending for free.

The two label families are **vertically disjoint by construction**, whatever they do horizontally:

- A top label sits at `y ∈ [frameTop − sideGap − labelHeight, frameTop − sideGap]`; a bottom label at `y ∈ [frameBottom + sideGap, frameBottom + sideGap + labelHeight]`.
- A left or right label is clamped **within the frame's own vertical extent**: `lo = frameTop`, and `hi = frameBottom − extents.at(-1) − offsets.at(-1)`. Since GPAV returns a non-decreasing chain and `offsets[i+1] = offsets[i] + extents[i] + gap`, every label on the side satisfies `position[i] + extent[i] ≤ position.at(-1) + extent.at(-1) ≤ frameBottom`.

So a top label's lowest edge is `frameTop − sideGap` and a side label's highest edge is `frameTop`. They are separated by a clear `sideGap` band and **cannot touch**, corner or no corner. Rule 11 bought nothing.

What it cost: forbidding the overhang collapses the z-space `hi`, and because the labels on a side form a non-overlap chain the clamp **cascades** — the end label is pushed inwards, which pushes its neighbour, and so on down the rail. Every label on the side skews inwards, not just the one that wanted to overhang.

**Rule 4 still binds and is now the only thing standing between labels at a corner.** It is a constraint, not a cost, and it is checked across sides. Assert it that way.

The rail stops at the reservation and not a pixel further: `reservePadding` is what the component has already painted into, so a label past it is a label clipped off the diagram. The bound is comfortable — `padding.left = sideGap + maxLabelWidth`, while a top label overhangs by at most `maxLabelWidth / 2` (worst case: centred on a zero-width zone at the frame's edge) — but the rail is clamped to the reservation regardless, so the invariant does not rest on that arithmetic.

**Relaxing rule 11 is necessary but not sufficient.** It changes nothing on its own at `alpha ≤ 0.8`: at those values `M = α·segCentre + (1−α)·evenY` never asks for the overhang in the first place, so the old rail never bound. Measured on all three card stories, the placement is byte-identical with and without the rule up to `alpha = 0.8`, and only diverges above it. The rule is what makes a high `alpha` _possible_; `alpha` is what makes labels point at their zones.

---

## 3. Preferences

Lexicographic. Earlier tiers dominate absolutely — no weight makes tier 5 outrank tier 2.

```
cost(σ) = [ ambiguousAnchors,     // tier 1
            nonAncestorCrossings, // tier 2
            crossSideStubCross,   // tier 3
            sidesUsed,            // tier 4
            aesthetics,           // tier 5 — weighted sum
            lexKey ]              // tier 6 — total order
```

1. **Ambiguous anchors** — anchor on a span shared with a same-depth zone. Fewest. _A crossing costs the reader a moment; an ambiguous anchor gives them the wrong answer with no tell._
2. **Non-ancestor leader crossings.** Fewest. **Ancestor crossings are free** — a child's stub must cross its parents' borders to escape. That's correct, not a defect.
3. **Cross-side stub crossings.** Fewest.
4. **Sides used.** Fewest. Two beats four, even at the cost of longer leaders.
5. **Aesthetics** — weighted sum, only compares within ties above:
   - GPAV residual (distortion from ideal position)
   - leader length²
   - side imbalance
6. **`lexKey`** — total order on σ. Breaks all remaining ties identically everywhere.

---

## 4. Pipeline

### 4.1 Candidate segments

Per (zone, side):

```ts
const EPS = 0.5;
const line = (z: Zone, s: Side) => `${s}@${Math.round(coord(z, s) / EPS)}`;

function candidates(z: Zone, side: Side, all: Zone[]) {
  const mine = edgeSpan(z, side);
  const sameLine = all.filter(
    (o) => o.id !== z.id && line(o, side) === line(z, side),
  );

  const occluders = sameLine.filter((o) => depth(o) > depth(z)); // hard: they own it
  const peers = sameLine.filter((o) => depth(o) === depth(z)); // soft: ambiguous

  const free = subtractSpans(
    mine,
    occluders.map((o) => edgeSpan(o, side)),
  );
  const amb = intersectSpans(
    free,
    peers.map((o) => edgeSpan(o, side)),
  );

  return [
    ...subtractSpans(free, amb).map((s) => ({ span: s, ambiguous: false })),
    ...amb.map((s) => ({ span: s, ambiguous: true })),
  ]
    .map((c) => ({ ...c, span: inset(c.span, radius + cap) }))
    .filter((c) => length(c.span) >= minRun);
}
```

1-D interval subtraction. Not polygon clipping — two zones can differ in area and still share one line. Group by `(side, coordinate)` within epsilon.

Shallower zones on my line subtract nothing. I'm drawn over them.

If `candidates(z, side)` is empty for all four sides → **hard rule 9**, throw with the zone id.

### 4.2 Per-side solve — GPAV

Given σ, group by side, sort by target along the rail with tie-break `(coord, x, id)`. That order is now frozen.

Loss per zone is a **dead-zone quadratic**:

```
fᵢ(yᵢ) = dist²(yᵢ, Iᵢ) + λ·(yᵢ − Mᵢ)²
```

Zero inside the segment — a flat leader is free. Convex, so PAVA generalizes: the pool step needs the minimizer of `Σ fᵢ(z)` instead of a mean. Piecewise-linear derivative, exact root, no iteration.

`λ` is **not** epsilon. A pure dead-zone loss is flat inside the interval → non-unique optimum → snapshot flake. `λ ≈ 0.05·w` makes it strictly convex _and_ is the design knob for how slack gets spent.

**`Iᵢ` is measured from the label's centre, and stays that way — don't "fix" this.** §4.5's attachment slides, so a leader is straight whenever the label's span merely _overlaps_ `Iᵢ`, and the dead zone looks like it should widen to `[I.lo − w + attachInset, I.hi − attachInset]` in position coordinates to match. It was implemented and reverted. λ dominates this term at the shipped weights, so a position is essentially λ's optimum and the dead zone rarely binds at all. Measured on all three card stories at `alpha: 1`, widening moved **twelve numbers by at most 0.6px** and **straightened nothing** the sliding attachment had not already straightened — 11/11 leaders straight either way. Below `alpha: 1` it was measurably _worse_ (mean |angle| 6.3° vs 5.3° at `alpha: 0.7` on `AnatomyAllLevels`), because the extra slack let labels drift further before the loss engaged. It also forced a special case: a pinned `y` must keep a point dead zone, or the pin stops meaning what it says. The sliding attachment is a **rendering** change and delivers its entire benefit there.

```
Mᵢ = α·segCenterᵢ + (1−α)·evenYᵢ
```

`α` trades "points at its zone" against "evenly spaced." One scalar, monotone. The only knob story authors should ever see — and even then, prefer per-zone overrides.

Shift to z-space with `cᵢ = Σⱼ<ᵢ(hⱼ + gap)`; constraints collapse to `z₁ ≤ z₂ ≤ …`. Gutter box is **common** in z-space, so clamping the GPAV result is exactly optimal. No re-solve.

`top`/`bottom` below are the rail's ends, and they are **not the same for the two axes** — see rule 11, withdrawn. Left and right rails run `[frameTop, frameBottom]`, the frame's own extent. Top and bottom rails run `[frameLeft − padding.left, frameRight + padding.right]`, the reserved canvas, so an end label can overhang the frame into a corner. The asymmetry is what keeps the two families vertically disjoint, and it is load-bearing: widening the vertical rails the same way would put a left label alongside a top one.

The prune that applies hard rule 5 early during the search reads the same rail extents. A tighter figure there would discard assignments that in fact fit.

```ts
const lo = top;
const hi = bottom - heights.at(-1)! - c.at(-1)!;
if (Σh + (n − 1) * gap > gutterHeight) return null; // hard rule 5 — reject
const y = gpav(segs, w, lam).map((z, i) => clamp(z, lo, hi) + c[i]);
const a = y.map((yi, i) => clamp(yi, I[i])); // realized anchor
```

Gutter overflow **rejects, it does not throw**. During the search this is one composition among many — eleven labels never fit one gutter, so a throw kills the enumeration on its first probe. Rule 10 still throws if nothing anywhere survives.

### 4.3 Staircase check (hard rule 7)

`aᵢ = clamp(yᵢ, Iᵢ)` is monotone in `y`, but intervals differ per i, so `a` can flip order:

> `I_child = [100,150]`, `I_parent = [0,300]`. Child pushed to `y=20` → `a=100`. Parent at `y=60` → `a=60`. Rail order: parent(60) < child(100). Label order: child(20) < parent(60). **Flip → fans cross.**

Sufficient condition: intervals form a staircase (`lo` and `hi` both nondecreasing — no interval strictly contains another). Containment arises when a child isn't flush with its parent's edge. Real case in nested cards.

**Handling:** after solving, assert `a` nondecreasing. If not, cost = `Infinity`, reject, let the enumerator find another. Do **not** repair. A child whose label must clamp past its parent's extent genuinely belongs elsewhere; rejecting yields a better diagram.

### 4.4 Search

Enumerate. **No branch-and-bound** — under this tier order a bound cannot work, which is not obvious and cost a prototype to establish:

> `sidesUsed` sits at tier 4, above the only tier a cheap bound can speak to. Any prefix that has not yet touched every side bounds tier 4 _below_ the incumbent's, so the vector compares less whatever tier 5 says, and the node survives. A bound on tier 5 is dead weight; the bound only ever fires via tier 1. Measured on the 11-zone story: 8% of nodes pruned, 117 s. Adding an admissible tier-5 bound made it _worse_ — tier 4 shields tier 5 from ever being consulted.

Three things do work, and together they are ~80× on that story:

1. **Separability.** A leader is fully determined by its own side's composition, so tiers 1 and 2 and the length term are all computable per side and cached with that side's GPAV solve. Only cross-side stub crossings need two sides — and they cache on the _pair_ of groups. Do not recompute either at a leaf; that double loop otherwise dominates the run.
2. **Bitmask groups.** Identify a side-group by the bitmask of the zones on it. Every cache key is then an integer, and a leaf is a handful of lookups plus arithmetic. Compare tiers on locals and allocate nothing until a leaf actually wins — almost none do.
3. **Ascending side-subsets, with a provable early exit.** Enumerate assignments restricted to each subset of sides, smallest subsets first. Tiers 1–3 are counts, so they bottom out at zero: once a subset of size _k_ yields an assignment scoring 0/0/0, nothing larger can win — a bigger subset costs strictly more at tier 4 and cannot improve on zero above it. So the first _k_ to reach 0/0/0 is **provably optimal** and the rest goes unvisited.

The early exit is what makes the common case free: a clean stack settles at k=1 in four leaves. It does **not** fire when the layout forces a crossing (tier 2 > 0), and then the search is exhaustive — ~1.4 s for 11 zones. That is the accepted worst case: this is a dev-time doc tool, and the result is memoized.

Searching every subset of size _k_ covers every assignment using ≤ _k_ distinct sides, so the ascending loop re-treads ground when it fails to exit early. It costs ~17% over searching all four sides directly, and saves ~99.99% when it succeeds.

Hard rule 5 also prunes _during_ the descent: a side's stack only grows, so once it overflows its gutter no completion of that prefix can recover.

Left stub of _i_ and top stub of _j_ intersect iff `xⱼ < xᵢ ∧ yᵢ < yⱼ`.

### 4.5 Routing

- Stub: `(aᵢ.x, aᵢ.y) → (X₀, aᵢ.y)`. Perpendicular to rail.
- Fan: `(X₀, aᵢ.y) → (X₁, tᵢ)`. Straight.

**The attachment `tᵢ` slides along the label's gutter-facing edge.** It is not the label's midpoint:

```
tᵢ = clamp(aᵢ.y, Lᵢ.y + attachInset, Lᵢ.y + Lᵢ.h − attachInset)
```

A midpoint-pinned attachment is straight only when the label's _centre_ lands inside the zone's edge span — a single point. Sliding makes it straight whenever the label's _span overlaps_ the span, a window most of a label wide. `attachInset` (~4, the chip's corner radius plus a pixel) keeps the leader off the rounded corners, where it reads as a mistake rather than a connection. When the anchor is out of reach the clamp returns the nearest reachable point, which is the shallowest angle available. Degenerate case: a label thinner than `2 · attachInset` has no window and collapses to the midpoint — that is the _narrow_ label, not the wide one; a label wider than its zone's edge is the safe case.

Why this is still crossing-free: all fans span the same x-interval, so they're graphs of functions over a common domain. Sliding moves `tᵢ` along **y**, so `X₁` is still a single x per side (labels stay gutter-aligned, below) and the domain stays common. Order survives because each attachment is clamped **within its own label's edge**, and labels are disjoint and ordered (rules 4 + 6): for `i < j`, `tᵢ ≤ Lᵢ.bottom − attachInset ≤ Lⱼ.top + attachInset ≤ tⱼ`. So endpoints stay monotone and order at the rail = order at the labels → no flip → no crossing. Stubs are parallel at distinct y and confined to `x > X₀`, so they can't cross each other or the fans.

Right-align left-gutter labels, left-align right-gutter labels. Every fan on a side then starts at one x.

---

## 5. API

```ts
interface Zone {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  depth: number; // nesting level *within the set being placed* — see §10
  parentId?: string; // for ancestor-crossing detection
}

interface Overrides {
  [zoneId: string]: {
    side?: Side; // collapse candidates to one side
    y?: number; // pin position
    hidden?: boolean; // don't label this zone geometrically
  };
}

interface Constants {
  gap: number; // min space between labels
  minRun: number; // min viable segment length, ~8
  stubCap: number; // how far a stub stays clear of a corner, ~2
  depthInset: number; // border pull-in per nesting level, ~1 — see §9
  sideGap: number; // frame to near edge of the labels
  attachInset: number; // how far a sliding attachment stays off the chip's corners, ~4 — see §4.5
  alpha: number; // 0 = evenly spaced, 1 = anchor-aligned
  lambda: number; // ~0.05 * w
  weights: { residual: number; length: number; imbalance: number };
}

function layout(
  zones: Zone[],
  labelSizes: Record<string, { w: number; h: number }>,
  frame: Rect,
  constants: Constants,
  overrides?: Overrides,
): { labels: Placed[]; leaders: Path[] };
```

**The inset is derived, not configured.** It is `max(the two corners bounding this edge) + stubCap`, taken **per zone, per edge**. A single `inset` constant standing for "radius + cap" assumes every zone is rounded: a 24px square icon loses its whole edge to it and hard rule 9 fires on a zone that has a perfectly good edge. Read the corner longhands (`border-top-left-radius`, …), not the `borderRadius` shorthand — the shorthand collapses to forms like `8px 8px 0 0`, and an elliptical corner reads as `8px 4px`, of which only the first figure bounds the edge.

Constants live in the design system, as one exported object. **Not per-story.** Anatomy docs must look identical across the system — that's the entire point of them.

The escape hatch is `overrides`, not an algorithm picker. A pinned number in a story file is reviewable in a PR and obvious when it drifts. A solver choice is neither.

---

## 6. Determinism

Non-negotiable. This renders into visual regression snapshots.

- Stable total tie-break on every sort: `(coord, x, id)`.
- No RNG. No convergence loops. No rAF. No `Date`.
- Round coordinates only at the end.
- Layout is a pure function of: zone rects + measured label sizes + constants.
- Measure label sizes once (hidden pass or `ResizeObserver`), feed into a `useMemo` keyed on geometry + sizes. Pure from there.
- `lexLess` on σ is load-bearing: equal-cost assignments are common with symmetric layouts. Without a total order you get CI flake.

**The solve runs in a worker, and this costs determinism nothing.** It is the same pure function over the same inputs, all of which are posted with the request — zones, label sizes, constants, overrides. What changes is only _where_ it runs, and the search is a second of arithmetic that would otherwise freeze the page for a second: deferring it behind a paint made the component visible sooner but never interactive sooner, because deferring a blocking call only moves the block.

Two consequences the boundary forces, both worth having:

- **The boundary sits at `Zone`, not `Region`.** A `Region` carries its `el`, and an `HTMLElement` cannot be structured-cloned — posting one throws. So the solve's inputs and outputs are pure data (`placeZones` → `PlacementData`, keyed by zone id and index) and the region handles are re-attached on the main thread. This is a good seam regardless: it is exactly the line past which the DOM stops being relevant.
- **The throws must be posted, not thrown.** Hard rules 9 and 10 are meant to reach the reader, and an exception inside a worker reaches nobody — it surfaces as a bare `error` event, stripped of its message, or vanishes. Failures come back as `{ ok: false, message, stack }` and are re-thrown on the main thread, so the story still dies loudly with the message this spec asks for. Swallowing them would quietly delete the design property.

Because the solve is now asynchronous, a re-measure can land while one is in flight. Requests carry a monotonic id and only the newest reply is painted; anything older describes geometry that no longer exists.

---

## 7. Dependencies

**None for layout.** GPAV is ~40 lines; interval subtraction ~15.

No dagre / elkjs / cytoscape / d3-force. They answer "where do the nodes go?" — already known. Anchors are fixed by geometry; the only free variable is position along one rail. You'd fight the library to not do its main job. Force sims also converge to _a_ local optimum, differing across machines → snapshot flake.

No polylabel, no polygon-clipping. Area subtraction answers a question this problem doesn't have.

No worker library either. The worker is one `new Worker(new URL("./place-labels.worker.ts", import.meta.url), { type: "module" })`, which Vite bundles natively, and a message handler either side. A pool, a comlink-style RPC wrapper or a scheduler would all be answering a question one overlay with one solve doesn't have.

**webcola (VPSC)** only if constraints stop being a chain — e.g. making `aᵢ` a free variable with its own chain plus per-element boxes (two coupled chains; clamp-after-GPAV stops being optimal because that trick needs a _common_ box), or labels on two sides sharing one gutter. Not before.

---

## 8. Tests

- **GPAV vs brute force.** Random targets/heights, n ≤ 6, compare against a QP or dense grid search. Assert optimality, not just feasibility.
- **GPAV degenerates to PAVA** when all segments are points.
- **Idempotence.** `layout(x) === layout(x)`, deep-equal, 1000×.
- **Order preservation.** Labels and realized anchors both nondecreasing per side.
- **Crossing-free.** Brute-force all fan pairs, assert no intersection.
- **Staircase rejection.** Construct the containment counterexample above; assert it's rejected, not repaired.
- **Ambiguity tiering.** Two same-depth coincident zones → assert the ambiguous-anchor count is minimized before any aesthetic term.
- **Depth ownership.** Child flush with parent's edge → child keeps the span, parent loses it.
- **Conditional inset (§9).** A nested zone with clearance is drawn on its element exactly; a flush child moves the _container_ and not itself; a shared line with disjoint stretches moves nothing; a chain of flush containers separates in one pass; same-depth zones never move for each other.
- **§9 is still mandatory.** `depthInset: 0` on the title level → rule 9 throws, naming `title`.
- **View rebasing.** A level three deep places identically to the same shapes at the root — depth and `parentId` are the view's, not the tree's (§10).
- **Reservation over the tree.** A subset solved with the whole tree's label sizes stays inside the padding reserved for the tree. Navigating must not move the component.
- **Throw 9a.** Zero-padding wrapper → throws, message names the zone.
- **Throw 9b.** Unsatisfiable staircase → throws, message suggests overrides.
- **Snapshot.** Render each anatomy story; byte-compare across a Docker run and a local run.

---

## 9. Depth inset — mandatory, but conditional

Coincident edges are a _rendering_ problem before they're a layout problem: if a child's border sits exactly on its parent's, the parent's border is invisible and no label can honestly name it.

The inset is **not** optional polish. Without any of it the card is literally unlabellable: `Card.Heading.Title` has `Text` and `Subtitle` flush on all four of its lines, they own every one of them by rule 2, §4.1 subtracts the lot, and **hard rule 9 throws on `title`**. It fired routinely, not rarely, and it fires again the moment `depthInset` is set to 0 — there is a test that asserts exactly that, because a conditional inset invites the reading that it is removable.

**But it applies only where edges actually collide.** It used to be unconditional — `(depth − 1) · depthInset` off every nested zone, whether or not anything was in its way — which distorted a whole tree to settle a conflict a handful of zones have. On `AnatomyAllLevels` that displaced 7 of 11 zones, up to 3px, to fix a collision affecting 3.

The rule:

> A zone steps **outward** on a side by one `depthInset` for each **distinct depth below it** drawing on **the same stretch of the same line**.

Three things that says, each load-bearing:

- **Outward, and it is the container that moves.** The inner zone has the content in it and is the one the reader is looking at, so it keeps its element's geometry to the pixel and draws on top; the container gives way, and its border lands just outside the child it encloses — which is what a container does anyway. The old scheme moved the child, which is the one thing on screen with something to be wrong about.
- **The stretches must overlap, not merely the line.** `body`'s left edge sits on the same x as `button-primary`'s, three slots and hundreds of pixels apart: one line, never one pixel. Nothing is hidden, so nothing moves. This agrees with rule 2, which subtracts _spans_ and so takes nothing off `body` either. Requiring only a shared line displaces `body` and `icon` for collisions that do not exist — measured, and it is why the test for it is there.
- **Per distinct depth below.** In a chain of flush containers the ranks come out 2, 1, 0 and one pass separates the lot. **The cascade needs no second pass** as long as spans nest along a containment chain — which is what containment means. Depth alone decides rank, with no ancestry test, exactly as §4.1's occluder rule does.

Rule 2's semantics are unchanged, and it stays exactly as written. What changes is only how often it is reachable — as before, the nudge means different-depth coincident edges have already stopped existing by the time candidates are computed.

**Computed once, from true geometry, and applied once.** Not iterated to a fixpoint: §6 forbids convergence loops and this does not need one. A nudge can only _create_ a coincidence between edges whose true separation was already under a couple of pixels — above `lineEpsilon`, so not coincident, but far too close for either border to have been distinguishable. In that regime the diagram was already lying. If a new coincidence does hide a border, rule 9 fires by name, which is the designed outcome. The old unconditional inset carried the identical hazard from the other direction, and this version moves fewer zones, less far.

**The frame grows, and nothing downstream drifts.** The solve's `frame` is the union of the zone rects, so an outward nudge can widen it by a pixel, and the top/bottom rails are defined off it. `reservePadding` is unaffected _by construction_ — it is a pure function of the label sizes and the constants, and has never seen the frame. Measured on all three stories, the frame's origin does not move at all: the union's edges are set by the outermost slots, and those have nothing deeper on their lines to give way to.

Draw the nudged rects, not the raw ones — otherwise the border a label points at is not the border on screen, which is the whole reason for doing this. Deeper zones draw **on top**, and that is set explicitly per frame rather than left to DOM order, because the click that opens a zone resolves the same way.

### What it cost

`Anatomy` and `HeadingAnatomy` are byte-identical: no zone at those levels has anything deeper on its lines, so nothing moves. The drill-down levels improve — at the `title` level, `text` and `subtitle` now sit exactly on their text and the container is the only thing displaced.

`AnatomyAllLevels` changed, and not only for the better. 8 of 11 zones are now pixel-exact where 4 were, and the 3 that move are all containers moving outward by 1–2px. But two of its eleven leaders now slope, where all eleven were straight. Nothing is broken: the search is exhaustive on that story (tier 2 > 0, so the early exit cannot fire), the answer is still the lex-min under the new geometry, and every hard rule holds. A few pixels flipped a near-tie between assignments — and **straightness is not in the cost function**. It emerges from `alpha: 1` plus the sliding attachment, so an assignment can be optimal on every modelled tier and still read worse. That is the honest trade: geometric truth on the zones, against one stress story's luck.

---

## 10. Drill-down — the view is not the tree

Unless a story pins `depth`, the overlay is navigable: it opens on the first level and dives one level per click, with breadcrumbs back. Everything above still applies unchanged — a level is just another set of zones, and `layout` never learns that anything moved.

What it costs is one distinction, and everything here follows from it. **Collection reports the whole tree; a view is a slice of it.** They used to be the same step, because the only slice was the one on screen. Drill-down needs to know what is _below_ the current level in order to offer the dive at all, so depth became a view concern:

- **Labelled set** = the active zone, as container, plus its direct children. At the root there is no container and the set is the outermost slots.
- **Dimmed set** = the active zone's _siblings_: the level just left, drawn as frames, unlabelled, never fed to the solve. Not the whole remaining tree — that is a thicket of dashed rectangles, not a diagram.
- **Depth is rebased onto the view.** The container is at depth 1 whatever it was in the tree. Every consumer of `depth` is asking a question about the drawn set: rule 2's ownership is decided among zones on screen, and §9's inset pulls each level in relative to the one containing it. Tree depths would give a level four deep an inset it did not earn.
- **`parentId` survives only if the parent is in the view.** A tier-2 ancestor exemption for a zone nobody drew excuses a crossing the reader can see.

### The reservation is over the tree, not the level

`reservePadding` runs on **every label the overlay could ever show**, not the level on screen. A navigable overlay that reserved only the current level's gutters would move the component under the reader the first time they dived into a slot with a longer name than any at the root — reintroducing, by another route, exactly the shift the two-wrapper split exists to prevent. §4.2's rails derive from the same sizes, so the solve keeps agreeing with the padding. A static overlay is the degenerate case: view = tree, and the numbers are unchanged.

### One solve per navigation

Every dive re-solves over a fresh zone set, and this is cheap for the reason §4.4 gives: a level is a handful of zones and the ascending side-subset exit fires on almost all of them. The monotonic request id from §6 already covers it — a navigation is a re-measure by another name, and a reader clicking through three levels faster than the search can answer paints the third and discards the first two. The overlay also draws nothing while a solve is in flight rather than showing the previous level's frames against the new level's dimming, which would be a diagram describing no state that exists.

### The boundary is decorative

`boundary` outlines the component's own bounding box, and it earns its keep at the root, where the labelled slots are the one level with nothing drawn around them. It is **not a zone**: never placed, never labelled, never counted at tier 2, and not the solve's `frame` — which is the zones' bounding box, and at the root happens to be the same rect. Unifying them would buy identical numbers and cost the solve its independence from what the overlay chooses to draw. It is held a few pixels out for §9's reason: an outline sitting exactly on a flush slot's border is an outline nobody can see.
