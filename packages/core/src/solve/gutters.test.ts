import { describe, expect, it } from "vitest";

import { anatomyConstants } from "../constants";
import type { Rect, Zone } from "../geometry";

import { fit, reserve } from "./gutters";
import type { PlacedLabelData } from "./place-labels";
import { placeZones } from "./place-labels";

describe("fit", () => {
  // The content box every case measures overhang against.
  const content: Rect = { x: 0, y: 0, w: 200, h: 100 };

  const placedLabel = (over: Partial<PlacedLabelData>): PlacedLabelData => ({
    zoneId: "z",
    side: "left",
    anchorX: 0,
    anchorY: 0,
    labelLeft: 0,
    labelTop: 0,
    labelWidth: 0,
    points: [],
    ...over,
  });

  it("reserves padding only on the side a label overhangs, ceil'd", () => {
    const placement = {
      labels: [
        placedLabel({
          labelLeft: -59.2,
          labelTop: 40,
          labelWidth: 50,
          points: [{ x: 0, y: 50 }],
        }),
      ],
      frames: [],
    };

    expect(fit(placement, content)).toStrictEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 60,
    });
  });

  it("covers the farthest of the label edge and its leader points", () => {
    const placement = {
      labels: [
        placedLabel({
          side: "right",
          labelLeft: 210,
          labelTop: 40,
          labelWidth: 40,
          points: [
            { x: 200, y: 50 },
            { x: 260, y: 50 },
          ],
        }),
      ],
      frames: [],
    };

    expect(fit(placement, content).right).toBe(60);
  });

  it("reserves nothing for an empty placement", () => {
    expect(fit({ labels: [] }, content)).toStrictEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

// The two bounds must agree: the fitted gutter is only ever a tightening of the
// reserved one, because the solve clamps every label inside the reserved gutter
// around the frame. If this ever fails, a fitted overlay would crop a label.
describe("reserve ≥ fit", () => {
  const sides = ["top", "right", "bottom", "left"] as const;

  const cases: {
    name: string;
    zones: Zone[];
    labelSizes: Record<string, { w: number; h: number }>;
  }[] = [
    {
      name: "two sibling leaves",
      zones: [
        { id: "a", rect: { x: 0, y: 0, w: 100, h: 40 }, depth: 1 },
        { id: "b", rect: { x: 0, y: 60, w: 100, h: 40 }, depth: 1 },
      ],
      labelSizes: { a: { w: 60, h: 20 }, b: { w: 48, h: 20 } },
    },
    {
      name: "a nested zone",
      zones: [
        { id: "outer", rect: { x: 0, y: 0, w: 160, h: 120 }, depth: 1 },
        { id: "inner", rect: { x: 20, y: 20, w: 80, h: 40 }, depth: 2 },
      ],
      labelSizes: { outer: { w: 72, h: 20 }, inner: { w: 40, h: 20 } },
    },
  ];

  it.each(cases)(
    "the reserved gutter contains the fitted one ($name)",
    ({ zones, labelSizes }) => {
      const placement = placeZones(zones, labelSizes);

      const left = Math.min(...zones.map((zone) => zone.rect.x));
      const top = Math.min(...zones.map((zone) => zone.rect.y));
      const right = Math.max(...zones.map((zone) => zone.rect.x + zone.rect.w));
      const bottom = Math.max(
        ...zones.map((zone) => zone.rect.y + zone.rect.h),
      );
      const frame: Rect = { x: left, y: top, w: right - left, h: bottom - top };

      const fitted = fit(placement, frame);
      const reserved = reserve(labelSizes, anatomyConstants);

      for (const side of sides) {
        expect(fitted[side]).toBeLessThanOrEqual(reserved[side]);
      }
    },
  );
});
