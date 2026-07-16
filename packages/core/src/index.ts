// Public surface of the overlay. The Storybook addon and any other host consume
// the component from here; the engine is exported alongside it because the
// component's own gutter reservation and off-level frames lean on the same pure
// functions, and a host that wants a static render without the React wrapper
// should be able to reach them too.

export { SlotAnnotations } from "./slot-annotations";
export type { SlotAnnotationsProps } from "./slot-annotations";

export type { Region, CornerRadii } from "./collect-regions";
export {
  collectRegions,
  regionsEqual,
  childrenOf,
  hasChildren,
  pathTo,
  selectDepth,
  selectLevel,
  siblingsOf,
} from "./collect-regions";

export type {
  Side,
  Constants,
  Rect,
  Zone,
  Overrides,
  LabelSize,
  Placed,
  Placement,
  PlacedLabel,
  PlacedFrame,
  PlacementData,
  SidePadding,
} from "./place-labels";
export {
  anatomyConstants,
  labelHeight,
  layout,
  placeLabels,
  placeZones,
  toZones,
  attachRegions,
  measureLabelSizes,
  reservePadding,
  leaderPath,
} from "./place-labels";

export type { SolveRequest, SolveResponse } from "./place-labels.worker";
