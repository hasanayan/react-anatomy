import type { PlacementData, Rect, SidePadding } from "./place-labels";
import { labelHeight } from "./place-labels";
import type { Placement } from "./zones";

// Fits the gutter to a solved placement. Safe only because the fitted overlay
// withholds its reveal until this is applied; else the component moves.
// Overhang is beyond `content` (measurement-root box, not zones' bounds);
// leader `points` count too, so a fan past its label is never clipped.
// eslint-disable-next-line import/prefer-default-export -- barrel re-exports this by name
export function fitPadding(
  placement: Placement | PlacementData,
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
