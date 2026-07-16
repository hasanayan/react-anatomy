// Storybook `slotAnnotations` parameter. Set to `true` to annotate the outermost
// slots (those with no `data-slot` ancestor), or pass `{ scope }` to annotate
// the slots directly inside the element carrying that `data-slot`.
//
// `depth` decides whether the overlay is a diagram or a map. Set it — N levels
// below the scope, or "all" — and the overlay is static: it labels that slice
// and nothing else. Leave it unset and the overlay is navigable: it opens on the
// first level and the reader dives a level at a time, with breadcrumbs back.
// A fixed depth and a drill-down are answering different questions, and the
// deep static view is worth keeping for the stories that want to show the whole
// anatomy in one image.
//
// `boundary` draws the component's own outline. It earns its keep at the root of
// a navigable overlay, where the labelled slots have no drawn container around
// them — the component's edge is then the only thing that says where the diagram
// ends.
export type SlotAnnotationsParameter =
  true | { scope?: string; depth?: number | "all"; boundary?: boolean };
