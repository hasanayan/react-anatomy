import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import type { Region } from "../regions/collect-regions";
import { hasChildren } from "../regions/region-tree";
import { labelFont, labelHeight } from "../solve/place-labels";
import type { Solver } from "../solve/solver";

import { useOverlaySession } from "./overlay-session";

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

interface FrameRect {
  region: Region;
  left: number;
  top: number;
  width: number;
  height: number;
}

// The subset a story author sets through the Storybook `slotAnnotations`
// parameter; the host supplies the rest of `SlotAnnotationsProps`.
export interface SlotAnnotationsOptions {
  // Annotate slots directly inside this `data-slot`; omit for the outermost.
  scope?: string;
  // Nesting levels below the scope to annotate, or "all". Unset = navigable.
  depth?: number | "all";
  // Draw the component's own outline; needed at a navigable root, where
  // labelled slots have no drawn container.
  boundary?: boolean;
  // "reserved" (default) sizes the gutter up front and never moves the
  // component; "fitted" waits for the solve, so needs a pinned `depth`.
  gutters?: "reserved" | "fitted";
}

export interface SlotAnnotationsProps extends SlotAnnotationsOptions {
  children: ReactNode;
  rootLabel?: string;
  // Injected solvers are not disposed by the component; the default worker is.
  solver?: Solver;
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
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const navigable = depth === undefined;
  const maxDepth = depth === "all" ? Infinity : (depth ?? 1);

  const {
    regions,
    active,
    path,
    revealed,
    padding: appliedPadding,
    labels,
    frames,
    labelledIds,
    deepest,
  } = useOverlaySession({
    containerRef: ref,
    scope,
    activeId,
    navigable,
    maxDepth,
    gutters,
    solver,
  });

  // Keyed on the tree, not the view: a zone keeps its colour across dives.
  const colorOf = useMemo(() => {
    const indices = new Map(regions.map((region, index) => [region.id, index]));

    return (region: Region): string | undefined =>
      palette[(indices.get(region.id) ?? 0) % palette.length];
  }, [regions]);

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
                // Points arrive pre-rounded from the solve (§6); a stub to the
                // rail, then a fan to the label's edge.
                d={label.points
                  .map(
                    (point, index) =>
                      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`,
                  )
                  .join(" ")}
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
