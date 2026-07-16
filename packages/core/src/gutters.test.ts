import { describe, expect, it } from "vitest";

import { fitPadding } from "./gutters";
import type { PlacedLabelData, Rect } from "./place-labels";

describe("fitPadding", () => {
  // The content box every case measures overhang against.
  const content: Rect = { x: 0, y: 0, w: 200, h: 100 };

  const placedLabel = (over: Partial<PlacedLabelData>): PlacedLabelData => ({
    index: 0,
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

    expect(fitPadding(placement, content)).toStrictEqual({
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

    expect(fitPadding(placement, content).right).toBe(60);
  });

  it("reserves nothing for an empty placement", () => {
    expect(fitPadding({ labels: [], frames: [] }, content)).toStrictEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});
