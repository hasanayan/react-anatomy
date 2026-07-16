import { describe, expect, it } from "vitest";

import { anatomyConstants } from "../constants";
import type { Constants } from "../constants";
import type { Rect, Zone } from "../geometry";
import type { Region } from "../regions/collect-regions";

import { reserve } from "./gutters";
import type { Overrides, Piece } from "./place-labels";
import { gpav, layout, placeZones } from "./place-labels";
import type { Placement } from "./zones";
import { attachRegions, toZones } from "./zones";

// §8.

const constants: Constants = anatomyConstants;

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

      // A grid can never beat the true optimum, so optimal GPAV must be ≤ it.
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
    const pieces: Piece[] = [
      { lo: 100, hi: 100, target: 100 },
      { lo: 0, hi: 0, target: 0 },
    ];

    const solved = gpav(pieces, constants.lambda);

    expect(solved[0]).toBeCloseTo(solved[1] ?? 0, 6);
  });
});

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
    // Rule 11: 5×60px labels + gaps need 324px of rail; frame is 300, so the
    // ends overhang the corners.
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
    const zones = stack(5);
    const padding = reserve(sizesFor(zones), constants);
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
    // Rule 4 at the corners: a top label may overhang a corner and share x with
    // the left gutter; only the band between the rails keeps them apart.
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
    // §4.5. The attachment slides along the label's gutter-facing edge to the
    // anchor, staying clear of the chip's corners.
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
    // Unreachable with a real chip: only a label thinner than twice the inset
    // leaves no window to slide in.
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
    // Child flush with the parent's left edge over y 50..150; there it wins, so
    // the parent must anchor above or below.
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

    const parentY = parent?.anchor.y ?? 0;

    expect(parentY < 50 || parentY > 150).toBe(true);
  });

  it("throws and names the zone when it has no candidate anywhere", () => {
    // Zero-padding wrapper: the deeper child covers and owns all four lines.
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
    // Not rule 9 (each edge is usable): two 20px labels plus a gap need 46px of
    // gutter but the frame offers 40, so every arrangement overflows.
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
    const zones = stack(5);
    const sizes = sizesFor(zones);
    const padding = reserve(sizes, constants);
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
    const sizes = sizesFor(stack(3));

    expect(reserve(sizes, constants)).toStrictEqual({
      top: constants.sideGap + 20,
      right: constants.sideGap + 60,
      bottom: constants.sideGap + 20,
      left: constants.sideGap + 60,
    });
  });

  it("reserves nothing when there is nothing to label", () => {
    expect(reserve({}, constants)).toStrictEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("keeps a navigated level inside the gutter reserved for the whole tree", () => {
    // Padding is reserved once from every label; solving one level at a time,
    // with the whole tree's sizes still passed, must not move the rails.
    const tree = stack(8);
    const sizes = {
      ...sizesFor(tree),
      // The deepest, longest-named zone — what the padding is sized for.
      "zone-deep": { w: 140, h: 20 },
    };

    const padding = reserve(sizes, constants);

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
    const zones = stack(4);
    const tree = sizesFor(zones);
    const level = sizesFor(zones.slice(1, 3));

    expect(reserve(level, constants)).toStrictEqual(reserve(tree, constants));
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

// §9. Hand-built rects: jsdom lays nothing out; the point is the arithmetic.
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
    // Same x, hundreds of px apart: one line, never one border — and rule 2
    // subtracts spans, so it subtracts nothing here.
    const zones = toZones(
      [
        region("body", 1, [0, 0, 200, 40]),
        region("footer", 1, [0, 60, 200, 40]),
        region("button", 2, [0, 70, 50, 20]),
      ],
      constants,
    );

    expect(rectOf(zones, "body")).toStrictEqual({ x: 0, y: 0, w: 200, h: 40 });
    expect(rectOf(zones, "footer")?.x).toBe(-1);
  });

  it("separates a chain of flush containers in a single pass", () => {
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
    // Two slots sharing a top edge are side by side; neither hides the other's
    // border, and §3 tier 1 already prices the ambiguity.
    const zones = toZones(
      [region("one", 2, [0, 0, 50, 20]), region("two", 2, [60, 0, 50, 20])],
      constants,
    );

    expect(rectOf(zones, "one")).toStrictEqual({ x: 0, y: 0, w: 50, h: 20 });
    expect(rectOf(zones, "two")).toStrictEqual({ x: 60, y: 0, w: 50, h: 20 });
  });

  it("keeps the title level labellable, which is what §9 is for", () => {
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
    // Inset off: rule 2 hands `title`'s spans to its children, rule 9 fires.
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

// `attachRegions` re-attaches regions positionally (nth zone = nth region), so
// `toZones` order must survive to the re-attach. Runs the real
// `toZones → placeZones → attachRegions` and asserts `region.id == zoneId`.

const labelSizesFor = (
  set: Region[],
): Record<string, { w: number; h: number }> =>
  Object.fromEntries(set.map((item) => [item.id, { w: 48, h: 20 }]));

const pipeline = (set: Region[], overrides: Overrides = {}): Placement =>
  attachRegions(
    placeZones(
      toZones(set, constants),
      labelSizesFor(set),
      overrides,
      constants,
    ),
    set,
  );

describe("the Solve→Placement composition", () => {
  // Ids deliberately not in geometric order, so a sort keyed on either would
  // surface as a mismatch.
  const media = region("media", 1, [0, 0, 120, 40]);
  const body = region("body", 1, [0, 80, 120, 40]);
  const footer = region("footer", 1, [0, 160, 120, 40]);

  it("hands every placed item the region whose geometry the solve placed", () => {
    const permutations: Region[][] = [
      [media, body, footer],
      [footer, media, body],
    ];

    for (const set of permutations) {
      const placement = pipeline(set);

      expect(placement.frames).toHaveLength(set.length);
      expect(placement.labels).toHaveLength(set.length);

      for (const label of placement.labels) {
        expect(label.region.id).toBe(label.zoneId);
      }

      for (const frame of placement.frames) {
        expect(frame.region.id).toBe(frame.zoneId);
      }

      expect(
        placement.frames.map((frame) => frame.region.id).sort(),
      ).toStrictEqual(set.map((item) => item.id).sort());
    }
  });

  it("re-attaches by id, so a shuffled region array still pairs correctly", () => {
    const set = [media, body, footer];
    const data = placeZones(
      toZones(set, constants),
      labelSizesFor(set),
      {},
      constants,
    );

    const shuffled = attachRegions(data, [footer, media, body]);

    expect(
      shuffled.frames.every((frame) => frame.region.id === frame.zoneId),
    ).toBe(true);
    expect(
      shuffled.labels.every((label) => label.region.id === label.zoneId),
    ).toBe(true);
  });

  it("rides a hidden zone through as a frame with no label, still on its region", () => {
    const set = [media, body, footer];
    const placement = pipeline(set, { [body.id]: { hidden: true } });

    expect(placement.labels.map((label) => label.zoneId)).not.toContain(
      body.id,
    );
    expect(placement.frames.map((frame) => frame.zoneId)).toStrictEqual(
      set.map((item) => item.id),
    );

    for (const frame of placement.frames) {
      expect(frame.region.id).toBe(frame.zoneId);
    }

    for (const label of placement.labels) {
      expect(label.region.id).toBe(label.zoneId);
    }
  });
});
