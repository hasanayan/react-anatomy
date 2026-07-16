// Storybook `slotAnnotations` parameter. `true` annotates the outermost slots;
// `{ scope }` annotates the slots directly inside that `data-slot`.
export type SlotAnnotationsParameter =
  | true
  | {
      scope?: string;
      // N levels below the scope, or "all", for a static overlay. Unset makes
      // the overlay navigable (dive a level at a time).
      depth?: number | "all";
      // Draw the component's own outline; needed at a navigable root, where
      // labelled slots have no drawn container.
      boundary?: boolean;
      // "fitted" cuts gutters to the solve; requires a pinned `depth` (a
      // navigable overlay re-solves per level and would jump).
      gutters?: "reserved" | "fitted";
    };
