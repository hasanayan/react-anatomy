import type { SlotAnnotationsOptions } from "@react-anatomy/core";

// Storybook `slotAnnotations` parameter. `true` annotates the outermost slots;
// the option object (owned by core) annotates a scope and pins depth/gutters.
export type SlotAnnotationsParameter = true | SlotAnnotationsOptions;
