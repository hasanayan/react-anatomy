// Pure DOM discovery for the slot-annotations overlay. Given a rendered tree, it
// finds every `data-slot` element under the scope and captures its geometry
// relative to the overlay root, so the overlay can draw frames without knowing
// anything about the components involved.
//
// Collection is deliberately unfiltered: it reports the whole tree, and the
// selectors below decide which slice of it a view labels. The two were once the
// same step — `collectRegions` took a `maxDepth` — and drill-down is what pulled
// them apart. Navigating needs to know what is *below* the slots on screen in
// order to offer the dive at all, which a depth-filtered collection cannot say.
// So depth became a view concern, and this file went back to answering only
// "what is there?".

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

export interface Region {
  name: string;
  // Stable within one collection: `name` alone repeats (a heading can carry two
  // `attribute` slots), and both the placer and the navigation need to tell
  // them apart.
  id: string;
  // Nesting level below the scope: 1 for direct slots, 2 for slots inside
  // those, and so on. A selector rebases this, so what a zone sees is its depth
  // *within the view*, not within the tree.
  depth: number;
  // The nearest enclosing region. In a collection this is the true DOM parent;
  // in a view it is the parent only if the parent is in the view too. The
  // placer uses it to excuse the crossings a nested region's leader cannot
  // avoid, and the navigation uses it to walk up.
  parentId?: string;
  top: number;
  left: number;
  width: number;
  height: number;
  radius: string;
  // The same radii as numbers, per corner. `radius` is for rendering; these are
  // for deciding how far in from each end of an edge an anchor has to sit, and
  // that has to be per edge — a square zone should not pay for a radius it
  // doesn't have.
  radii: CornerRadii;
  el: HTMLElement;
}

// Whether two collections describe the same regions. Used to keep state
// identity stable across re-measurements, so the observers that fire on every
// measurement don't feed a render loop.
//
// It compares the tree, not just the labelled slice — which it did not have to
// think about before, because the slice was all that was ever collected. Now
// that the whole tree is state, a slot appearing three levels down is a real
// change even when nothing on screen moves: it is a dive that has just become
// available. `id` is compared for the same reason. It is positional, so it is
// implied by the element order — but the navigation holds ids across renders,
// and an equality that lets one shift silently would strand it.
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

// How many `data-slot` levels below the scope `el` sits: 1 when the scope is
// its nearest slot ancestor, 2 one level deeper, and so on. Null when `el` is
// not under `scopeEl` at all (with no scope, the walk terminates at `root`).
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

// A computed corner radius as a number. The longhand properties are read rather
// than the `borderRadius` shorthand because the shorthand collapses to forms
// like "8px 8px 0 0" — and an elliptical corner reads as "8px 4px", of which
// only the first figure bounds the edge we care about.
function cornerRadius(style: CSSStyleDeclaration, corner: string): number {
  const parsed = Number.parseFloat(style.getPropertyValue(corner));

  return Number.isFinite(parsed) ? parsed : 0;
}

// Every `data-slot` under `scopeEl` (or under the root, when no scope is
// given), in document order, with its geometry and its place in the tree.
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

  // Ids are positional, so a repeated slot name still resolves to one region.
  const ids = new Map<HTMLElement, string>(
    found.map(({ el }, index) => [el, `${el.dataset["slot"] ?? ""}-${index}`]),
  );

  // The nearest collected ancestor. Walking the DOM rather than comparing rects
  // keeps this honest when a child is inset from its parent — or, thanks to the
  // depth inset, always is.
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

// ── views over the tree ─────────────────────────────────────────────────────

// The regions directly inside `parentId`, or the outermost ones when it is
// null. The tree relation, not a depth comparison: a view rebases depth, and
// only `parentId` survives that untouched.
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

// The chain from the outermost region down to `id`, inclusive. What the
// breadcrumbs read out, and it walks `parentId` rather than trusting a stored
// path: the tree is re-measured constantly and the path has to be a fact about
// the current one, not a memory of an older one.
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

// A view's depths are its own. Both selectors below hand the placer a set whose
// shallowest members sit at depth 1, whatever they were in the tree, because
// every consumer of `depth` is asking a question about the view: rule 2's
// ownership is decided among the zones actually drawn, and §9's inset pulls each
// level in relative to the one containing it. Passing tree depths through would
// make a dive four levels down render with a 3px inset it did not earn, and
// nothing on screen would explain why.
function rebase(regions: Region[], base: number, keep: Set<string>): Region[] {
  return regions.map(({ parentId, ...region }) => ({
    ...region,
    depth: region.depth - base + 1,
    ...(parentId !== undefined && keep.has(parentId) ? { parentId } : {}),
  }));
}

// The static view: every region within `maxDepth` of the scope. Pass Infinity
// for the whole tree. Depths already count from the scope, so nothing is
// rebased — this is the set the overlay has always labelled.
export function selectDepth(regions: Region[], maxDepth: number): Region[] {
  return regions.filter((region) => region.depth <= maxDepth);
}

// The navigable view: the active region as container, plus the regions directly
// inside it. At the root there is no container and the view is the outermost
// slots — which is the one level with nothing drawn around it, and the reason
// the `boundary` option exists.
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

// The regions alongside the active one — the level it was reached from. Drawn,
// but unlabelled and pushed back: they are where the reader just came from, and
// showing them keeps the dive from feeling like a teleport. Rebased to the
// active region's own depth, since that is the level they share.
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
