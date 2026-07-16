import type { Region } from "./collect-regions";

// The pure algebra over a collected region tree: identity, parent/child
// navigation, and the Views cut from it. It makes no DOM *calls* — but a
// `Region` still carries its `el`, which every function here threads through
// untouched. The handle is dropped only at `toZones` (solve/zones), where
// geometry crosses to the solve as pure `Zone` data.

// One comparator per `Region` field, typed as a total map over `keyof Region`:
// adding a field to `Region` fails the build until it is compared here, so the
// gate can never again fall behind the shape it guards. `el` is identity
// (navigation holds ids across renders); `radii` is per-corner — the numbers
// `toZones` forwards to the solve, so a radii-only change (the shorthand
// `radius` can collapse and miss it) must still count as a change.
const fieldComparators: {
  [K in keyof Region]-?: (a: Region[K], b: Region[K]) => boolean;
} = {
  el: (a, b) => a === b,
  name: (a, b) => a === b,
  id: (a, b) => a === b,
  depth: (a, b) => a === b,
  parentId: (a, b) => a === b,
  top: (a, b) => a === b,
  left: (a, b) => a === b,
  width: (a, b) => a === b,
  height: (a, b) => a === b,
  radius: (a, b) => a === b,
  radii: (a, b) =>
    a.topLeft === b.topLeft &&
    a.topRight === b.topRight &&
    a.bottomLeft === b.bottomLeft &&
    a.bottomRight === b.bottomRight,
};

const regionFields = Object.keys(fieldComparators) as (keyof Region)[];

// Compares `id`: navigation holds ids across renders, and a silent positional
// shift would strand it. Keeps state identity stable to avoid a render loop.
export function regionsEqual(a: Region[], b: Region[]): boolean {
  return (
    a.length === b.length &&
    a.every((region, index) => {
      const other = b[index];

      if (other === undefined) {
        return false;
      }

      return regionFields.every((key) =>
        (fieldComparators[key] as (x: unknown, y: unknown) => boolean)(
          region[key],
          other[key],
        ),
      );
    })
  );
}

export function childrenOf(
  regions: Region[],
  parentId: string | null,
): Region[] {
  return regions.filter((region) =>
    parentId === null
      ? region.parentId === undefined
      : region.parentId === parentId,
  );
}

export function hasChildren(regions: Region[], id: string): boolean {
  return regions.some((region) => region.parentId === id);
}

export function pathTo(regions: Region[], id: string | null): Region[] {
  const byId = new Map(regions.map((region) => [region.id, region]));
  const path: Region[] = [];
  let current = id === null ? undefined : byId.get(id);

  while (current) {
    path.unshift(current);
    current =
      current.parentId === undefined ? undefined : byId.get(current.parentId);
  }

  return path;
}

// A view's shallowest members must sit at depth 1: every consumer of `depth`
// (rule 2 ownership, §9 inset) reasons within the view, not the tree.
function rebase(regions: Region[], base: number, keep: Set<string>): Region[] {
  return regions.map(({ parentId, ...region }) => ({
    ...region,
    depth: region.depth - base + 1,
    ...(parentId !== undefined && keep.has(parentId) ? { parentId } : {}),
  }));
}

export function selectDepth(regions: Region[], maxDepth: number): Region[] {
  return regions.filter((region) => region.depth <= maxDepth);
}

export function selectLevel(
  regions: Region[],
  activeId: string | null,
): Region[] {
  if (activeId === null) {
    return selectDepth(regions, 1);
  }

  const active = regions.find((region) => region.id === activeId);

  if (!active) {
    return selectDepth(regions, 1);
  }

  const level = [active, ...childrenOf(regions, activeId)];

  return rebase(level, active.depth, new Set([activeId]));
}

export function siblingsOf(regions: Region[], activeId: string): Region[] {
  const active = regions.find((region) => region.id === activeId);

  if (!active) {
    return [];
  }

  const siblings = childrenOf(regions, active.parentId ?? null).filter(
    (region) => region.id !== activeId,
  );

  return rebase(siblings, active.depth, new Set());
}
