// Public surface: the `SlotAnnotations` component, plus the two `Solver`
// adapters a host may inject via its `solver` prop.

export { SlotAnnotations } from "./overlay/slot-annotations";
export type {
  SlotAnnotationsOptions,
  SlotAnnotationsProps,
} from "./overlay/slot-annotations";

export type { Solver } from "./solve/solver";
export { createSyncSolver } from "./solve/solver";
export { createWorkerSolver } from "./solve/worker-solver";
