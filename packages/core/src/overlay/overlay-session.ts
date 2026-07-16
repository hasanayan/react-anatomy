import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Region } from "../regions/collect-regions";
import { measureLabelSizes } from "../regions/measure-labels";
import { observeRegions } from "../regions/observe-regions";
import { regionsEqual } from "../regions/region-tree";
import type { Rect, SidePadding } from "../solve/place-labels";
import type { Solver } from "../solve/solver";
import { createWorkerSolver } from "../solve/worker-solver";
import type { Placement, PlacedFrame, PlacedLabel } from "../solve/zones";

import { composeView, resolveOverlay } from "./overlay-model";

// The measure→solve→resolve choreography behind one hook: the component asks
// for a session and paints what it returns, never touching the solve's argument
// shape, the fitted box, or the solver's lifetime.

export interface OverlaySessionConfig {
  // The measurement root; label sizes and the fitted box are read off it.
  containerRef: RefObject<HTMLDivElement | null>;
  scope?: string;
  activeId: string | null;
  navigable: boolean;
  maxDepth: number;
  gutters: "reserved" | "fitted";
  // Injected solvers are not disposed here; the default worker is.
  solver?: Solver;
}

export interface OverlaySession {
  // The whole tree, for colour and dive-target lookups the view has discarded.
  regions: Region[];
  // Resolved against the current tree; a stale id reads as the root.
  active: Region | null;
  path: Region[];
  revealed: boolean;
  padding: SidePadding;
  labels: PlacedLabel[];
  frames: PlacedFrame[];
  labelledIds: Set<string>;
  deepest: number;
}

// Dev warning said once per process, not per overlay.
let warnedFittedNavigable = false;

export function useOverlaySession(
  config: OverlaySessionConfig,
): OverlaySession {
  const {
    containerRef,
    scope,
    activeId,
    navigable,
    maxDepth,
    gutters,
    solver,
  } = config;

  // A ref, not state: swapping solvers must not repaint.
  const solverRef = useRef<Solver | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  // A solve rejection (§9/§10), rethrown so the story dies without breaking the
  // rules of hooks.
  const [solveError, setSolveError] = useState<Error | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // The box the current placement was solved in; committed with it.
  const [fittedBox, setFittedBox] = useState<Rect | null>(null);
  const [settled, setSettled] = useState(false);

  // Fitted needs a pinned depth: navigable re-solves per level and would resize
  // the padding under the reader on every dive.
  const fitted = gutters === "fitted" && !navigable;

  // `regionsEqual` holds identity across the settle delivery, which repeats the
  // same regions only to flip `settled`.
  useLayoutEffect(() => {
    const root = containerRef.current;

    if (!root) {
      return undefined;
    }

    return observeRegions(root, {
      ...(scope === undefined ? {} : { scope }),
      onChange: (next: Region[], isSettled: boolean): void => {
        setRegions((current) => (regionsEqual(current, next) ? current : next));

        if (isSettled) {
          setSettled(true);
        }
      },
    });
  }, [containerRef, scope]);

  useEffect(() => {
    if (gutters === "fitted" && navigable && !warnedFittedNavigable) {
      warnedFittedNavigable = true;
      console.warn(
        '[anatomy] `gutters: "fitted"` needs a pinned `depth`: a navigable ' +
          "overlay re-solves on every dive, and fitting the gutters to each " +
          "level would move the component under the reader. Falling back to " +
          "reserved gutters.",
      );
    }
  }, [gutters, navigable]);

  // Memoised on the tree, clear of any placement, so the solve effect never
  // re-fires on its own answer.
  const composed = useMemo(
    () => composeView(regions, activeId, { navigable, maxDepth }),
    [regions, activeId, navigable, maxDepth],
  );
  const { active, view, path, drawn, labelRegions, overrides } = composed;

  // The one model input that touches the DOM, so it lives here not in
  // `resolveOverlay`. Over every label the overlay could show.
  const labelSizes = useMemo(
    () => measureLabelSizes(labelRegions),
    [labelRegions],
  );

  // Default worker keeps the solve off the main thread; an injected solver is
  // disposed by whoever created it, not here.
  useEffect(() => {
    const instance = solver ?? createWorkerSolver();

    solverRef.current = instance;

    return (): void => {
      solverRef.current = null;

      if (instance !== solver) {
        instance.dispose();
      }
    };
  }, [solver]);

  // Latest-wins: a solve superseded by a newer one resolves to null.
  useEffect(() => {
    const instance = solverRef.current;

    if (!settled || view.length === 0 || !instance) {
      return;
    }

    // Captured and committed with the placement so a fitted gutter is never cut
    // against another solve's box.
    const root = containerRef.current;
    const box: Rect | null =
      fitted && root
        ? { x: 0, y: 0, w: root.offsetWidth, h: root.offsetHeight }
        : null;

    void instance.solve(drawn, labelSizes, overrides).then((next) => {
      if (next) {
        setPlacement(next);
        setFittedBox(box);
      }
    }, setSolveError);
  }, [
    containerRef,
    settled,
    view,
    drawn,
    overrides,
    labelSizes,
    solver,
    fitted,
  ]);

  if (solveError) {
    throw solveError;
  }

  const overlay = resolveOverlay({
    view,
    labelSizes,
    placement,
    fittedBox,
    fitted,
    settled,
  });

  return {
    regions,
    active,
    path,
    revealed: overlay.revealed,
    padding: overlay.padding,
    labels: overlay.labels,
    frames: overlay.frames,
    labelledIds: overlay.labelledIds,
    deepest: overlay.deepest,
  };
}
