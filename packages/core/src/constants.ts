// The overlay's single tuning table — one locus so a solve, its reserved
// gutter, and its depth insets can't drift apart.

export interface Constants {
  gap: number;
  minRun: number;
  stubCap: number;
  depthInset: number;
  sideGap: number;
  attachInset: number;
  alpha: number;
  // Strict-convexity term, not an epsilon: a flat dead-zone optimum is a set,
  // not a point, so the snapshot flakes. §4.2.
  lambda: number;
  weights: { residual: number; length: number; imbalance: number };
}

export const anatomyConstants: Constants = {
  gap: 6,
  minRun: 8,
  stubCap: 2,
  depthInset: 1,
  sideGap: 28,
  // Chip corner radius is 3, so 4 clears it by a pixel.
  attachInset: 4,
  alpha: 1,
  lambda: 3,
  weights: { residual: 1, length: 0.01, imbalance: 20 },
};
