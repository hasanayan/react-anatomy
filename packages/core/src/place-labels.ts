import type { Region } from "./collect-regions";

// Deterministic placement of anatomy callout labels around a component. See
// anatomy-labelling-spec.md — this file implements it, and the section numbers
// below refer to it.
//
// The shape of the thing: every zone gets one label in a gutter outside the
// frame, reached by a leader that leaves the zone's edge perpendicular to the
// nearest rail (the stub), meets that rail, then runs straight to the label
// (the fan). Because every fan on a side spans the same x-interval, fans are
// graphs of functions over a common domain — so preserving order at the rail
// preserves it at the labels, and crossings become impossible rather than
// merely unlikely. That theorem is the reason for the whole construction.

export type Side = "top" | "right" | "bottom" | "left";

// Sides in a fixed order. Everything downstream indexes into this, including
// the bitmasks the search runs on, so the order is load-bearing for
// determinism — not merely for readability.
const sides: Side[] = ["top", "right", "bottom", "left"];

const isVertical = (side: Side): boolean => side === "left" || side === "right";

// The search works in side indices, so it needs to get back to a `Side`.
function sideAt(index: number): Side {
  const side = sides[index];

  if (!side) {
    throw new Error(`[anatomy] side index ${index} is out of range`);
  }

  return side;
}

export const labelHeight = 20;

export interface Constants {
  // Minimum space between adjacent labels sharing a gutter.
  gap: number;
  // Shortest run of edge an anchor can usefully occupy. Segments below this are
  // dropped: a 3px sliver names nothing.
  minRun: number;
  // How far a stub stays clear of a corner. The rest of the inset is the zone's
  // own corner radius, taken per edge — see `insetFor`. The spec originally had
  // a single `inset` constant standing for "radius + cap", but that assumed
  // every zone is rounded; a 24px square icon lost its whole edge to it.
  stubCap: number;
  // How far a container's border steps outward to clear a child sitting exactly
  // on it. Applied per coinciding edge and nowhere else: a zone with clearance
  // is drawn on its element, to the pixel. Without any of it, a parent whose
  // children cover its edges has no candidate span left anywhere and hard rule 9
  // fires — see §9.
  depthInset: number;
  // Distance from the frame to the near edge of the labels.
  sideGap: number;
  // How far along its own edge a leader's attachment stays clear of the label's
  // corners. The attachment slides (§4.5), and a leader landing exactly on a
  // rounded corner reads as a mistake rather than as a connection.
  attachInset: number;
  // Trades "points at its own zone" (1) against "evenly spaced" (0).
  alpha: number;
  // Strict-convexity term. Not an epsilon: a pure dead-zone loss is flat inside
  // the segment, so the optimum would be a set rather than a point and the
  // snapshot would flake. It also decides how slack gets spent.
  lambda: number;
  weights: { residual: number; length: number; imbalance: number };
}

// One object for the whole design system, deliberately not per-story: anatomy
// docs only mean anything if they look the same everywhere. The escape hatch is
// `overrides` — a pinned number in a story file shows up in review and is
// obvious when it drifts, which a per-story solver knob is not.
export const anatomyConstants: Constants = {
  gap: 6,
  minRun: 8,
  stubCap: 2,
  depthInset: 1,
  sideGap: 28,
  // The chip's corner radius is 3, so 4 clears it by a pixel.
  attachInset: 4,
  alpha: 1,
  lambda: 3,
  weights: { residual: 1, length: 0.01, imbalance: 20 },
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

export interface Zone {
  id: string;
  rect: Rect;
  depth: number;
  // Nearest enclosing zone that is itself being labelled. Drives the ancestor
  // exemption in tier 2: a child's leader has to cross its parents to escape,
  // so those crossings are correct rather than defects.
  parentId?: string;
  // Per-edge corner radii, so the inset can be taken from the corners actually
  // bounding the edge in question.
  radii?: CornerRadii;
}

export type Overrides = Record<
  string,
  {
    side?: Side;
    y?: number;
    hidden?: boolean;
  }
>;

export interface LabelSize {
  w: number;
  h: number;
}

interface Span {
  lo: number;
  hi: number;
}

interface Candidate {
  zoneId: string;
  side: Side;
  span: Span;
  ambiguous: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Placed {
  zoneId: string;
  side: Side;
  anchor: Point;
  label: Rect;
  // The leader's route, already resolved to stub + fan.
  points: Point[];
}

// ── interval algebra (§4.1) ─────────────────────────────────────────────────
//
// One dimension, not polygons. Two zones can differ wildly in area and still
// share exactly one line; area subtraction would answer a question nobody
// asked.

const spanLength = (span: Span): number => span.hi - span.lo;

function subtractSpans(mine: Span, holes: Span[]): Span[] {
  let remaining: Span[] = [mine];

  for (const hole of holes) {
    const next: Span[] = [];

    for (const span of remaining) {
      if (hole.hi <= span.lo || hole.lo >= span.hi) {
        next.push(span);
        continue;
      }

      if (hole.lo > span.lo) {
        next.push({ lo: span.lo, hi: hole.lo });
      }

      if (hole.hi < span.hi) {
        next.push({ lo: hole.hi, hi: span.hi });
      }
    }

    remaining = next;
  }

  return remaining;
}

function intersectSpans(spans: Span[], others: Span[]): Span[] {
  const out: Span[] = [];

  for (const span of spans) {
    for (const other of others) {
      const lo = Math.max(span.lo, other.lo);
      const hi = Math.min(span.hi, other.hi);

      if (hi > lo) {
        out.push({ lo, hi });
      }
    }
  }

  return out;
}

// ── zone geometry ───────────────────────────────────────────────────────────

function edgeCoord(zone: Zone, side: Side): number {
  switch (side) {
    case "left":
      return zone.rect.x;

    case "right":
      return zone.rect.x + zone.rect.w;

    case "top":
      return zone.rect.y;

    case "bottom":
      return zone.rect.y + zone.rect.h;
  }
}

function edgeSpan(zone: Zone, side: Side): Span {
  return isVertical(side)
    ? { lo: zone.rect.y, hi: zone.rect.y + zone.rect.h }
    : { lo: zone.rect.x, hi: zone.rect.x + zone.rect.w };
}

// Zones share a line when their edge coordinates agree to within half a pixel —
// subpixel layout means exact equality is a coin toss.
const lineEpsilon = 0.5;

const lineKey = (zone: Zone, side: Side): string =>
  `${side}@${Math.round(edgeCoord(zone, side) / lineEpsilon)}`;

// How far in from each end of an edge an anchor must stay: the corners actually
// bounding this edge, plus the stub cap. Taking the radius per edge rather than
// one constant for every zone is what lets a square zone keep its full edge.
function insetFor(zone: Zone, side: Side, constants: Constants): number {
  const radii = zone.radii;

  if (!radii) {
    return constants.stubCap;
  }

  const corners =
    side === "left"
      ? [radii.topLeft, radii.bottomLeft]
      : side === "right"
        ? [radii.topRight, radii.bottomRight]
        : side === "top"
          ? [radii.topLeft, radii.topRight]
          : [radii.bottomLeft, radii.bottomRight];

  return Math.max(...corners) + constants.stubCap;
}

// ── candidates (§4.1) ───────────────────────────────────────────────────────

function candidatesFor(
  zone: Zone,
  side: Side,
  all: Zone[],
  constants: Constants,
): Candidate[] {
  const mine = edgeSpan(zone, side);
  const sameLine = all.filter(
    (other) =>
      other.id !== zone.id && lineKey(other, side) === lineKey(zone, side),
  );

  // Deeper zones own a shared span outright (hard rule 2) — they're drawn on
  // top, so an anchor there would name the wrong thing. Same-depth zones only
  // make the anchor ambiguous, which is a preference, not a prohibition.
  // Shallower zones subtract nothing: I'm drawn over them.
  const occluders = sameLine.filter((other) => other.depth > zone.depth);
  const peers = sameLine.filter((other) => other.depth === zone.depth);

  const free = subtractSpans(
    mine,
    occluders.map((other) => edgeSpan(other, side)),
  );

  const ambiguous = intersectSpans(
    free,
    peers.map((other) => edgeSpan(other, side)),
  );

  const clean = free.flatMap((span) => subtractSpans(span, ambiguous));
  const inset = insetFor(zone, side, constants);

  return [
    ...clean.map((span) => ({ span, ambiguous: false })),
    ...ambiguous.map((span) => ({ span, ambiguous: true })),
  ]
    .map((candidate) => ({
      ambiguous: candidate.ambiguous,
      span: { lo: candidate.span.lo + inset, hi: candidate.span.hi - inset },
    }))
    .filter((candidate) => spanLength(candidate.span) >= constants.minRun)
    .map((candidate) => ({ zoneId: zone.id, side, ...candidate }));
}

// ── GPAV (§4.2) ─────────────────────────────────────────────────────────────

export interface Piece {
  lo: number;
  hi: number;
  target: number;
}

// The minimiser of Σ fᵢ over one pooled block, where each fᵢ is a dead-zone
// quadratic plus λ(z − target)². The sum's derivative is piecewise linear and
// strictly increasing (λ > 0), so the root is unique and can be found exactly:
// walk the regions between breakpoints and solve the one linear equation whose
// root lands inside its own region. No iteration, so nothing that could
// converge differently on another machine.
function blockMinimiser(pieces: Piece[], lambda: number): number {
  const breaks = [
    ...new Set(pieces.flatMap((piece) => [piece.lo, piece.hi])),
  ].sort((a, b) => a - b);

  // The derivative's coefficients on whichever region contains `probe`.
  const coefficients = (probe: number): { slope: number; offset: number } => {
    let slope = 0;
    let offset = 0;

    for (const piece of pieces) {
      if (probe < piece.lo) {
        slope += 2;
        offset -= 2 * piece.lo;
      } else if (probe > piece.hi) {
        slope += 2;
        offset -= 2 * piece.hi;
      }

      slope += 2 * lambda;
      offset -= 2 * lambda * piece.target;
    }

    return { slope, offset };
  };

  const first = breaks[0] ?? 0;
  const last = breaks[breaks.length - 1] ?? 0;

  const probes: number[] = [first - 1];
  const bounds: [number, number][] = [[-Infinity, first]];

  for (let i = 1; i < breaks.length; i++) {
    const lo = breaks[i - 1] ?? 0;
    const hi = breaks[i] ?? 0;

    probes.push((lo + hi) / 2);
    bounds.push([lo, hi]);
  }

  probes.push(last + 1);
  bounds.push([last, Infinity]);

  for (let i = 0; i < probes.length; i++) {
    const { slope, offset } = coefficients(probes[i] ?? 0);
    const root = -offset / slope;
    const [lo, hi] = bounds[i] ?? [0, 0];

    if (root >= lo - 1e-9 && root <= hi + 1e-9) {
      return root;
    }
  }

  return first;
}

// Pool-adjacent-violators, generalised from means to the block minimiser above.
// Ordinary PAVA pools to a mean because its loss is a plain square; ours is a
// dead-zone quadratic, which is still convex, so the same pooling argument
// holds with the mean swapped out.
//
// Exported for the optimality test: this claims to be a minimiser, not merely a
// feasible arrangement, and that is worth checking against brute force.
export function gpav(pieces: Piece[], lambda: number): number[] {
  const blocks: { pieces: Piece[]; value: number }[] = [];

  for (const piece of pieces) {
    blocks.push({ pieces: [piece], value: blockMinimiser([piece], lambda) });

    // Merge back while the chain runs downhill — exactly where the monotonicity
    // constraint binds.
    for (;;) {
      const last = blocks[blocks.length - 1];
      const previous = blocks[blocks.length - 2];

      if (!last || !previous || previous.value <= last.value - 1e-12) {
        break;
      }

      blocks.pop();
      blocks.pop();

      const merged = [...previous.pieces, ...last.pieces];

      blocks.push({ pieces: merged, value: blockMinimiser(merged, lambda) });
    }
  }

  return blocks.flatMap((block) => block.pieces.map(() => block.value));
}

// ── crossing tests ──────────────────────────────────────────────────────────

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

  return side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0;
}

function polylineCrossesRect(points: Point[], rect: Rect): boolean {
  const ring: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x, y: rect.y },
  ];

  for (let i = 1; i < points.length; i++) {
    for (let j = 1; j < ring.length; j++) {
      const a = points[i - 1];
      const b = points[i];
      const c = ring[j - 1];
      const d = ring[j];

      if (a && b && c && d && segmentsCross(a, b, c, d)) {
        return true;
      }
    }
  }

  return false;
}

// ── per-side solve ──────────────────────────────────────────────────────────

interface SideResult {
  placed: Placed[];
  ambiguous: number;
  crossings: number;
  residual: number;
  length: number;
}

interface Context {
  zones: Zone[];
  labelled: Zone[];
  byId: Map<string, Zone>;
  ancestors: Map<string, Set<string>>;
  frame: Rect;
  // The gutters the component has reserved around the frame. The top and bottom
  // rails run to these edges — see `solveSide` — so the solve needs to know how
  // much room it was actually given.
  padding: SidePadding;
  sizes: Record<string, LabelSize>;
  constants: Constants;
  overrides: Overrides;
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(Math.max(value, lo), hi);

// Solves one side end to end: freeze the order, run GPAV, clamp into the
// gutter, then check the result still reads correctly. Null means the side is
// impossible as composed, which the caller treats as a rejected assignment
// rather than an error — see hard rule 5 and §4.3.
function solveSide(
  context: Context,
  side: Side,
  candidates: Candidate[],
): SideResult | null {
  const { frame, constants } = context;
  const vertical = isVertical(side);

  // Rule 11, relaxed. The top and bottom rails span the reserved canvas, so an
  // end label may overhang the frame and sit over a corner; the left and right
  // rails stay inside the frame's own extent. See §2 — the two families are
  // vertically disjoint by `sideGap` whatever they do horizontally, so the
  // corner was never contended and the old inner-width rail was paying for a
  // collision that cannot happen. It was not free: forbidding the overhang
  // collapses `hi` and the clamp then cascades back down the non-overlap chain,
  // skewing every label on the side inwards.
  //
  // The rail stops at the reservation and not a pixel further. `reservePadding`
  // is what the component has already painted into, so a label that escaped it
  // would be clipped.
  const gutterLo = vertical ? frame.y : frame.x - context.padding.left;
  const gutterHi = vertical
    ? frame.y + frame.h
    : frame.x + frame.w + context.padding.right;

  const extentOf = (candidate: Candidate): number =>
    vertical
      ? (context.sizes[candidate.zoneId]?.h ?? labelHeight)
      : (context.sizes[candidate.zoneId]?.w ?? 0);

  const centreOf = (candidate: Candidate): number =>
    (candidate.span.lo + candidate.span.hi) / 2;

  // Stable total order (§6): position along the rail, then the edge coordinate,
  // then the id. Ties are common in a symmetric layout, and without a total
  // order they resolve differently on different machines.
  const ordered = [...candidates].sort((a, b) => {
    const byCentre = centreOf(a) - centreOf(b);

    if (Math.abs(byCentre) > 1e-9) {
      return byCentre;
    }

    const zoneA = context.byId.get(a.zoneId);
    const zoneB = context.byId.get(b.zoneId);
    const byCoord =
      (zoneA ? edgeCoord(zoneA, side) : 0) -
      (zoneB ? edgeCoord(zoneB, side) : 0);

    if (Math.abs(byCoord) > 1e-9) {
      return byCoord;
    }

    return a.zoneId < b.zoneId ? -1 : 1;
  });

  const count = ordered.length;
  const extents = ordered.map(extentOf);

  // Shift to z-space: subtracting the running stack height turns "labels don't
  // overlap" into a plain chain z₁ ≤ z₂ ≤ … — which is what PAVA needs.
  const offsets: number[] = [0];

  for (let i = 1; i < count; i++) {
    offsets.push((offsets[i - 1] ?? 0) + (extents[i - 1] ?? 0) + constants.gap);
  }

  const stack =
    extents.reduce((sum, extent) => sum + extent, 0) +
    (count - 1) * constants.gap;

  // Hard rule 5. The spec called for a throw here, but during the search this
  // is only one composition among many — eleven labels never fit one gutter, so
  // throwing would kill the enumeration on its first probe. Rejecting lets the
  // search find the arrangement that does fit; rule 10 still throws if nothing
  // anywhere survives.
  if (stack > gutterHi - gutterLo) {
    return null;
  }

  const evenStart = (gutterLo + gutterHi - stack) / 2;

  const pieces: Piece[] = ordered.map((candidate, i) => {
    const half = (extents[i] ?? 0) / 2;
    const offset = offsets[i] ?? 0;
    const override = context.overrides[candidate.zoneId];
    const evenCentre = evenStart + offset + half;

    // A pinned zone gets its target and its segment collapsed onto the pin, so
    // the dead-zone loss has nowhere else to sit.
    const pinned =
      override?.y === undefined
        ? undefined
        : clamp(override.y, candidate.span.lo, candidate.span.hi);

    const centre = pinned ?? centreOf(candidate);
    const target =
      pinned ?? constants.alpha * centre + (1 - constants.alpha) * evenCentre;

    const span =
      pinned === undefined ? candidate.span : { lo: pinned, hi: pinned };

    // Positions are label leading edges, so the segment and the target shift by
    // half a label to keep the anchor — not the label's corner — on the zone.
    //
    // This measures from the label's *centre*, even though §4.5's attachment
    // slides along the label's whole edge and a leader is therefore straight
    // whenever the label merely *overlaps* the segment. Widening the dead zone
    // to match was tried and reverted: λ dominates this term at these weights,
    // so a position is essentially λ's optimum and the dead zone rarely binds at
    // all. Measured, widening moved twelve numbers by at most 0.6px across the
    // three stories, straightened nothing that the sliding attachment had not
    // already straightened, and was slightly worse below `alpha: 1`, where the
    // extra slack let labels drift further from their zones before the loss
    // engaged. It also forced a special case, since a pinned `y` has to keep a
    // point dead zone or the pin stops meaning what it says. See §4.2.
    return {
      lo: span.lo - half - offset,
      hi: span.hi - half - offset,
      target: target - half - offset,
    };
  });

  // The gutter box is common in z-space — the running offsets are exactly what
  // makes it so — which is why clamping the GPAV result is still optimal and no
  // re-solve is needed.
  const lo = gutterLo;
  const hi = gutterHi - (extents[count - 1] ?? 0) - (offsets[count - 1] ?? 0);

  if (lo > hi) {
    return null;
  }

  const solved = gpav(pieces, constants.lambda);
  const positions = solved.map((z, i) => clamp(z, lo, hi) + (offsets[i] ?? 0));

  // Realised anchors, then the staircase check (§4.3). Clamping is monotone in
  // its input, but the segments differ per zone, so a child hemmed into a narrow
  // span can end up ordered against a parent that wasn't — and the fans would
  // cross. That assignment is rejected outright, never repaired: a child whose
  // label has to clamp past its parent's extent genuinely belongs on another
  // side, and letting the search say so beats bending it here.
  const anchors = positions.map((position, i) => {
    const candidate = ordered[i];
    const centre = position + (extents[i] ?? 0) / 2;

    return candidate
      ? clamp(centre, candidate.span.lo, candidate.span.hi)
      : centre;
  });

  for (let i = 1; i < count; i++) {
    if ((anchors[i] ?? 0) < (anchors[i - 1] ?? 0) - 1e-9) {
      return null;
    }
  }

  const placed: Placed[] = ordered.map((candidate, i) => {
    const size = context.sizes[candidate.zoneId] ?? { w: 0, h: labelHeight };
    const zone = context.byId.get(candidate.zoneId);
    const rail = anchors[i] ?? 0;
    const position = positions[i] ?? 0;
    const edge = zone ? edgeCoord(zone, side) : 0;

    const anchor = vertical ? { x: edge, y: rail } : { x: rail, y: edge };

    // Right-align the left gutter and left-align the right gutter (§4.5), so
    // every fan on a side starts at one x and the common-domain argument holds.
    const label: Rect = vertical
      ? {
          x:
            side === "left"
              ? frame.x - constants.sideGap - size.w
              : frame.x + frame.w + constants.sideGap,
          y: position,
          w: size.w,
          h: size.h,
        }
      : {
          x: position,
          y:
            side === "top"
              ? frame.y - constants.sideGap - size.h
              : frame.y + frame.h + constants.sideGap,
          w: size.w,
          h: size.h,
        };

    const railCoord = vertical
      ? side === "left"
        ? frame.x
        : frame.x + frame.w
      : side === "top"
        ? frame.y
        : frame.y + frame.h;

    const labelEdge = vertical
      ? side === "left"
        ? label.x + label.w
        : label.x
      : side === "top"
        ? label.y + label.h
        : label.y;

    // Where the fan lands on the label. It slides along the label's gutter-facing
    // edge to meet the rail coordinate the anchor is already at, so the leader
    // comes out straight whenever the anchor is anywhere within the label's own
    // span — which is a window most of a label wide, rather than the single point
    // a fixed midpoint attachment offered. The inset keeps it off the chip's
    // rounded corners, where a leader reads as a mistake rather than a
    // connection. Where the anchor is out of reach the clamp gives back the
    // nearest reachable point, which is the shallowest angle available.
    const attachLo = (vertical ? label.y : label.x) + constants.attachInset;
    const attachHi =
      (vertical ? label.y + label.h : label.x + label.w) -
      constants.attachInset;

    const attach =
      attachLo > attachHi
        ? (attachLo + attachHi) / 2
        : clamp(vertical ? anchor.y : anchor.x, attachLo, attachHi);

    const points = vertical
      ? [anchor, { x: railCoord, y: anchor.y }, { x: labelEdge, y: attach }]
      : [anchor, { x: anchor.x, y: railCoord }, { x: attach, y: labelEdge }];

    return { zoneId: candidate.zoneId, side, anchor, label, points };
  });

  // Tier 1, tier 2 and the length term are all separable per side: a leader is
  // fully determined by its own side's composition, so they can be computed
  // here once and cached with the solve. Only the cross-side stub crossings
  // need to look at two sides at once. The spec missed this, and it is worth
  // roughly a twelvefold cut on the eleven-zone story.
  let crossings = 0;
  let length = 0;

  for (const item of placed) {
    const exempt = context.ancestors.get(item.zoneId) ?? new Set<string>();

    for (const zone of context.zones) {
      if (zone.id === item.zoneId || exempt.has(zone.id)) {
        continue;
      }

      if (polylineCrossesRect(item.points, zone.rect)) {
        crossings++;
      }
    }

    let travelled = 0;

    for (let i = 1; i < item.points.length; i++) {
      const a = item.points[i - 1];
      const b = item.points[i];

      if (a && b) {
        travelled += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }

    length += travelled * travelled;
  }

  const residual = positions.reduce((sum, position, i) => {
    const ideal = (pieces[i]?.target ?? 0) + (offsets[i] ?? 0);

    return sum + Math.abs(position - ideal);
  }, 0);

  return {
    placed,
    ambiguous: ordered.filter((candidate) => candidate.ambiguous).length,
    crossings,
    residual,
    length,
  };
}

// ── cost (§3) ───────────────────────────────────────────────────────────────

// Lexicographic: earlier tiers dominate absolutely. The previous implementation
// added a frame penalty to a leader's pixel length, which asks how many pixels
// of travel a crossing is worth — a question with no answer. Tiers refuse it.
type Cost = number[];

function lexLess(a: Cost, b: Cost): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;

    if (x < y) {
      return true;
    }

    if (x > y) {
      return false;
    }
  }

  return false;
}

// ── search (§4.4) ───────────────────────────────────────────────────────────

interface Solution {
  placed: Placed[];
  cost: Cost;
}

interface Stats {
  leaves: number;
  pruned: number;
  sideSolves: number;
}

// Both caches are keyed on side-group bitmasks, which are the same objects of
// study whichever subset of sides is being enumerated — so they are built once
// and shared across the whole ascending loop.
interface Caches {
  // Per side: mask -> solved side, or null where the side is infeasible.
  group: Map<number, SideResult | null>[];
  // Per ordered side pair: the two masks packed into one integer -> the number
  // of stub crossings between them.
  pair: Map<number, number>[];
}

// Enumerates assignments over an allowed set of sides. Zones take one candidate
// each; a side-group is identified by the bitmask of the zones on it, so every
// cache hit at a leaf is an integer lookup rather than a rebuilt string key.
//
// There is no branch-and-bound here, deliberately. The spec called for one, but
// under this tier order no bound on tier 5 can ever fire: `sidesUsed` sits above
// it at tier 4, and any prefix that has not yet touched every side bounds tier 4
// below the incumbent's, which makes the whole vector compare less regardless of
// what tier 5 says. Measured, the bound pruned 8% of an eleven-zone tree and
// cost more than it saved. What does work is the structure here — separable
// per-side costs, cached per group, and an outer loop that can stop early.
function searchWithin(
  context: Context,
  table: (Candidate | undefined)[][],
  allowed: number[],
  caches: Caches,
  stats: Stats,
): Solution | null {
  const zones = context.labelled;
  const count = zones.length;
  const groupCache = caches.group;

  // Packs a pair of masks into one key. Masks fit in `count` bits, so this
  // stays a small integer and the lookup stays a plain number hash.
  const stride = 1 << count;

  const groupFor = (side: number, mask: number): SideResult | null => {
    const cached = groupCache[side]?.get(mask);

    if (cached !== undefined) {
      return cached;
    }

    const candidates: Candidate[] = [];

    for (let i = 0; i < count; i++) {
      const candidate = mask & (1 << i) ? table[i]?.[side] : undefined;

      if (candidate) {
        candidates.push(candidate);
      }
    }

    stats.sideSolves++;

    const result = solveSide(context, sideAt(side), candidates);

    groupCache[side]?.set(mask, result);

    return result;
  };

  // Resolved once per side rather than per node: `descend` consults both on
  // every branch it takes.
  const verticalBySide = sides.map(isVertical);
  // Must match the rails `solveSide` actually uses, including the overhang the
  // top and bottom now get. A tighter figure here would prune assignments that
  // in fact fit, and the search would quietly return the wrong answer.
  const railSpans = sides.map((side) =>
    isVertical(side)
      ? context.frame.h
      : context.frame.w + context.padding.left + context.padding.right,
  );

  const extentOn = (index: number, side: number): number => {
    const size = context.sizes[zones[index]?.id ?? ""] ?? {
      w: 0,
      h: labelHeight,
    };

    return (verticalBySide[side] ?? false) ? size.h : size.w;
  };

  const railSpan = (side: number): number => railSpans[side] ?? 0;

  const masks = [0, 0, 0, 0];
  const stacks = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];

  let best: Solution | null = null;

  const evaluate = (): void => {
    stats.leaves++;

    const results: (SideResult | null)[] = [null, null, null, null];
    let used = 0;

    for (let side = 0; side < 4; side++) {
      const mask = masks[side] ?? 0;

      if (mask === 0) {
        continue;
      }

      const result = groupFor(side, mask);

      if (!result) {
        return;
      }

      results[side] = result;
      used++;
    }

    let ambiguous = 0;
    let crossings = 0;
    let residual = 0;
    let length = 0;

    for (const result of results) {
      if (!result) {
        continue;
      }

      ambiguous += result.ambiguous;
      crossings += result.crossings;
      residual += result.residual;
      length += result.length;
    }

    // The only term two sides have to agree on, and the reason the cost is not
    // separable outright. It depends on nothing but the two groups, though, so
    // it caches on the pair — without which this double loop would run at every
    // leaf and dominate the entire search.
    let stubCrossings = 0;

    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const first = results[a];
        const second = results[b];

        if (!first || !second) {
          continue;
        }

        const memo = caches.pair[a * 4 + b];
        const key = (masks[a] ?? 0) * stride + (masks[b] ?? 0);
        const cached = memo?.get(key);

        if (cached !== undefined) {
          stubCrossings += cached;
          continue;
        }

        let found = 0;

        for (const one of first.placed) {
          for (const two of second.placed) {
            const p0 = one.points[0];
            const p1 = one.points[1];
            const q0 = two.points[0];
            const q1 = two.points[1];

            if (p0 && p1 && q0 && q1 && segmentsCross(p0, p1, q0, q1)) {
              found++;
            }
          }
        }

        memo?.set(key, found);
        stubCrossings += found;
      }
    }

    const mean = count / Math.max(1, used);
    let imbalance = 0;

    for (let side = 0; side < 4; side++) {
      if ((masks[side] ?? 0) !== 0) {
        imbalance += Math.abs((counts[side] ?? 0) - mean);
      }
    }

    const aesthetics =
      context.constants.weights.residual * residual +
      context.constants.weights.length * length +
      context.constants.weights.imbalance * imbalance;

    // Tier 6: the masks themselves are a total order on the assignment, and a
    // pure function of it. That is all `lexKey` has to be — and comparing four
    // integers costs nothing at a leaf visited a million times, where building
    // a string key would dominate the run.
    //
    // The comparison runs on locals before anything is allocated: almost every
    // leaf loses, and a losing leaf should cost nothing but arithmetic.
    if (best) {
      const rival = best.cost;
      const tiers = [ambiguous, crossings, stubCrossings, used, aesthetics];
      let decided = false;

      for (let i = 0; i < tiers.length && !decided; i++) {
        const mine = tiers[i] ?? 0;
        const theirs = rival[i] ?? 0;

        if (mine !== theirs) {
          if (mine > theirs) {
            return;
          }

          decided = true;
        }
      }

      if (!decided) {
        // Everything above ties, so the masks decide.
        let beaten = false;

        for (let i = 0; i < 4 && !beaten; i++) {
          const mine = masks[i] ?? 0;
          const theirs = rival[5 + i] ?? 0;

          if (mine !== theirs) {
            if (mine > theirs) {
              return;
            }

            beaten = true;
          }
        }

        if (!beaten) {
          return;
        }
      }
    }

    const placed: Placed[] = [];

    for (const result of results) {
      if (result) {
        placed.push(...result.placed);
      }
    }

    best = {
      placed,
      cost: [
        ambiguous,
        crossings,
        stubCrossings,
        used,
        aesthetics,
        masks[0] ?? 0,
        masks[1] ?? 0,
        masks[2] ?? 0,
        masks[3] ?? 0,
      ],
    };
  };

  const descend = (index: number): void => {
    if (index === count) {
      evaluate();

      return;
    }

    for (const side of allowed) {
      if (!table[index]?.[side]) {
        continue;
      }

      const extent = extentOn(index, side);

      // Hard rule 5, applied the moment it becomes true rather than at the
      // leaf: a side's stack only ever grows, so once it overflows its gutter
      // no completion of this prefix can recover.
      if (
        (stacks[side] ?? 0) +
          extent +
          (counts[side] ?? 0) * context.constants.gap >
        railSpan(side)
      ) {
        stats.pruned++;
        continue;
      }

      masks[side] = (masks[side] ?? 0) | (1 << index);
      stacks[side] = (stacks[side] ?? 0) + extent;
      counts[side] = (counts[side] ?? 0) + 1;

      descend(index + 1);

      masks[side] = (masks[side] ?? 0) & ~(1 << index);
      stacks[side] = (stacks[side] ?? 0) - extent;
      counts[side] = (counts[side] ?? 0) - 1;
    }
  };

  descend(0);

  return best;
}

// All non-empty subsets of the four sides, of a given size.
function sideSubsets(size: number): number[][] {
  const out: number[][] = [];

  for (let mask = 1; mask < 16; mask++) {
    const bits = [0, 1, 2, 3].filter((bit) => mask & (1 << bit));

    if (bits.length === size) {
      out.push(bits);
    }
  }

  return out;
}

// ── layout (§5) ─────────────────────────────────────────────────────────────

export function layout(
  zones: Zone[],
  labelSizes: Record<string, LabelSize>,
  frame: Rect,
  constants: Constants,
  overrides: Overrides = {},
): { placed: Placed[] } {
  const labelled = zones.filter((zone) => !overrides[zone.id]?.hidden);

  if (labelled.length === 0) {
    return { placed: [] };
  }

  const byId = new Map(zones.map((zone) => [zone.id, zone]));

  // Ancestor chains, resolved once. Hidden zones stay in the chain: a leader
  // still crosses them, and they are still someone's parent.
  const ancestors = new Map<string, Set<string>>();

  for (const zone of zones) {
    const chain = new Set<string>();
    let current = zone.parentId;

    while (current && !chain.has(current)) {
      chain.add(current);
      current = byId.get(current)?.parentId;
    }

    ancestors.set(zone.id, chain);
  }

  const context: Context = {
    zones,
    labelled,
    byId,
    ancestors,
    frame,
    // Derived here rather than passed in, from the same function and the same
    // sizes the component reserves its gutters with. The rail and the padding
    // must agree exactly — a rail wider than the reservation puts labels in
    // space that was never cleared for them — and deriving both from one place
    // is what makes that true by construction rather than by convention.
    padding: reservePadding(labelSizes, constants),
    sizes: labelSizes,
    constants,
    overrides,
  };

  // Candidates per zone. An override pins the side by collapsing the choice
  // rather than by special-casing the search.
  const table: (Candidate | undefined)[][] = labelled.map((zone) => {
    const forced = overrides[zone.id]?.side;

    const all = sides.flatMap((side) =>
      forced && side !== forced
        ? []
        : candidatesFor(zone, side, zones, constants),
    );

    if (all.length === 0) {
      // Hard rule 9. With the depth inset in place this should be unreachable:
      // it fired routinely before, because a parent whose children sat flush on
      // all four of its edges had every span subtracted away by rule 2.
      throw new Error(
        `[anatomy] zone "${zone.id}" has no candidate segments on any side. Its edges are fully covered by deeper zones — check the depth inset, or hide it via overrides.`,
      );
    }

    return sides.map((side) =>
      all
        .filter((candidate) => candidate.side === side)
        .reduce<Candidate | undefined>(
          (best, candidate) =>
            !best ||
            spanLength(candidate.span) > spanLength(best.span) ||
            (spanLength(candidate.span) === spanLength(best.span) &&
              candidate.span.lo < best.span.lo)
              ? candidate
              : best,
          undefined,
        ),
    );
  });

  const caches: Caches = {
    group: sides.map(() => new Map<number, SideResult | null>()),
    pair: Array.from({ length: 16 }, () => new Map<number, number>()),
  };

  const stats: Stats = { leaves: 0, pruned: 0, sideSolves: 0 };

  // Ascending side-subsets. Tiers 1–3 are counts, so they bottom out at zero:
  // once a subset of size k yields an assignment scoring 0/0/0 on them, nothing
  // larger can win — a bigger subset costs strictly more at tier 4 and cannot
  // improve on zero above it. So the first k to reach 0/0/0 is provably optimal
  // and the rest of the space goes unvisited. That is what collapses the common
  // case (a clean stack, one gutter) from millions of leaves to a handful,
  // while keeping the answer exact.
  let best: Solution | null = null;

  for (let size = 1; size <= 4; size++) {
    let bestAtSize: Solution | null = null;

    for (const subset of sideSubsets(size)) {
      const found = searchWithin(context, table, subset, caches, stats);

      if (found && (!bestAtSize || lexLess(found.cost, bestAtSize.cost))) {
        bestAtSize = found;
      }
    }

    if (!bestAtSize) {
      continue;
    }

    if (!best || lexLess(bestAtSize.cost, best.cost)) {
      best = bestAtSize;
    }

    if (
      (bestAtSize.cost[0] ?? 0) === 0 &&
      (bestAtSize.cost[1] ?? 0) === 0 &&
      (bestAtSize.cost[2] ?? 0) === 0
    ) {
      break;
    }
  }

  if (!best) {
    // Hard rule 10.
    throw new Error(
      `[anatomy] no assignment survives for this layout (${labelled.length} zones: ${labelled
        .map((zone) => zone.id)
        .join(
          ", ",
        )}). Every arrangement either overflows a gutter or fails the staircase check. Pin a zone via overrides.`,
    );
  }

  return { placed: best.placed };
}

// ── Storybook adapter ───────────────────────────────────────────────────────

// The placement as pure data: zone ids and numbers, nothing that points back at
// the DOM. That is what lets the solve run in a worker — a `Region` carries its
// `el`, and an `HTMLElement` cannot be structured-cloned across the boundary, so
// posting one would throw. The split keeps the region handles on the side of the
// wall that can actually use them.
export interface PlacedLabelData {
  // Index into the region array the zones were built from. The re-attachment
  // below is positional, so this is the whole of the correspondence.
  index: number;
  zoneId: string;
  side: Side;
  anchorX: number;
  anchorY: number;
  labelLeft: number;
  labelTop: number;
  labelWidth: number;
  points: Point[];
}

export interface PlacedFrameData {
  index: number;
  zoneId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlacementData {
  labels: PlacedLabelData[];
  // The rects the overlay should actually draw: the regions pulled in by the
  // depth inset, so the border a label points at is the border the reader sees.
  frames: PlacedFrameData[];
}

export interface PlacedLabel extends PlacedLabelData {
  region: Region;
}

export interface PlacedFrame extends PlacedFrameData {
  region: Region;
}

export interface SidePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Placement {
  labels: PlacedLabel[];
  frames: PlacedFrame[];
}

// Measures a chip's rendered width for the fixed chip font, so slot sizing and
// side padding can use real widths without a render-measure-render round-trip.
// Mirrors the chip's `font` and `padding`.
let measureContext: CanvasRenderingContext2D | null | undefined;

function measureLabelWidth(text: string): number {
  if (typeof document === "undefined") {
    return text.length * 7 + 12; // deterministic fallback for non-DOM builds
  }

  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");

    if (measureContext) {
      measureContext.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    }
  }

  const textWidth = measureContext
    ? measureContext.measureText(text).width
    : text.length * 6;

  // Chip padding (5px each side) + letter-spacing (0.02em at 10px) + 1px slack.
  return Math.ceil(textWidth + 10 + text.length * 0.2 + 1);
}

// The label sizes for a set of regions, keyed by region id.
//
// Note these are measured in the chip's own font — `ui-sans-serif, system-ui,
// sans-serif` — which is a system stack, not one of the web fonts the design
// system loads. So label sizes do not move when a web font swaps in, even
// though the regions they describe do. That is what lets the padding below be
// reserved before the fonts have settled.
export function measureLabelSizes(
  regions: Region[],
): Record<string, LabelSize> {
  return Object.fromEntries(
    regions.map((region) => [
      region.id,
      { w: measureLabelWidth(region.name), h: labelHeight },
    ]),
  );
}

// The gutter each side has to reserve, from the label sizes alone.
//
// This is deliberately not derived from a solved placement. A gutter's depth is
// `sideGap` plus the widest label that could land in it, and its extent along
// the rail is bounded by the frame (rules 5 and 11) — so nothing here depends
// on which side any zone actually wins. Which means it can be computed before
// the solve, and the component can be painted into padding that is already
// final. §4.2 always treated the gutter box as an *input* to the clamp; taking
// padding back off the output was the thing that was backwards.
//
// Every side reserves the same conservative bound, whether or not it ends up
// used. That leaves empty gutter on a one-sided story — and it is worth it: the
// alternative is tightening padding once the solve lands, which moves the
// component after the reader is already looking at it. It also centres the
// component, which reads as deliberate rather than as a diagram that drifted.
//
// Which sizes to hand it is the caller's call, and for a navigable overlay the
// answer is every label in the tree rather than the level on screen — see §10.
// The bound is over whatever it is given; the point is that it is over a set
// that does not change as the reader moves.
export function reservePadding(
  labelSizes: Record<string, LabelSize>,
  constants: Constants,
): SidePadding {
  const sizes = Object.values(labelSizes);

  if (sizes.length === 0) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const widest = Math.max(...sizes.map((size) => size.w));
  const tallest = Math.max(...sizes.map((size) => size.h));

  const horizontal = Math.ceil(constants.sideGap + widest);
  const vertical = Math.ceil(constants.sideGap + tallest);

  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  };
}

// Rounding happens here and nowhere earlier (§6): the solve stays in reals so
// that two runs agree bit for bit, and only the drawn numbers get tidied.
const round = (value: number): number => Math.round(value * 100) / 100;

export function leaderPath(label: PlacedLabel): string {
  return label.points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`,
    )
    .join(" ");
}

// Whether two stretches of a line actually lie on top of each other. Touching
// end to end is not overlapping: nothing is hidden by it.
const spansOverlap = (a: Span, b: Span): boolean =>
  Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0;

// How far each zone's edges have to give way, per side, so that no two zones at
// different depths draw the same border (§9).
//
// A zone steps outward on a side by one `depthInset` for each distinct depth
// below it that is drawing on the same stretch of the same line. The deepest
// zone in any such pile has nothing below it, so it does not move at all: it
// keeps its element's geometry to the pixel and draws on top. Everything with
// clearance is likewise untouched.
//
// Three things this asks that the old unconditional inset did not:
//
// **Outward, not inward.** The inner zone is the one with content in it and the
// one the reader is looking at, so it is the one that stays put; the container
// gives way and its border ends up just outside the child it encloses, which is
// what a container does anyway.
//
// **Only where the borders genuinely collide.** Sharing a line is not enough —
// the stretches have to overlap. `body`'s left edge sits on the same x as
// `button-primary`'s, three slots apart and hundreds of pixels up; on one line,
// never on one pixel. Nothing is hidden, so nothing moves. This agrees with rule
// 2, which subtracts *spans* and so takes nothing off `body` either.
//
// **Counted per distinct depth below.** In a chain of flush containers the ranks
// come out 2, 1, 0 and the pixels separate the lot in one pass — a cascade needs
// no second thought as long as spans nest along a containment chain, which is
// what containment means. Depth alone decides it, with no ancestry test, exactly
// as §4.1's occluder rule does; agreeing with the rule that consumes this is
// worth more than a second opinion about the same question.
//
// Same-depth zones never move for each other: neither encloses the other, so no
// border is hidden — two `attribute` slots sharing a top edge are side by side,
// not nested. §3's tier 1 already calls that ambiguity and prices it.
function outwardNudges(
  zones: Zone[],
  constants: Constants,
): Map<string, Partial<Record<Side, number>>> {
  const nudges = new Map<string, Partial<Record<Side, number>>>();

  for (const side of sides) {
    for (const zone of zones) {
      const line = lineKey(zone, side);
      const span = edgeSpan(zone, side);

      const deeper = new Set(
        zones
          .filter(
            (other) =>
              other.id !== zone.id &&
              other.depth > zone.depth &&
              lineKey(other, side) === line &&
              spansOverlap(edgeSpan(other, side), span),
          )
          .map((other) => other.depth),
      );

      if (deeper.size > 0) {
        nudges.set(zone.id, {
          ...nudges.get(zone.id),
          [side]: deeper.size * constants.depthInset,
        });
      }
    }
  }

  return nudges;
}

// The zones a set of regions describes. Split out from `placeLabels` because it
// is the last step that needs a `Region` at all: everything downstream works on
// zones, which is exactly why the worker boundary sits here.
//
// §9, resolved — and then narrowed: the inset is applied where edges actually
// coincide, and nowhere else. It used to be unconditional, `(depth - 1)` pixels
// off every nested zone whether or not it was in anyone's way, which distorted
// the geometry of a whole tree to settle a conflict that in practice only a
// handful of zones have. A zone with clearance now renders on its element to the
// pixel.
export function toZones(
  regions: Region[],
  constants: Constants = anatomyConstants,
): Zone[] {
  // Coincidence is decided once, on true geometry, and the nudge is applied
  // once. Not iterated to a fixpoint: §6 forbids convergence loops, and this
  // does not need one. A nudge can only *create* a coincidence between edges
  // whose true separation was already under a couple of pixels — above
  // `lineEpsilon`, so they were not coincident, but far too close for either
  // border to have been distinguishable from the other. In that regime the
  // diagram was already lying to the reader, and if the new coincidence hides a
  // border, rule 9 fires by name, which is the designed outcome. The old
  // unconditional inset had the identical hazard from the other direction —
  // pulling a deep zone in by two pixels could land it on a border two pixels
  // inside — and this version moves fewer zones, and moves them less far.
  const exact: Zone[] = regions.map((region) => ({
    id: region.id,
    rect: { x: region.left, y: region.top, w: region.width, h: region.height },
    depth: region.depth,
    ...(region.parentId === undefined ? {} : { parentId: region.parentId }),
    radii: region.radii,
  }));

  const nudges = outwardNudges(exact, constants);

  return exact.map((zone) => {
    const nudge = nudges.get(zone.id);

    if (!nudge) {
      return zone;
    }

    const top = nudge.top ?? 0;
    const left = nudge.left ?? 0;
    const right = nudge.right ?? 0;
    const bottom = nudge.bottom ?? 0;

    return {
      ...zone,
      rect: {
        x: zone.rect.x - left,
        y: zone.rect.y - top,
        w: zone.rect.w + left + right,
        h: zone.rect.h + top + bottom,
      },
    };
  });
}

// The solve proper: zones in, drawable numbers out, no DOM either side. This is
// the half that runs in the worker, and the half the hard rules throw from —
// rules 9 and 10 raise out of `layout` below and are meant to reach the reader,
// so whatever calls this must not swallow them.
export function placeZones(
  zones: Zone[],
  labelSizes: Record<string, LabelSize>,
  overrides: Overrides = {},
  constants: Constants = anatomyConstants,
): PlacementData {
  if (zones.length === 0) {
    return { labels: [], frames: [] };
  }

  const indexOf = new Map(zones.map((zone, index) => [zone.id, index]));

  const left = Math.min(...zones.map((zone) => zone.rect.x));
  const top = Math.min(...zones.map((zone) => zone.rect.y));
  const right = Math.max(...zones.map((zone) => zone.rect.x + zone.rect.w));
  const bottom = Math.max(...zones.map((zone) => zone.rect.y + zone.rect.h));
  const frame: Rect = { x: left, y: top, w: right - left, h: bottom - top };

  const { placed } = layout(zones, labelSizes, frame, constants, overrides);

  const labels: PlacedLabelData[] = placed.flatMap((item) => {
    const index = indexOf.get(item.zoneId);

    if (index === undefined) {
      return [];
    }

    return [
      {
        index,
        zoneId: item.zoneId,
        side: item.side,
        anchorX: round(item.anchor.x),
        anchorY: round(item.anchor.y),
        labelLeft: round(item.label.x),
        labelTop: round(item.label.y),
        labelWidth: item.label.w,
        points: item.points,
      },
    ];
  });

  const frames: PlacedFrameData[] = zones.map((zone, index) => ({
    index,
    zoneId: zone.id,
    left: round(zone.rect.x),
    top: round(zone.rect.y),
    width: round(zone.rect.w),
    height: round(zone.rect.h),
  }));

  return { labels, frames };
}

// Hands each placed item its region back. Positional, because `toZones` is: the
// nth zone is the nth region, and nothing in between reorders them.
export function attachRegions(
  placement: PlacementData,
  regions: Region[],
): Placement {
  const attach = <T extends { index: number }>(
    item: T,
  ): (T & { region: Region })[] => {
    const region = regions[item.index];

    return region ? [{ ...item, region }] : [];
  };

  return {
    labels: placement.labels.flatMap(attach),
    frames: placement.frames.flatMap(attach),
  };
}

// Places every region's label, in one synchronous call. `labelSizes` is passed
// in rather than measured here so that the caller can reserve the gutters from
// the same numbers before this ever runs — see `reservePadding`.
//
// The overlay does not use this: it posts the zones to a worker so a solve
// cannot block the page. What it does use are the three functions above, in this
// order, and keeping them composed here is worth it — this is the honest
// statement of what the pipeline computes, unentangled from where it runs.
export function placeLabels(
  regions: Region[],
  labelSizes: Record<string, LabelSize>,
  overrides: Overrides = {},
  constants: Constants = anatomyConstants,
): Placement {
  const zones = toZones(regions, constants);

  return attachRegions(
    placeZones(zones, labelSizes, overrides, constants),
    regions,
  );
}
