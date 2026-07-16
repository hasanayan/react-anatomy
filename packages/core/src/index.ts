// Public surface: the `SlotAnnotations` component, plus the two `Solver`
// adapters a host may inject via its `solver` prop.

export { SlotAnnotations } from "./slot-annotations";
export type { SlotAnnotationsProps } from "./slot-annotations";

export type { Solver } from "./solver";
export { createSyncSolver } from "./solver";
export { createWorkerSolver } from "./worker-solver";
