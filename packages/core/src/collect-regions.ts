// Collection is unfiltered; the selectors below choose a view's slice.

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

export interface Region {
  name: string;
  // Positional and unique within a collection; `name` alone repeats.
  id: string;
  // Levels below the scope, 1 for direct slots. A view rebases this.
  depth: number;
  parentId?: string;
  top: number;
  left: number;
  width: number;
  height: number;
  radius: string; // for rendering
  radii: CornerRadii; // per-corner numbers, for anchor insets
  el: HTMLElement;
}

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

      return (
        region.el === other.el &&
        region.name === other.name &&
        region.id === other.id &&
        region.depth === other.depth &&
        region.parentId === other.parentId &&
        region.top === other.top &&
        region.left === other.left &&
        region.width === other.width &&
        region.height === other.height &&
        region.radius === other.radius
      );
    })
  );
}

function slotDepth(
  el: HTMLElement,
  root: HTMLElement,
  scopeEl: HTMLElement | null,
): number | null {
  let depth = 1;
  let parent = el.parentElement;

  while (parent && parent !== root) {
    if (parent === scopeEl) {
      return depth;
    }

    if (parent.hasAttribute("data-slot")) {
      depth += 1;
    }

    parent = parent.parentElement;
  }

  return scopeEl ? null : depth;
}

// Read longhand, not the `borderRadius` shorthand: the shorthand collapses to
// forms like "8px 8px 0 0", and an elliptical corner reads as "8px 4px".
function cornerRadius(style: CSSStyleDeclaration, corner: string): number {
  const parsed = Number.parseFloat(style.getPropertyValue(corner));

  return Number.isFinite(parsed) ? parsed : 0;
}

export function collectRegions(root: HTMLElement, scope?: string): Region[] {
  const scopeEl = scope
    ? root.querySelector<HTMLElement>(`[data-slot=${scope}]`)
    : null;

  const rootRect = root.getBoundingClientRect();

  const found = [...root.querySelectorAll<HTMLElement>("[data-slot]")].flatMap(
    (el) => {
      if (el === scopeEl) {
        return [];
      }

      const depth = slotDepth(el, root, scopeEl);

      return depth === null ? [] : [{ el, depth }];
    },
  );

  // Positional ids, so a repeated slot name still resolves to one region.
  const ids = new Map<HTMLElement, string>(
    found.map(({ el }, index) => [el, `${el.dataset["slot"] ?? ""}-${index}`]),
  );

  // Nearest collected ancestor by DOM walk, not rect containment.
  const parentOf = (el: HTMLElement): string | undefined => {
    let parent = el.parentElement;

    while (parent && parent !== root) {
      const id = ids.get(parent);

      if (id !== undefined) {
        return id;
      }

      parent = parent.parentElement;
    }

    return undefined;
  };

  return found.map(({ el, depth }) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const parentId = parentOf(el);

    return {
      name: el.dataset["slot"] ?? "",
      id: ids.get(el) ?? "",
      depth,
      ...(parentId === undefined ? {} : { parentId }),
      top: rect.top - rootRect.top,
      left: rect.left - rootRect.left,
      width: rect.width,
      height: rect.height,
      radius: style.borderRadius,
      radii: {
        topLeft: cornerRadius(style, "border-top-left-radius"),
        topRight: cornerRadius(style, "border-top-right-radius"),
        bottomLeft: cornerRadius(style, "border-bottom-left-radius"),
        bottomRight: cornerRadius(style, "border-bottom-right-radius"),
      },
      el,
    };
  });
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
