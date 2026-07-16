import type { PlacedLabel } from "./zones";

// Rounds drawn points (§6); the solve itself stays in reals.
const round = (value: number): number => Math.round(value * 100) / 100;

// eslint-disable-next-line import/prefer-default-export -- barrel re-exports this by name
export function leaderPath(label: PlacedLabel): string {
  return label.points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`,
    )
    .join(" ");
}
