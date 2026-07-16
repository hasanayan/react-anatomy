// The Label chip's fixed metrics, and the type its measured size travels in.
// Kept apart from both the solve (which reserves against the size) and the DOM
// measurer (which produces it), so neither module owns the other's constant.

export const labelHeight = 20;

// Must match the offscreen measurer's font, else reserved width won't match the
// box. Var may resolve to a late web font; `whenLabelFontReady` gates measure.
export const labelFont =
  "600 10px/1.5 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

export interface LabelSize {
  w: number;
  h: number;
}
