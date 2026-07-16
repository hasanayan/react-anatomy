import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Region } from "./collect-regions";
import { hasChildren, regionsEqual } from "./collect-regions";
import { leaderPath } from "./leader-path";
import { measureLabelSizes } from "./measure-labels";
import { observeRegions } from "./observe-regions";
import { composeView, resolveOverlay } from "./overlay-model";
import type { Rect } from "./place-labels";
import { labelFont, labelHeight } from "./place-labels";
import type { Solver } from "./solver";
import { createWorkerSolver } from "./worker-solver";
import type { Placement } from "./zones";

// Storybook-only overlay: frames every `data-slot` region found in the live
// DOM and labels it. Navigable unless `depth` is pinned.

const palette = [
  "#8b5cf6",
  "#6366f1",
  "#059669",
  "#d97706",
  "#ec4899",
  "#0891b2",
  "#ef4444",
  "#64748b",
];

const boundaryColor = "#94a3b8";

const chip: CSSProperties = {
  padding: "1px 5px",
  // Border-box so a `<span>` leaf and `<button>` opener share one measured width.
  boxSizing: "border-box",
  color: "#fff",
  font: labelFont,
  whiteSpace: "nowrap",
};

// Distinct opacity claims, chosen between and never multiplied.
const isolated = 0.15;
const container = 0.55;
const offLevel = 0.2;
const fade = "opacity 120ms ease-out";

// Fixed: a bar resizing on navigation would shift the measured component.
const breadcrumbHeight = 22;

// Dev warning said once per process, not per overlay.
let warnedFittedNavigable = false;

interface FrameRect {
  region: Region;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SlotAnnotationsProps {
  children: ReactNode;
  // Annotate slots directly inside this `data-slot`; omit for the outermost.
  scope?: string;
  // Nesting levels below the scope to annotate, or "all". Unset = navigable.
  depth?: number | "all";
  boundary?: boolean;
  rootLabel?: string;
  // Injected solvers are not disposed by the component; the default worker is.
  solver?: Solver;
  // "reserved" (default) sizes the gutter up front and never moves the
  // component; "fitted" waits for the solve, so needs a pinned `depth`.
  gutters?: "reserved" | "fitted";
  className?: string;
}

export function SlotAnnotations({
  children,
  scope,
  depth,
  boundary,
  rootLabel = "component",
  solver,
  gutters = "reserved",
  className,
}: SlotAnnotationsProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // A ref, not state: swapping solvers must not repaint.
  const solverRef = useRef<Solver | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  // A solve rejection (§9/§10), rethrown from render so the story dies without
  // breaking the rules of hooks.
  const [solveError, setSolveError] = useState<Error | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // The box the current placement was solved in; committed with it.
  const [fittedBox, setFittedBox] = useState<Rect | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const navigable = depth === undefined;
  const maxDepth = depth === "all" ? Infinity : (depth ?? 1);
  // Fitted needs a pinned depth: navigable re-solves per level and would resize
  // the padding under the reader on every dive.
  const fitted = gutters === "fitted" && !navigable;

  // `regionsEqual` holds identity across the settle delivery, which repeats the
  // same regions only to flip `settled`.
  useLayoutEffect(() => {
    const root = ref.current;

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
  }, [scope]);

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

  // Keyed on the tree, not the view: a zone keeps its colour across dives.
  const colorOf = useMemo(() => {
    const indices = new Map(regions.map((region, index) => [region.id, index]));

    return (region: Region): string | undefined =>
      palette[(indices.get(region.id) ?? 0) % palette.length];
  }, [regions]);

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
    const root = ref.current;
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
  }, [settled, view, drawn, overrides, labelSizes, solver, fitted]);

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
  const { revealed, labels, frames, labelledIds, deepest } = overlay;
  const appliedPadding = overlay.padding;

  // Asked of the tree: the view has thrown away the levels this is about.
  const opens = (region: Region): boolean =>
    navigable && region.id !== active?.id && hasChildren(regions, region.id);

  // Strongest claim wins; hover only reaches in-view frames.
  const frameOpacity = (region: Region, inView: boolean): number => {
    if (!inView) {
      return offLevel;
    }

    if (hovered !== null) {
      return hovered === region.id ? 1 : isolated;
    }

    return region.depth < deepest ? container : 1;
  };

  const annotationOpacity = (region: Region): number =>
    hovered === null || hovered === region.id ? 1 : isolated;

  const dive = (region: Region): void => {
    setActiveId(region.id);
    setHovered(null);
  };

  const renderFrame = ({
    region,
    inView,
    ...rect
  }: FrameRect & { inView: boolean }): ReactElement => {
    const style: CSSProperties = {
      position: "absolute",
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      boxSizing: "border-box",
      border: `1px dashed ${colorOf(region)}`,
      borderRadius: region.radius,
      opacity: frameOpacity(region, inView),
      transition: fade,
      // Deeper draws on top, so the inner zone wins a shared border pixel and
      // the click.
      zIndex: region.depth,
    };

    if (!opens(region)) {
      return <div key={region.id} style={style} />;
    }

    return (
      // A real button so the dive is keyboard-reachable. Only frames that open
      // opt back into the pointer-events-none layer.
      <button
        key={region.id}
        type="button"
        onClick={(): void => {
          dive(region);
        }}
        style={{
          ...style,
          padding: 0,
          background: "transparent",
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        {/* Opens-here dot, in the bottom-right corner where §4.1 guarantees no
         * leader ever anchors. */}
        <span
          style={{
            position: "absolute",
            right: 3,
            bottom: 3,
            width: 4,
            height: 4,
            borderRadius: 4,
            background: colorOf(region),
          }}
        />
      </button>
    );
  };

  return (
    // Padding must not land on the measurement root, or the content shifts and
    // invalidates its geometry; hence the middle (padding) / inner (root) split.
    <div
      className={className}
      style={{
        display: "inline-block",
        // Hidden not unmounted: children must stay laid out to measure/solve.
        ...(revealed ? {} : { visibility: "hidden" }),
      }}
    >
      {navigable && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            height: breadcrumbHeight,
            font: labelFont,
          }}
        >
          <button
            type="button"
            onClick={(): void => {
              setActiveId(null);
              setHovered(null);
            }}
            style={{
              ...chip,
              border: "none",
              borderRadius: 3,
              background: "transparent",
              color: boundaryColor,
              cursor: path.length === 0 ? "default" : "pointer",
              opacity: path.length === 0 ? 1 : 0.75,
            }}
          >
            {rootLabel}
          </button>

          {path.map((region, index) => (
            <span key={region.id} style={{ display: "flex" }}>
              <span style={{ color: boundaryColor, opacity: 0.5 }}>/</span>

              <button
                type="button"
                onClick={(): void => {
                  setActiveId(region.id);
                  setHovered(null);
                }}
                style={{
                  ...chip,
                  border: "none",
                  borderRadius: 3,
                  background: colorOf(region),
                  cursor: index === path.length - 1 ? "default" : "pointer",
                  marginLeft: 4,
                }}
              >
                {region.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          display: "inline-block",
          paddingTop: appliedPadding.top || undefined,
          paddingRight: appliedPadding.right || undefined,
          paddingBottom: appliedPadding.bottom || undefined,
          paddingLeft: appliedPadding.left || undefined,
        }}
      >
        {/* Kept free of padding/borders so its padding box and border box
         * coincide — frames resolve against one, the measure reads the other. */}
        <div ref={ref} style={{ position: "relative" }}>
          {children}

          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {boundary && (
              // Decorative, never fed to the solve. Held 3px out so it clears a
              // flush slot's border (§9).
              <div
                style={{
                  position: "absolute",
                  inset: -3,
                  border: `1px dashed ${boundaryColor}`,
                  opacity: 0.6,
                  zIndex: 0,
                }}
              />
            )}

            {/* Off-level first, so context sits under the current level where
             * z-indices tie. */}
            {frames
              .filter((frame) => !labelledIds.has(frame.region.id))
              .map((frame) =>
                renderFrame({ ...frame, region: frame.region, inView: false }),
              )}

            {frames
              .filter((frame) => labelledIds.has(frame.region.id))
              .map((frame) =>
                renderFrame({ ...frame, region: frame.region, inView: true }),
              )}
          </div>

          <svg
            width="100%"
            height="100%"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              overflow: "visible",
              zIndex: 1,
            }}
          >
            {labels.map((label) => (
              <path
                key={label.region.id}
                d={leaderPath(label)}
                fill="none"
                stroke={colorOf(label.region)}
                strokeWidth={1}
                strokeDasharray="3 2"
                opacity={annotationOpacity(label.region)}
                style={{ transition: fade }}
              />
            ))}
          </svg>

          {labels.map((label) => {
            const opensHere = opens(label.region);

            const style: CSSProperties = {
              ...chip,
              position: "absolute",
              top: label.labelTop,
              left: label.labelLeft,
              display: "flex",
              height: labelHeight,
              // Pinned to the measured width so the fan always meets the same
              // chip edge, whatever the text does.
              width: label.labelWidth,
              justifyContent: label.side === "left" ? "flex-end" : "flex-start",
              alignItems: "center",
              borderRadius: 3,
              background: colorOf(label.region),
              opacity: annotationOpacity(label.region),
              transition: fade,
              cursor: opensHere ? "pointer" : "default",
              zIndex: 2,
            };

            const hover = {
              onMouseEnter: (): void => {
                setHovered(label.region.id);
              },
              onMouseLeave: (): void => {
                setHovered(null);
              },
            };

            // A real button when it dives, for keyboard reach; default
            // border/padding stripped so the chip keeps the measured width.
            return opensHere ? (
              <button
                key={label.region.id}
                type="button"
                {...hover}
                onClick={(): void => {
                  dive(label.region);
                }}
                style={{ ...style, padding: "1px 5px", border: "none" }}
              >
                {label.region.name}
              </button>
            ) : (
              <span key={label.region.id} {...hover} style={style}>
                {label.region.name}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
