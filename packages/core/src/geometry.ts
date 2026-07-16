// Spatial vocabulary shared across collection, solve, and overlay. No DOM.

// Order is load-bearing: search bitmasks index into it (§6).
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

export interface Zone {
  id: string;
  rect: Rect;
  depth: number;
  parentId?: string;
  radii?: CornerRadii;
}
