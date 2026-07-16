// Deterministic placement of anatomy callout labels around a component.
// Implements anatomy-labelling-spec.md; § refs below point into it.

export type Side = "top" | "right" | "bottom" | "left";

// Order is load-bearing: search bitmasks index into it (§6).
const sides: Side[] = ["top", "right", "bottom", "left"];

const isVertical = (side: Side): boolean => side === "left" || side === "right";

function sideAt(index: number): Side {
  const side = sides[index];

  if (!side) {
    throw new Error(`[anatomy] side index ${index} is out of range`);
  }

  return side;
}

export const labelHeight = 20;

// Must match the offscreen measurer's font, else reserved width won't match the
// box. Var may resolve to a late web font; `whenLabelFontReady` gates measure.
export const labelFont =
  "600 10px/1.5 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

export interface Constants {
  gap: number;
  minRun: number;
  stubCap: number;
  depthInset: number;
  sideGap: number;
  attachInset: number;
  alpha: number;
  // Strict-convexity term, not an epsilon: a flat dead-zone optimum is a set,
  // not a point, so the snapshot flakes. §4.2.
  lambda: number;
  weights: { residual: number; length: number; imbalance: number };
}

export const anatomyConstants: Constants = {
  gap: 6,
  minRun: 8,
  stubCap: 2,
  depthInset: 1,
  sideGap: 28,
  // Chip corner radius is 3, so 4 clears it by a pixel.
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
  parentId?: string;
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
  points: Point[];
}

// ── interval algebra (§4.1) ─────────────────────────────────────────────────

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

// Subpixel layout: exact edge equality is unreliable, so match within 0.5px.
const lineEpsilon = 0.5;

const lineKey = (zone: Zone, side: Side): string =>
  `${side}@${Math.round(edgeCoord(zone, side) / lineEpsilon)}`;

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

  // Rule 2: deeper zones own a shared span; peers only make it ambiguous.
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

// Block minimiser; exact, no iteration (cross-machine determinism). §4.2.
function blockMinimiser(pieces: Piece[], lambda: number): number {
  const breaks = [
    ...new Set(pieces.flatMap((piece) => [piece.lo, piece.hi])),
  ].sort((a, b) => a - b);

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

// GPAV. Exported for the optimality test. §4.2.
export function gpav(pieces: Piece[], lambda: number): number[] {
  const blocks: { pieces: Piece[]; value: number }[] = [];

  for (const piece of pieces) {
    blocks.push({ pieces: [piece], value: blockMinimiser([piece], lambda) });

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
  padding: SidePadding;
  sizes: Record<string, LabelSize>;
  constants: Constants;
  overrides: Overrides;
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(Math.max(value, lo), hi);

// Solves one side. Null means infeasible as composed; caller treats it as a
// rejected assignment, not an error (rule 5, §4.3).
function solveSide(
  context: Context,
  side: Side,
  candidates: Candidate[],
): SideResult | null {
  const { frame, constants } = context;
  const vertical = isVertical(side);

  // Rule 11. Top/bottom rails span the reserved canvas; left/right stay inside
  // the frame. Rail must stop at the reservation or an escaping label is clipped.
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

  // Stable total order (§6): rail position, edge coordinate, then id. Symmetric
  // layouts tie often; without a total order they resolve nondeterministically.
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

  const offsets: number[] = [0];

  for (let i = 1; i < count; i++) {
    offsets.push((offsets[i - 1] ?? 0) + (extents[i - 1] ?? 0) + constants.gap);
  }

  const stack =
    extents.reduce((sum, extent) => sum + extent, 0) +
    (count - 1) * constants.gap;

  // Rule 5 as a rejection, not a throw: one composition among many, so throwing
  // would kill the enumeration; rule 10 throws if nothing survives.
  if (stack > gutterHi - gutterLo) {
    return null;
  }

  const evenStart = (gutterLo + gutterHi - stack) / 2;

  const pieces: Piece[] = ordered.map((candidate, i) => {
    const half = (extents[i] ?? 0) / 2;
    const offset = offsets[i] ?? 0;
    const override = context.overrides[candidate.zoneId];
    const evenCentre = evenStart + offset + half;

    const pinned =
      override?.y === undefined
        ? undefined
        : clamp(override.y, candidate.span.lo, candidate.span.hi);

    const centre = pinned ?? centreOf(candidate);
    const target =
      pinned ?? constants.alpha * centre + (1 - constants.alpha) * evenCentre;

    const span =
      pinned === undefined ? candidate.span : { lo: pinned, hi: pinned };

    // Positions are label leading edges, so segment/target shift by half a
    // label to keep the anchor on the zone. A pinned `y` needs a point dead
    // zone, else the pin stops meaning what it says. §4.2.
    return {
      lo: span.lo - half - offset,
      hi: span.hi - half - offset,
      target: target - half - offset,
    };
  });

  const lo = gutterLo;
  const hi = gutterHi - (extents[count - 1] ?? 0) - (offsets[count - 1] ?? 0);

  if (lo > hi) {
    return null;
  }

  const solved = gpav(pieces, constants.lambda);
  const positions = solved.map((z, i) => clamp(z, lo, hi) + (offsets[i] ?? 0));

  // Realised anchors, then the staircase check (§4.3): a child clamped into a
  // narrow span can order against its parent and cross; reject, never repair.
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

    // Right-align the left gutter, left-align the right (§4.5), so every fan on
    // a side starts at one x and the common-domain argument holds.
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

    // Fan attachment slides along the label edge to meet the anchor's rail
    // coord; inset keeps it off the rounded corners (§4.5).
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

// Lexicographic: earlier tiers dominate absolutely (§3).
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

interface Caches {
  group: Map<number, SideResult | null>[];
  pair: Map<number, number>[];
}

// Enumerates assignments over an allowed set of sides. §4.4.
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

  const verticalBySide = sides.map(isVertical);
  // Must match the rails `solveSide` uses (incl. top/bottom overhang): a tighter
  // figure prunes assignments that fit and returns a wrong answer.
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

    // Tier 6: masks are a total order on the assignment (§3).
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

      // Rule 5, applied on prefix: a side's stack only grows, so once it
      // overflows its gutter no completion can recover.
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
  // still crosses them.
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
    // Rail and padding must agree exactly, or labels land in uncleared space.
    padding: reservePadding(labelSizes, constants),
    sizes: labelSizes,
    constants,
    overrides,
  };

  const table: (Candidate | undefined)[][] = labelled.map((zone) => {
    const forced = overrides[zone.id]?.side;

    const all = sides.flatMap((side) =>
      forced && side !== forced
        ? []
        : candidatesFor(zone, side, zones, constants),
    );

    if (all.length === 0) {
      // Hard rule 9; unreachable in practice given the depth inset.
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

  // Ascending side-subsets: tiers 1–3 bottom out at zero, so the first size to
  // score 0/0/0 is provably optimal and the rest goes unvisited. §4.4.
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

// Pure data, no DOM handles, so the solve can run in a worker (an HTMLElement
// can't be structured-cloned across the boundary).
export interface PlacedLabelData {
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
  // Rects to draw: regions pulled in by the depth inset, so a label points at
  // the border the reader sees.
  frames: PlacedFrameData[];
}

export interface SidePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Gutter per side, an *input* to §4.2's clamp, not read back off its output, so
// padding is final before paint. Pass the whole tree's labels for a navigable
// overlay, so the bound doesn't change as the reader moves (§10).
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

// Rounding happens only here (§6): the solve stays in reals so two runs agree
// bit for bit; only drawn numbers get tidied.
const round = (value: number): number => Math.round(value * 100) / 100;

// True overlap only; touching end to end hides nothing.
const spansOverlap = (a: Span, b: Span): boolean =>
  Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0;

// Per-side outward step so no two zones at different depths draw the same
// border (§9). One `depthInset` per distinct depth below overlapping the same
// stretch; deepest stays put. Same-depth zones never move (tier 1 prices that).
export function outwardNudges(
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

// Rules 9 and 10 throw out of `layout` and must reach the reader — callers must
// not swallow them.
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
