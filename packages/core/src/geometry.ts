// Pure spatial vocabulary shared across collection, the solve, and the overlay:
// no DOM, no behaviour, just the shapes geometry travels in.

// Order is load-bearing where sides are searched: bitmasks index into it (§6).
export type Side = "top" | "right" | "bottom" | "left";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

// A region reduced to pure data — id, rect, depth, radii — with no DOM handle:
// the form in which geometry crosses to the solve (`CONTEXT.md`: Zone).
export interface Zone {
  id: string;
  rect: Rect;
  depth: number;
  parentId?: string;
  radii?: CornerRadii;
}
