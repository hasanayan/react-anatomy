import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Rect } from "../geometry";
import type { Region } from "../regions/collect-regions";
import { measureLabelSizes } from "../regions/measure-labels";
import { observeRegions } from "../regions/observe-regions";
import type { SidePadding } from "../solve/gutters";
import type { Solver } from "../solve/solver";
import { createWorkerSolver } from "../solve/worker-solver";
import type { Placement, PlacedFrame, PlacedLabel } from "../solve/zones";

import {
  colourIndex,
  composeView,
  openablesIn,
  resolveOverlay,
  viewIdentity,
} from "./overlay-model";

// The measure→solve→resolve choreography behind one hook: the component asks
// for a session and paints what it returns, never touching the solve's argument
// shape, the fitted box, or the solver's lifetime.

interface OverlaySessionBase {
  // The measurement root; label sizes and the fitted box are read off it.
  containerRef: RefObject<HTMLDivElement | null>;
  scope?: string;
  activeId: string | null;
  // Injected solvers are not disposed here; the default worker is.
  solver?: Solver;
}

// A navigable overlay re-solves on every dive, so fitted gutters — which resize
// to each level — would move the component under the reader; the mode makes that
// combination unrepresentable rather than coercing it at runtime. A pinned depth
// (static) is the only mode that may opt into fitted gutters.
export type OverlaySessionConfig = OverlaySessionBase &
  (
    | { navigable: true }
    | { navigable: false; maxDepth: number; gutters: "reserved" | "fitted" }
  );

export interface OverlaySession {
  // Resolved against the current tree; a stale id reads as the root.
  active: Region | null;
  path: Region[];
  // Ids the overlay may dive into: navigable, not the active container, with
  // children. The component asks for the answer, never re-walking the tree.
  openableIds: Set<string>;
  // Stable colour index per region id, by tree position, so a zone keeps its
  // colour across dives. The component owns the palette this indexes into.
  colorIndexById: Map<string, number>;
  revealed: boolean;
  padding: SidePadding;
  labels: PlacedLabel[];
  frames: PlacedFrame[];
  labelledIds: Set<string>;
  deepest: number;
}

export function useOverlaySession(
  config: OverlaySessionConfig,
): OverlaySession {
  const { containerRef, scope, activeId, solver } = config;
  const navigable = config.navigable;
  // A navigable overlay ignores `maxDepth` (it selects a level, not a depth).
  const maxDepth = config.navigable ? Infinity : config.maxDepth;

  // A ref, not state: swapping solvers must not repaint.
  const solverRef = useRef<Solver | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  // A solve rejection (§9/§10), rethrown so the story dies without breaking the
  // rules of hooks.
  const [solveError, setSolveError] = useState<Error | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // The identity of the view the committed placement was solved for; set with
  // it, so a stale placement is spotted by one equality (§6/§10).
  const [solvedToken, setSolvedToken] = useState<string | null>(null);
  // The box the current placement was solved in; committed with it.
  const [fittedBox, setFittedBox] = useState<Rect | null>(null);
  const [settled, setSettled] = useState(false);

  // Only a static overlay can be fitted; the config forbids the other case.
  const fitted = !config.navigable && config.gutters === "fitted";

  // `observeRegions` owns the dedup: it hands back the same array reference when
  // nothing changed (including the settle-only delivery that just flips the
  // flag), so `setRegions` bails on identity with no comparison of our own.
  useLayoutEffect(() => {
    const root = containerRef.current;

    if (!root) {
      return undefined;
    }

    return observeRegions(root, {
      ...(scope === undefined ? {} : { scope }),
      onChange: (next: Region[], isSettled: boolean): void => {
        setRegions(next);

        if (isSettled) {
          setSettled(true);
        }
      },
    });
  }, [containerRef, scope]);

  // Memoised on the tree, clear of any placement, so the solve effect never
  // re-fires on its own answer.
  const composed = useMemo(
    () => composeView(regions, activeId, { navigable, maxDepth }),
    [regions, activeId, navigable, maxDepth],
  );
  const { active, view, path, drawn, labelRegions, overrides } = composed;

  // Answers the render layer would otherwise re-derive from the whole tree:
  // a stable colour index by tree position, and the set of dive-able zones.
  // Both are pure functions of the tree, tested directly in `overlay-model`.
  const colorIndexById = useMemo(() => colourIndex(regions), [regions]);
  const openableIds = useMemo(
    () => openablesIn(regions, active?.id ?? null, navigable),
    [regions, active, navigable],
  );

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

    const token = viewIdentity(view);

    void instance.solve(drawn, labelSizes, overrides).then((next) => {
      if (next) {
        setPlacement(next);
        setFittedBox(box);
        setSolvedToken(token);
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
    solvedToken,
    fittedBox,
    fitted,
    settled,
  });

  return {
    active,
    path,
    openableIds,
    colorIndexById,
    revealed: overlay.revealed,
    padding: overlay.padding,
    labels: overlay.labels,
    frames: overlay.frames,
    labelledIds: overlay.labelledIds,
    deepest: overlay.deepest,
  };
}
