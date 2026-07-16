import { describe, expect, it } from "vitest";

import type { Region } from "./collect-regions";
import type { Constants, Piece, Rect, Zone } from "./place-labels";
import {
  anatomyConstants,
  gpav,
  layout,
  reservePadding,
  toZones,
} from "./place-labels";

// The suite the spec (§8) asks for. The load-bearing ones are the optimality
// check on GPAV — it claims to minimise, not merely to fit — and the invariants
// the crossing-freedom argument rests on: order preservation and one fan
// x-interval per side.

const constants: Constants = anatomyConstants;

// A seeded generator, because the point of this file is that the layout is a
// pure function of its inputs and a flaky test would be self-defeating.
function random(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;

    return state / 4294967296;
  };
}

const objective = (pieces: Piece[], z: number[], lambda: number): number =>
  pieces.reduce((sum, piece, i) => {
    const value = z[i] ?? 0;
    const outside =
      value < piece.lo
        ? piece.lo - value
        : value > piece.hi
          ? value - piece.hi
          : 0;

    return sum + outside * outside + lambda * (value - piece.target) ** 2;
  }, 0);

describe("gpav", () => {
  it("matches brute force on random instances", () => {
    const next = random(7);

    for (let trial = 0; trial < 40; trial++) {
      const pieces: Piece[] = Array.from({ length: 3 }, () => {
        const lo = next() * 80;

        return {
          lo,
          hi: lo + next() * 30,
          target: next() * 100 - 10,
        };
      });

      const solved = gpav(pieces, constants.lambda);
      const mine = objective(pieces, solved, constants.lambda);

      // Dense monotone grid over the whole range in play. A grid can never beat
      // the true optimum, so an optimal GPAV must come in at or below it.
      const steps = 90;
      const lo = -20;
      const hi = 120;
      const at = (i: number): number => lo + ((hi - lo) * i) / steps;

      let bestGrid = Infinity;

      for (let a = 0; a <= steps; a++) {
        for (let b = a; b <= steps; b++) {
          for (let c = b; c <= steps; c++) {
            const value = objective(
              pieces,
              [at(a), at(b), at(c)],
              constants.lambda,
            );

            if (value < bestGrid) {
              bestGrid = value;
            }
          }
        }
      }

      expect(mine).toBeLessThanOrEqual(bestGrid + 1e-9);
    }
  });

  it("returns a nondecreasing chain", () => {
    const next = random(11);

    for (let trial = 0; trial < 50; trial++) {
      const pieces: Piece[] = Array.from({ length: 6 }, () => {
        const lo = next() * 100;

        return { lo, hi: lo + next() * 20, target: next() * 120 - 10 };
      });

      const solved = gpav(pieces, constants.lambda);

      for (let i = 1; i < solved.length; i++) {
        expect(solved[i]).toBeGreaterThanOrEqual((solved[i - 1] ?? 0) - 1e-9);
      }
    }
  });

  it("degenerates to PAVA when every segment is a point", () => {
    // With point segments and an already-sorted chain, the dead zone never
    // engages and each block sits at the λ-weighted target — i.e. the target
    // itself, which is what plain PAVA would return.
    const pieces: Piece[] = [10, 20, 30].map((value) => ({
      lo: value,
      hi: value,
      target: value,
    }));

    const solved = gpav(pieces, constants.lambda);

    expect(solved[0]).toBeCloseTo(10, 6);
    expect(solved[1]).toBeCloseTo(20, 6);
    expect(solved[2]).toBeCloseTo(30, 6);
  });

  it("pools violators to a common value, as PAVA does", () => {
    // Targets that run backwards must pool: the constraint binds, so both land
    // on one value between them.
    const pieces: Piece[] = [
      { lo: 100, hi: 100, target: 100 },
      { lo: 0, hi: 0, target: 0 },
    ];

    const solved = gpav(pieces, constants.lambda);

    expect(solved[0]).toBeCloseTo(solved[1] ?? 0, 6);
  });
});

// A plain vertical stack, the shape every card anatomy story reduces to.
function stack(count: number): Zone[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `zone-${i}`,
    rect: { x: 0, y: i * 60, w: 300, h: 60 },
    depth: 1,
  }));
}

const sizesFor = (zones: Zone[]): Record<string, { w: number; h: number }> =>
  Object.fromEntries(zones.map((zone) => [zone.id, { w: 60, h: 20 }]));

function frameOf(zones: Zone[]): Rect {
  const x = Math.min(...zones.map((z) => z.rect.x));
  const y = Math.min(...zones.map((z) => z.rect.y));
  const right = Math.max(...zones.map((z) => z.rect.x + z.rect.w));
  const bottom = Math.max(...zones.map((z) => z.rect.y + z.rect.h));

  return { x, y, w: right - x, h: bottom - y };
}

const run = (zones: Zone[], overrides = {}): ReturnType<typeof layout> =>
  layout(zones, sizesFor(zones), frameOf(zones), constants, overrides);

function segmentsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const side = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

  return side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0;
}

describe("layout", () => {
  it("is idempotent", () => {
    const zones = stack(5);
    const first = JSON.stringify(run(zones).placed);

    for (let i = 0; i < 50; i++) {
      expect(JSON.stringify(run(zones).placed)).toBe(first);
    }
  });

  it("puts a clean stack in one gutter, in stack order", () => {
    const placed = run(stack(4)).placed;
    const usedSides = new Set(placed.map((item) => item.side));

    expect(usedSides.size).toBe(1);

    const order = placed.map((item) => item.zoneId);

    expect(order).toStrictEqual(["zone-0", "zone-1", "zone-2", "zone-3"]);
  });

  it("keeps label order equal to anchor order on every side", () => {
    const placed = run(stack(6)).placed;

    for (const side of ["top", "right", "bottom", "left"] as const) {
      const onSide = placed.filter((item) => item.side === side);
      const vertical = side === "left" || side === "right";
      const anchors = onSide.map((item) =>
        vertical ? item.anchor.y : item.anchor.x,
      );

      const labels = onSide.map((item) =>
        vertical ? item.label.y : item.label.x,
      );

      for (let i = 1; i < onSide.length; i++) {
        expect(anchors[i]).toBeGreaterThanOrEqual((anchors[i - 1] ?? 0) - 1e-9);
        expect(labels[i]).toBeGreaterThanOrEqual((labels[i - 1] ?? 0) - 1e-9);
      }
    }
  });

  it("draws every fan on a side over one x-interval", () => {
    // The whole crossing-freedom argument rests on this: same domain, so the
    // fans are graphs of functions and order cannot flip.
    const placed = run(stack(5)).placed;

    for (const side of ["top", "right", "bottom", "left"] as const) {
      const onSide = placed.filter((item) => item.side === side);

      if (onSide.length < 2) {
        continue;
      }

      const vertical = side === "left" || side === "right";
      const starts = onSide.map((item) =>
        vertical ? item.points[1]?.x : item.points[1]?.y,
      );

      const ends = onSide.map((item) =>
        vertical ? item.points[2]?.x : item.points[2]?.y,
      );

      expect(new Set(starts).size).toBe(1);
      expect(new Set(ends).size).toBe(1);
    }
  });

  it("produces no leader crossings", () => {
    const placed = run(stack(6)).placed;
    const crossings: string[] = [];

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const p = placed[i]?.points ?? [];
        const q = placed[j]?.points ?? [];

        for (let a = 1; a < p.length; a++) {
          for (let b = 1; b < q.length; b++) {
            const p0 = p[a - 1];
            const p1 = p[a];
            const q0 = q[b - 1];
            const q1 = q[b];

            if (p0 && p1 && q0 && q1 && segmentsCross(p0, p1, q0, q1)) {
              crossings.push(`${placed[i]?.zoneId} x ${placed[j]?.zoneId}`);
            }
          }
        }
      }
    }

    expect(crossings).toStrictEqual([]);
  });

  it("never overlaps two labels", () => {
    const placed = run(stack(6)).placed;

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]?.label;
        const b = placed[j]?.label;

        if (!a || !b) {
          continue;
        }

        const apart =
          a.x + a.w <= b.x + 1e-9 ||
          b.x + b.w <= a.x + 1e-9 ||
          a.y + a.h <= b.y + 1e-9 ||
          b.y + b.h <= a.y + 1e-9;

        expect(apart).toBe(true);
      }
    }
  });

  it("lets an end label overhang the frame into a corner", () => {
    // Rule 11, relaxed. Five 60px labels plus their gaps need 324px of rail and
    // the frame is only 300 wide, so the old inner-width rail could not seat
    // this at all — it would have rejected the side outright. The reserved
    // canvas can, and the end labels pay for it by hanging over the corners.
    const zones = stack(5);
    const overrides = Object.fromEntries(
      zones.map((zone) => [zone.id, { side: "top" as const }]),
    );

    const placed = run(zones, overrides).placed;
    const frame = frameOf(zones);

    expect(placed).toHaveLength(5);

    const leftmost = Math.min(...placed.map((item) => item.label.x));
    const rightmost = Math.max(
      ...placed.map((item) => item.label.x + item.label.w),
    );

    expect(leftmost).toBeLessThan(frame.x);
    expect(rightmost).toBeGreaterThan(frame.x + frame.w);
  });

  it("keeps every label inside the reserved canvas", () => {
    // The rail may run into the corners, but not past the padding the component
    // has already painted into — a label beyond that is a label clipped off the
    // edge of the diagram.
    const zones = stack(5);
    const padding = reservePadding(sizesFor(zones), constants);
    const frame = frameOf(zones);

    for (const side of ["top", "bottom"] as const) {
      const overrides = Object.fromEntries(
        zones.map((zone) => [zone.id, { side }]),
      );

      for (const item of run(zones, overrides).placed) {
        expect(item.label.x).toBeGreaterThanOrEqual(
          frame.x - padding.left - 1e-9,
        );

        expect(item.label.x + item.label.w).toBeLessThanOrEqual(
          frame.x + frame.w + padding.right + 1e-9,
        );
      }
    }
  });

  it("never overlaps two labels across different sides", () => {
    // Hard rule 4, at the corners specifically. Now that a top label may hang
    // over a corner it shares x with the left gutter, so the only thing keeping
    // them apart is the vertical band between the rails. Assert it, rather than
    // trusting the argument in §2.
    const zones = stack(4);
    const placed = run(zones, {
      "zone-0": { side: "top" },
      "zone-1": { side: "left" },
      "zone-2": { side: "right" },
      "zone-3": { side: "bottom" },
    }).placed;

    expect(new Set(placed.map((item) => item.side)).size).toBe(4);

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]?.label;
        const b = placed[j]?.label;

        if (!a || !b) {
          continue;
        }

        const apart =
          a.x + a.w <= b.x + 1e-9 ||
          b.x + b.w <= a.x + 1e-9 ||
          a.y + a.h <= b.y + 1e-9 ||
          b.y + b.h <= a.y + 1e-9;

        expect(apart).toBe(true);
      }
    }
  });

  it("attaches the leader at the anchor, not at the label's midpoint", () => {
    // §4.5. The attachment slides along the label's gutter-facing edge to meet
    // the anchor, staying clear of the chip's corners. Pinned as a property
    // rather than as a hand-computed number: it has to hold for every leader in
    // every arrangement, which is what the crossing-freedom argument leans on.
    const zones = [
      { id: "zone-0", rect: { x: 0, y: 0, w: 300, h: 14 }, depth: 1 },
      { id: "zone-1", rect: { x: 0, y: 14, w: 300, h: 26 }, depth: 1 },
      { id: "zone-2", rect: { x: 0, y: 40, w: 300, h: 120 }, depth: 1 },
      { id: "zone-3", rect: { x: 0, y: 160, w: 300, h: 20 }, depth: 1 },
    ];

    for (const item of run(zones).placed) {
      const vertical = item.side === "left" || item.side === "right";
      const attach = vertical ? item.points[2]?.y : item.points[2]?.x;
      const lo =
        (vertical ? item.label.y : item.label.x) + constants.attachInset;

      const hi =
        (vertical ? item.label.y + item.label.h : item.label.x + item.label.w) -
        constants.attachInset;

      const anchor = vertical ? item.anchor.y : item.anchor.x;

      expect(attach).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(attach).toBeLessThanOrEqual(hi + 1e-9);
      expect(attach).toBeCloseTo(Math.min(Math.max(anchor, lo), hi), 9);
    }
  });

  it("straightens a leader whose label merely overlaps the edge span", () => {
    // The payoff of the sliding attachment. These zones are uneven enough that
    // the labels cannot all sit on their zones' centres, so a midpoint-pinned
    // attachment would leave leaders angled. Overlap is enough now.
    const zones = [
      { id: "zone-0", rect: { x: 0, y: 0, w: 300, h: 14 }, depth: 1 },
      { id: "zone-1", rect: { x: 0, y: 14, w: 300, h: 26 }, depth: 1 },
      { id: "zone-2", rect: { x: 0, y: 40, w: 300, h: 120 }, depth: 1 },
      { id: "zone-3", rect: { x: 0, y: 160, w: 300, h: 20 }, depth: 1 },
    ];

    const placed = run(zones).placed;

    expect(placed).toHaveLength(4);

    for (const item of placed) {
      const vertical = item.side === "left" || item.side === "right";
      const attach = vertical ? item.points[2]?.y : item.points[2]?.x;
      const anchor = vertical ? item.anchor.y : item.anchor.x;

      expect(attach).toBeCloseTo(anchor, 6);
    }
  });

  it("collapses the attachment window for a label thinner than its insets", () => {
    // The degenerate case, and it is the *narrow* label — not the wide one. A
    // label wider than its zone's edge is the case that looks alarming and is in
    // fact fine; only a label thinner than twice the inset leaves no window to
    // slide in. Unreachable with a real chip, so it is pinned here instead.
    const zones = stack(2);
    const sizes = {
      "zone-0": { w: 4, h: 4 },
      "zone-1": { w: 4, h: 4 },
    };

    const placed = layout(zones, sizes, frameOf(zones), constants, {}).placed;

    for (const item of placed) {
      const attach = item.points[2]?.y ?? 0;

      expect(Number.isFinite(attach)).toBe(true);
      expect(attach).toBeCloseTo(item.label.y + item.label.h / 2, 9);
    }
  });

  it("gives a shared span to the deeper zone", () => {
    // The child is flush with its parent's left edge over y 50..150, so on that
    // line the child wins outright: the parent has to anchor above or below it.
    const zones: Zone[] = [
      { id: "parent", rect: { x: 0, y: 0, w: 200, h: 200 }, depth: 1 },
      {
        id: "child",
        rect: { x: 0, y: 50, w: 100, h: 100 },
        depth: 2,
        parentId: "parent",
      },
    ];

    const placed = run(zones, {
      parent: { side: "left" },
      child: { side: "left" },
    }).placed;

    const child = placed.find((item) => item.zoneId === "child");
    const parent = placed.find((item) => item.zoneId === "parent");

    expect(child?.anchor.y).toBeGreaterThanOrEqual(50);
    expect(child?.anchor.y).toBeLessThanOrEqual(150);

    // The parent keeps the line, but only where the child does not cover it.
    const parentY = parent?.anchor.y ?? 0;

    expect(parentY < 50 || parentY > 150).toBe(true);
  });

  it("throws and names the zone when it has no candidate anywhere", () => {
    // A wrapper with zero padding: the child covers all four of its lines and,
    // being deeper, owns every one of them.
    const zones: Zone[] = [
      { id: "wrapper", rect: { x: 0, y: 0, w: 100, h: 100 }, depth: 1 },
      {
        id: "inner",
        rect: { x: 0, y: 0, w: 100, h: 100 },
        depth: 2,
        parentId: "wrapper",
      },
    ];

    expect(() => run(zones)).toThrow(/wrapper/);
  });

  it("throws and names the layout when nothing survives", () => {
    // Two 20px-tall zones pinned to the left. Each has a usable edge, so this
    // is not rule 9 — but two 20px labels plus a gap need 46px of gutter and
    // the frame only offers 40, so every arrangement overflows.
    const zones: Zone[] = [
      { id: "zone-0", rect: { x: 0, y: 0, w: 300, h: 20 }, depth: 1 },
      { id: "zone-1", rect: { x: 0, y: 20, w: 300, h: 20 }, depth: 1 },
    ];

    const overrides = Object.fromEntries(
      zones.map((zone) => [zone.id, { side: "left" as const }]),
    );

    expect(() => run(zones, overrides)).toThrow(/no assignment survives/);
  });

  it("honours a side override", () => {
    const zones = stack(3);
    const placed = run(zones, { "zone-0": { side: "right" } }).placed;

    expect(placed.find((item) => item.zoneId === "zone-0")?.side).toBe("right");
  });

  it("reserves a gutter every label fits inside", () => {
    // The reservation is made before the solve, from the label sizes alone, so
    // it has to bound whatever the solve then does. Anything it fails to cover
    // is a label clipped off the edge of the diagram.
    const zones = stack(5);
    const sizes = sizesFor(zones);
    const padding = reservePadding(sizes, constants);
    const frame = frameOf(zones);
    const placed = run(zones).placed;

    for (const item of placed) {
      expect(frame.x - item.label.x).toBeLessThanOrEqual(padding.left);
      expect(
        item.label.x + item.label.w - (frame.x + frame.w),
      ).toBeLessThanOrEqual(padding.right);

      expect(frame.y - item.label.y).toBeLessThanOrEqual(padding.top);
      expect(
        item.label.y + item.label.h - (frame.y + frame.h),
      ).toBeLessThanOrEqual(padding.bottom);
    }
  });

  it("reserves the same gutter whichever side wins", () => {
    // Padding must not depend on the assignment — that is the whole reason it
    // can be computed before the solve.
    const sizes = sizesFor(stack(3));

    expect(reservePadding(sizes, constants)).toStrictEqual({
      top: constants.sideGap + 20,
      right: constants.sideGap + 60,
      bottom: constants.sideGap + 20,
      left: constants.sideGap + 60,
    });
  });

  it("reserves nothing when there is nothing to label", () => {
    expect(reservePadding({}, constants)).toStrictEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("keeps a navigated level inside the gutter reserved for the whole tree", () => {
    // What drilling down does to this function: the overlay reserves its
    // padding once, from every label it could ever show, and then solves one
    // level at a time — a handful of those zones, with the whole tree's sizes
    // still in the message. The rails `layout` derives must therefore stay put
    // as the reader navigates, because the component has already painted into
    // them and a rail that moved would move the component with it.
    const tree = stack(8);
    const sizes = {
      ...sizesFor(tree),
      // The deep zone nobody has dived into yet, with the longest name in the
      // tree. It is what the padding is for.
      "zone-deep": { w: 140, h: 20 },
    };

    const padding = reservePadding(sizes, constants);

    for (const level of [tree.slice(0, 2), tree.slice(3, 6), tree]) {
      const frame = frameOf(level);
      const { placed } = layout(level, sizes, frame, constants);

      for (const item of placed) {
        expect(frame.x - item.label.x).toBeLessThanOrEqual(padding.left);
        expect(
          item.label.x + item.label.w - (frame.x + frame.w),
        ).toBeLessThanOrEqual(padding.right);
      }
    }
  });

  it("reserves the gutter from every label, not just the ones being placed", () => {
    // The corollary, stated on its own: a subset's reservation is the tree's
    // reservation. If this ever stops holding, the first dive into a
    // long-named slot shifts the diagram under the reader.
    const zones = stack(4);
    const tree = sizesFor(zones);
    const level = sizesFor(zones.slice(1, 3));

    expect(reservePadding(level, constants)).toStrictEqual(
      reservePadding(tree, constants),
    );
  });

  it("skips a hidden zone but still routes around it", () => {
    const zones = stack(3);
    const placed = run(zones, { "zone-1": { hidden: true } }).placed;

    expect(placed.map((item) => item.zoneId).sort()).toStrictEqual([
      "zone-0",
      "zone-2",
    ]);
  });
});

// §9. The regions here are hand-built rather than measured: jsdom lays nothing
// out, and the point is the arithmetic on the rects, not where a browser would
// have put them.
function region(
  name: string,
  depth: number,
  box: [number, number, number, number],
): Region {
  const [left, top, width, height] = box;

  return {
    name,
    id: name,
    depth,
    left,
    top,
    width,
    height,
    radius: "0px",
    radii: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
    el: document.createElement("div"),
  };
}

const rectOf = (zones: Zone[], id: string): Rect | undefined =>
  zones.find((zone) => zone.id === id)?.rect;

describe("toZones", () => {
  it("draws a zone with clearance exactly on its element", () => {
    // The common case, and the one the old unconditional inset got wrong: a
    // nested zone with room around it was displaced anyway.
    const zones = toZones(
      [
        region("outer", 1, [0, 0, 200, 100]),
        region("inner", 2, [10, 10, 50, 50]),
      ],
      constants,
    );

    expect(rectOf(zones, "outer")).toStrictEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });

    expect(rectOf(zones, "inner")).toStrictEqual({
      x: 10,
      y: 10,
      w: 50,
      h: 50,
    });
  });

  it("steps the container outward and leaves the inner zone alone", () => {
    // A child flush on the left only. The container gives way there and nowhere
    // else; the child keeps its geometry, because it is the one with content in
    // it and the one being pointed at.
    const zones = toZones(
      [
        region("outer", 1, [0, 0, 200, 100]),
        region("inner", 2, [0, 10, 50, 50]),
      ],
      constants,
    );

    expect(rectOf(zones, "outer")).toStrictEqual({
      x: -1,
      y: 0,
      w: 201,
      h: 100,
    });

    expect(rectOf(zones, "inner")).toStrictEqual({ x: 0, y: 10, w: 50, h: 50 });
  });

  it("ignores a shared line the two zones never share a pixel of", () => {
    // `body`'s left edge sits on the same x as `button-primary`'s, hundreds of
    // pixels apart. One line, never one border — and rule 2 subtracts nothing
    // either, because it subtracts spans.
    const zones = toZones(
      [
        region("body", 1, [0, 0, 200, 40]),
        region("footer", 1, [0, 60, 200, 40]),
        region("button", 2, [0, 70, 50, 20]),
      ],
      constants,
    );

    expect(rectOf(zones, "body")).toStrictEqual({ x: 0, y: 0, w: 200, h: 40 });
    // The footer really does share a border with the button, so it gives way.
    expect(rectOf(zones, "footer")?.x).toBe(-1);
  });

  it("separates a chain of flush containers in a single pass", () => {
    // The cascade. Ranks come out 2, 1, 0 and every pair on the line ends up a
    // pixel apart, with no iteration and nothing to converge.
    const zones = toZones(
      [
        region("a", 1, [0, 0, 200, 100]),
        region("b", 2, [0, 0, 150, 80]),
        region("c", 3, [0, 0, 100, 60]),
      ],
      constants,
    );

    expect(rectOf(zones, "a")?.x).toBe(-2);
    expect(rectOf(zones, "b")?.x).toBe(-1);
    expect(rectOf(zones, "c")?.x).toBe(0);

    for (const side of ["x", "y"] as const) {
      const coords = ["a", "b", "c"].map(
        (id) => rectOf(zones, id)?.[side] ?? 0,
      );

      expect(new Set(coords).size).toBe(3);
    }
  });

  it("never moves same-depth zones for each other", () => {
    // Two `attribute` slots sharing a top edge are side by side, not nested.
    // Neither hides the other's border, and §3's tier 1 already prices the
    // ambiguity.
    const zones = toZones(
      [region("one", 2, [0, 0, 50, 20]), region("two", 2, [60, 0, 50, 20])],
      constants,
    );

    expect(rectOf(zones, "one")).toStrictEqual({ x: 0, y: 0, w: 50, h: 20 });
    expect(rectOf(zones, "two")).toStrictEqual({ x: 60, y: 0, w: 50, h: 20 });
  });

  it("keeps the title level labellable, which is what §9 is for", () => {
    // The exact shape that used to throw: a container with two children flush
    // on all four of its lines between them. Rule 2 would subtract every span
    // it has and rule 9 would fire by name.
    const regions = [
      region("title", 1, [0, 0, 100, 40]),
      region("text", 2, [0, 0, 100, 20]),
      region("subtitle", 2, [0, 20, 100, 20]),
    ];

    expect(() =>
      layout(
        toZones(regions, constants),
        sizesFor(toZones(regions, constants)),
        frameOf(toZones(regions, constants)),
        constants,
      ),
    ).not.toThrow();

    // …and it stays labellable by moving the container, not the children.
    const zones = toZones(regions, constants);

    expect(rectOf(zones, "text")).toStrictEqual({ x: 0, y: 0, w: 100, h: 20 });
    expect(rectOf(zones, "subtitle")).toStrictEqual({
      x: 0,
      y: 20,
      w: 100,
      h: 20,
    });

    expect(rectOf(zones, "title")).toStrictEqual({
      x: -1,
      y: -1,
      w: 102,
      h: 42,
    });
  });

  it("throws on the title level with no inset at all, which is why §9 stays", () => {
    // The inset is conditional now, and that makes it look optional. It is not:
    // turn it off and this level is unlabellable, exactly as §9 says. Rule 2
    // hands every one of `title`'s spans to its children and rule 9 fires by
    // name. Nothing about narrowing the inset to the edges that need it made
    // this any less true.
    const regions = [
      region("title", 1, [0, 0, 100, 40]),
      region("text", 2, [0, 0, 100, 20]),
      region("subtitle", 2, [0, 20, 100, 20]),
    ];

    const off: Constants = { ...constants, depthInset: 0 };
    const zones = toZones(regions, off);

    expect(() => layout(zones, sizesFor(zones), frameOf(zones), off)).toThrow(
      /zone "title" has no candidate segments/,
    );
  });

  it("is a pure function of the regions", () => {
    const regions = [
      region("a", 1, [0, 0, 200, 100]),
      region("b", 2, [0, 0, 150, 80]),
    ];

    const first = JSON.stringify(toZones(regions, constants));

    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(toZones(regions, constants))).toBe(first);
    }
  });
});
