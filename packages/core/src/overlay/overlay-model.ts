import { anatomyConstants } from "../constants";
import type { Constants } from "../constants";
import type { Rect } from "../geometry";
import type { LabelSize } from "../label-metrics";
import type { Region } from "../regions/collect-regions";
import {
  hasChildren,
  pathTo,
  selectDepth,
  selectLevel,
  siblingsOf,
} from "../regions/region-tree";
import { fit, reserve } from "../solve/gutters";
import type { SidePadding } from "../solve/gutters";
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
  // The identity of the view the placement was solved for; null when none. A
  // newer view whose identity differs withholds the placement — one comparison,
  // no guessing from a stray label.
  solvedToken: string | null;
  // The box the current placement was solved in. Null in reserved mode.
  fittedBox: Rect | null;
  fitted: boolean;
  settled: boolean;
  constants?: Constants;
}

// A view's identity: the ids it labels, in order. A placement is stamped with
// the identity it was solved for, so staleness is an equality, not a heuristic.
export function viewIdentity(view: Region[]): string {
  return view.map((region) => region.id).join("|");
}

// The zones a navigable overlay may dive into: not the active container, and
// holding children. The session hands this to the render layer so the component
// never re-walks the tree it was given.
export function openablesIn(
  regions: Region[],
  activeId: string | null,
  navigable: boolean,
): Set<string> {
  if (!navigable) {
    return new Set();
  }

  const ids = new Set<string>();

  for (const region of regions) {
    if (region.id !== activeId && hasChildren(regions, region.id)) {
      ids.add(region.id);
    }
  }

  return ids;
}

// Stable colour index per region id, by tree position, so a zone keeps its
// colour across dives. The palette this indexes is the overlay's presentation.
export function colourIndex(regions: Region[]): Map<string, number> {
  return new Map(regions.map((region, index) => [region.id, index]));
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
  const reserved = reserve(labelSizes, constants);
  const fittedPadding =
    fitted && placement && fittedBox ? fit(placement, fittedBox) : null;

  // Fitted reveal is gated on the gutter landing; an empty view has nothing to
  // fit, so it reveals once settled instead of never.
  const revealed =
    !fitted || fittedPadding !== null || (settled && view.length === 0);
  const padding = fitted && fittedPadding ? fittedPadding : reserved;

  // A solve in flight leaves the placement a level behind: its stamped identity
  // no longer matches this view, so its frames never mix with another's dimming.
  const current =
    placement === null || input.solvedToken === viewIdentity(view);
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
