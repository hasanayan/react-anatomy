// Reads every `data-slot` in the live DOM into a flat, unfiltered `Region[]`.
// The tree navigation and view selection over that array live in `region-tree`.

import type { CornerRadii } from "../geometry";

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
