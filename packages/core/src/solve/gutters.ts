import type { Constants } from "../constants";
import type { Point, Rect } from "../geometry";
import { labelHeight } from "../label-metrics";
import type { LabelSize } from "../label-metrics";

// The Gutter reserved on each side of the frame, sized so the component never
// moves. `reserve` is the conservative up-front bound the solve clamps labels
// into (§4.2); `fit` is the tight post-solve bound the fitted overlay cuts to
// once it has withheld its reveal. Same concept, two bounds — one module so
// they can't drift, and `reserve` ≥ `fit` always holds because every label is
// placed inside the reserved gutter (`gutters.test.ts` pins this).

export interface SidePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Gutter per side, an *input* to §4.2's clamp, not read back off its output, so
// padding is final before paint. Pass the whole tree's labels for a navigable
// overlay, so the bound doesn't change as the reader moves (§10).
export function reserve(
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

// Just the label geometry `fit` measures — a structural subset of a Placement,
// so the gutter never imports the solve's output types (which would cycle back
// through `place-labels`, which imports `reserve`).
interface FittableLabel {
  labelLeft: number;
  labelTop: number;
  labelWidth: number;
  points: readonly Point[];
}

// Fits the gutter to a solved placement. Safe only because the fitted overlay
// withholds its reveal until this is applied; else the component moves.
// Overhang is beyond `content` (measurement-root box, not zones' bounds);
// leader `points` count too, so a fan past its label is never clipped.
export function fit(
  placement: { labels: readonly FittableLabel[] },
  content: Rect,
): SidePadding {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const label of placement.labels) {
    xs.push(label.labelLeft, label.labelLeft + label.labelWidth);
    ys.push(label.labelTop, label.labelTop + labelHeight);

    for (const point of label.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }

  if (xs.length === 0) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const overhang = (value: number): number => Math.max(0, Math.ceil(value));

  return {
    top: overhang(content.y - Math.min(...ys)),
    right: overhang(Math.max(...xs) - (content.x + content.w)),
    bottom: overhang(Math.max(...ys) - (content.y + content.h)),
    left: overhang(content.x - Math.min(...xs)),
  };
}
