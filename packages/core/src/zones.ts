import type { Region } from "./collect-regions";
import type {
  Constants,
  PlacedFrameData,
  PlacedLabelData,
  PlacementData,
  Zone,
} from "./place-labels";
import { anatomyConstants, outwardNudges } from "./place-labels";

// Worker seam: a `Region`'s `el` can't be structured-cloned across the
// boundary, so `toZones` strips it; `attachRegions` re-attaches positionally.

export interface PlacedLabel extends PlacedLabelData {
  region: Region;
}

export interface PlacedFrame extends PlacedFrameData {
  region: Region;
}

export interface Placement {
  labels: PlacedLabel[];
  frames: PlacedFrame[];
}

// The §9 depth inset is applied only where edges actually coincide; a zone with
// clearance renders on its element to the pixel.
export function toZones(
  regions: Region[],
  constants: Constants = anatomyConstants,
): Zone[] {
  // Decided once on true geometry, not iterated to a fixpoint (§6 forbids
  // convergence loops); a nudge hiding a border makes rule 9 fire.
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

// Positional, because `toZones` is: the nth zone is the nth region.
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
