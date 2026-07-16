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

// A navigable overlay re-solves on every dive, so fitted gutters (which resize
// per level) can't pair with it — the union makes that unrepresentable.
export type OverlaySessionConfig = OverlaySessionBase &
  (
    | { navigable: true }
    | { navigable: false; maxDepth: number; gutters: "reserved" | "fitted" }
  );

export interface OverlaySession {
  path: Region[];
  // Dive targets: navigable, not the active container, with children.
  openableIds: Set<string>;
  // Stable colour index by tree position; the component owns the palette.
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
  // The view the committed placement was solved for; staleness is one equality.
  const [solvedToken, setSolvedToken] = useState<string | null>(null);
  // The box the current placement was solved in; committed with it.
  const [fittedBox, setFittedBox] = useState<Rect | null>(null);
  const [settled, setSettled] = useState(false);

  // Only a static overlay can be fitted; the config forbids the other case.
  const fitted = !config.navigable && config.gutters === "fitted";

  // `observeRegions` owns the dedup — same array ref when nothing changed,
  // including the settle-only flip — so `setRegions` bails on identity.
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

  // Answers the render layer would else re-derive; pure, tested in overlay-model.
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
