import type { Region } from "../regions/collect-regions";
import {
  pathTo,
  selectDepth,
  selectLevel,
  siblingsOf,
} from "../regions/region-tree";
import { fitPadding } from "../solve/gutters";
import type {
  Constants,
  LabelSize,
  Rect,
  SidePadding,
} from "../solve/place-labels";
import { anatomyConstants, reservePadding } from "../solve/place-labels";
import type { Placement, PlacedFrame, PlacedLabel } from "../solve/zones";

// Framework-free overlay judgement: `composeView` produces the solve's inputs
// (memoised on the tree), `resolveOverlay` reads the placement into draw state.

interface ViewConfig {
  navigable: boolean;
  // Deepest level a static overlay labels; ignored when navigable.
  maxDepth: number;
}

interface ComposedView {
  // Resolved against the current tree; a stale id reads as the root.
  active: Region | null;
  // Depths rebased so the slice's shallowest members sit at 1.
  view: Region[];
  offLevelRegions: Region[];
  path: Region[];
  // View plus off-level context, so one solve decides the whole picture.
  drawn: Region[];
  // Reserved-from regions: whole tree when navigable, view when static.
  labelRegions: Region[];
  // Off-level regions posted hidden: routed around, returned as unlabelled.
  overrides: Record<string, { hidden: true }>;
}

interface OverlayInput {
  view: Region[];
  labelSizes: Record<string, LabelSize>;
  placement: Placement | null;
  // The box the current placement was solved in. Null in reserved mode.
  fittedBox: Rect | null;
  fitted: boolean;
  settled: boolean;
  constants?: Constants;
}

interface ResolvedOverlay {
  padding: SidePadding;
  revealed: boolean;
  // Whether the latest placement describes the current view.
  current: boolean;
  labels: PlacedLabel[];
  frames: PlacedFrame[];
  // Ids that carry a label; a drawn frame outside this set is context.
  labelledIds: Set<string>;
  // Deepest rebased level, so container frames fade behind leaves.
  deepest: number;
}

// The solve's input; must hold still while the solve answers.
export function composeView(
  regions: Region[],
  activeId: string | null,
  config: ViewConfig,
): ComposedView {
  const { navigable, maxDepth } = config;

  const active =
    activeId === null
      ? null
      : (regions.find((region) => region.id === activeId) ?? null);

  const view = navigable
    ? selectLevel(regions, active?.id ?? null)
    : selectDepth(regions, maxDepth);

  const offLevelRegions =
    navigable && active ? siblingsOf(regions, active.id) : [];

  const path = navigable ? pathTo(regions, active?.id ?? null) : [];

  const drawn = [...view, ...offLevelRegions];
  const overrides = Object.fromEntries(
    offLevelRegions.map((region) => [region.id, { hidden: true } as const]),
  );

  // Reserve for every label the overlay could show, else it moves on a deeper
  // dive than the current level.
  const labelRegions = navigable ? regions : view;

  return {
    active,
    view,
    offLevelRegions,
    path,
    drawn,
    labelRegions,
    overrides,
  };
}

// `labelSizes` is measured by the caller — the one input here touching the DOM.
export function resolveOverlay(input: OverlayInput): ResolvedOverlay {
  const { view, labelSizes, placement, fittedBox, fitted, settled } = input;
  const constants = input.constants ?? anatomyConstants;

  // Pure function of placement and box, so it lands in the same commit. Null
  // until a placement exists.
  const reserved = reservePadding(labelSizes, constants);
  const fittedPadding =
    fitted && placement && fittedBox ? fitPadding(placement, fittedBox) : null;

  // Fitted reveal is gated on the gutter landing; an empty view has nothing to
  // fit, so it reveals once settled instead of never.
  const revealed =
    !fitted || fittedPadding !== null || (settled && view.length === 0);
  const padding = fitted && fittedPadding ? fittedPadding : reserved;

  // A solve in flight leaves the placement a level behind; keyed on its own
  // first region so one level's frames never mix with another's dimming.
  const solved = placement?.labels[0]?.region;
  const current = solved === undefined || view.includes(solved);
  const labels = current ? (placement?.labels ?? []) : [];
  const frames = current ? (placement?.frames ?? []) : [];
  const labelledIds = new Set(labels.map((label) => label.region.id));

  const deepest = view.reduce((max, region) => Math.max(max, region.depth), 1);

  return {
    padding,
    revealed,
    current,
    labels,
    frames,
    labelledIds,
    deepest,
  };
}
