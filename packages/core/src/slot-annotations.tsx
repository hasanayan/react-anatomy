import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Region } from "./collect-regions";
import {
  collectRegions,
  hasChildren,
  pathTo,
  regionsEqual,
  selectDepth,
  selectLevel,
  siblingsOf,
} from "./collect-regions";
import type { Placement } from "./place-labels";
import {
  anatomyConstants,
  attachRegions,
  labelHeight,
  leaderPath,
  measureLabelSizes,
  reservePadding,
  toZones,
} from "./place-labels";
import type { SolveRequest, SolveResponse } from "./place-labels.worker";

// Storybook-only overlay (not a design-system component). Wraps a rendered tree
// and draws a dashed frame around every `data-slot` region it finds, scattering
// a label around the four sides of the content — each near its own region, with
// a dashed leader line back to it. Regions are discovered from the live DOM, so
// it is component-agnostic — anything that marks its parts with `data-slot`
// works.
//
// Unless a `depth` is pinned, it is also navigable: it opens on the outermost
// slots and dives one level per click, showing the zone dived into and the zones
// inside it. Every navigation is a fresh solve over a fresh set of zones, which
// sounds expensive and is not — a level is a handful of zones, the search's
// early exit fires on almost all of them, and the worker owns the arithmetic
// either way.

// Saturated mid-tones chosen to read on both the light and dark canvases (the
// theme decorator toggles a class); labels carry white text on these fills.
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

// Reads on either canvas without belonging to the palette — the boundary is not
// a zone and must not be mistaken for one.
const boundaryColor = "#94a3b8";

const chip: CSSProperties = {
  padding: "1px 5px",
  color: "#fff",
  font: "600 10px/1.5 ui-sans-serif, system-ui, sans-serif",
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
};

// Three weights, and each is a different claim about a region rather than a
// different amount of the same one — so they are chosen between, never
// multiplied. `isolated` is hover: one slot answered a question the reader
// asked, the rest of the level is context. `container` is nesting: the zone
// dived into recedes so the zones inside it read as the subject. `offLevel` is
// navigation: the level just left, kept on screen so the dive is legible as a
// move and not a jump.
const isolated = 0.15;
const container = 0.55;
const offLevel = 0.2;
const fade = "opacity 120ms ease-out";

// Fixed, and that is the whole point: the bar sits outside the measurement
// wrapper but above it in the flow, so a bar that grew or vanished as the
// reader navigated would shift the component the frames are measured against.
const breadcrumbHeight = 22;

interface FrameRect {
  region: Region;
  left: number;
  top: number;
  width: number;
  height: number;
}

// Where a set of regions' frames are drawn. The solve returns this for every
// zone it placed, but the off-level frames never reach the solve — they are
// context, not candidates — and they still have to be drawn the way §9 insists:
// the inset rect, never the raw one, so that the border on screen is the border
// a label would have pointed at. Positional, as `attachRegions` is, and for the
// same reason: the nth zone is the nth region and nothing reorders them.
function frameRects(regions: Region[]): FrameRect[] {
  const zones = toZones(regions, anatomyConstants);

  return regions.flatMap((region, index) => {
    const rect = zones[index]?.rect;

    return rect
      ? [{ region, left: rect.x, top: rect.y, width: rect.w, height: rect.h }]
      : [];
  });
}

export interface SlotAnnotationsProps {
  children: ReactNode;
  // Annotate the slots directly inside this `data-slot`. Omit to annotate the
  // outermost slots (those with no `data-slot` ancestor).
  scope?: string;
  // How many nesting levels below the scope to annotate: a number, or "all" for
  // every slot under the scope. Leave unset for a navigable overlay that starts
  // at the first level and drills down.
  depth?: number | "all";
  // Outline the component's own bounding box. Decorative — see below.
  boundary?: boolean;
  // What the first breadcrumb is called. There is no component name in the DOM,
  // so the decorator supplies one.
  rootLabel?: string;
  className?: string;
}

export function SlotAnnotations({
  children,
  scope,
  depth,
  boundary,
  rootLabel = "component",
  className,
}: SlotAnnotationsProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const worker = useRef<Worker | null>(null);
  // The latest solve posted, and the regions it was asked about. The worker
  // answers in zone ids and numbers — it has never seen a `Region`, because an
  // `HTMLElement` cannot cross the boundary — so the reply is matched back to
  // the regions that produced it here. Monotonic, and only the latest id is ever
  // painted: the solve is asynchronous now, so a re-measure can land mid-flight
  // and leave an answer in the post that describes geometry which is already
  // gone. Navigation posts through the same counter, so a reader clicking
  // through three levels faster than the search can answer paints the third and
  // discards the first two.
  const requestId = useRef(0);
  const requestRegions = useRef<Region[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Whether the geometry is worth solving yet — see the font wait below.
  const [settled, setSettled] = useState(false);
  const navigable = depth === undefined;
  const maxDepth = depth === "all" ? Infinity : (depth ?? 1);

  useLayoutEffect(() => {
    const root = ref.current;

    if (!root) {
      return undefined;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let mutationObserver: MutationObserver | undefined;

    // Keep state identity stable when nothing changed: the observers below
    // fire on every measurement (including the initial observe), so an
    // unconditional set would loop render → observe → set forever.
    const measure = (): void => {
      if (cancelled) {
        return;
      }

      const next = collectRegions(root, scope);

      setRegions((current) => (regionsEqual(current, next) ? current : next));
    };

    // Measure once now, synchronously, before the browser paints. This pass is
    // not for the solve — the geometry it sees is provisional — it is so the
    // padding below can be reserved from the region names, which the fonts
    // cannot change. The component then paints into its final gutters and never
    // moves again.
    measure();

    const settle = (): void => {
      if (cancelled) {
        return;
      }

      measure();
      setSettled(true);

      // Re-measure on wrapper resize, on any resize of the discovered slots,
      // and on subtree mutations, so late-rendering content is picked up. The
      // slot observer is re-attached each time `regions` changes (see the
      // effect below); here we cover the wrapper and DOM structure.
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(root);

      mutationObserver = new MutationObserver(measure);
      mutationObserver.observe(root, { childList: true, subtree: true });
    };

    // Wait for the web fonts before letting anything solve. Text metrics move
    // when a font swaps in, and every text-bearing slot changes width with them
    // by a fraction of a pixel — so solving first means solving twice: once
    // against fallback metrics, then again for real. On the eleven-zone story
    // that is a second of work thrown away. (`fonts.ready` can resolve before a
    // font is even requested, since it only promises that nothing is *pending*;
    // when that happens the observers still catch the swap and re-solve, which
    // is correct, just not free.)
    void document.fonts.ready.then(settle);

    return (): void => {
      cancelled = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [scope]);

  // Observe each discovered slot element so a size change inside a slot
  // re-triggers measurement.
  useLayoutEffect(() => {
    if (regions.length === 0) {
      return undefined;
    }

    const root = ref.current;

    if (!root) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      const next = collectRegions(root, scope);

      setRegions((current) => (regionsEqual(current, next) ? current : next));
    });

    for (const region of regions) {
      observer.observe(region.el);
    }

    return (): void => {
      observer.disconnect();
    };
  }, [regions, scope]);

  // A story swap can leave a stale id behind — the overlay is the same
  // component in the same position, so React keeps its state across it — and
  // the deep path of one card's heading names nothing in another's. Resolving
  // the id against the current tree on every render, rather than pruning it in
  // an effect, means there is no frame in which the view is answering with a
  // region that isn't there: an id nobody claims simply reads as the root.
  const active = useMemo(
    () =>
      activeId === null
        ? null
        : (regions.find((region) => region.id === activeId) ?? null),
    [regions, activeId],
  );

  // What gets labelled, and what gets drawn behind it. Both are memoised on
  // `regions`, whose identity `regionsEqual` holds still, so a re-measure that
  // changed nothing does not re-post a solve.
  const view = useMemo(
    () =>
      navigable
        ? selectLevel(regions, active?.id ?? null)
        : selectDepth(regions, maxDepth),
    [regions, navigable, active, maxDepth],
  );

  const offLevelRegions = useMemo(
    () => (navigable && active ? siblingsOf(regions, active.id) : []),
    [regions, navigable, active],
  );

  const path = useMemo(
    () => (navigable ? pathTo(regions, active?.id ?? null) : []),
    [regions, navigable, active],
  );

  // A zone's colour is its position in the *tree*, not in the view. The view's
  // ordering changes with every dive — `heading` is the second zone at the root
  // and the first one inside itself — and a diagram whose colours reshuffle as
  // the reader moves through it is a diagram that has to be re-read at every
  // level. Keyed on the tree, a zone keeps its colour wherever it is seen, and
  // the level you came from stays recognisable while dimmed.
  const colorOf = useMemo(() => {
    const indices = new Map(regions.map((region, index) => [region.id, index]));

    return (region: Region): string | undefined =>
      palette[(indices.get(region.id) ?? 0) % palette.length];
  }, [regions]);

  // The gutters are reserved for every label the overlay could ever show, not
  // just the ones on screen. In a static overlay those are the same set. In a
  // navigable one they are not, and reserving only the current level's would
  // mean the component moves under the reader the first time they dive into a
  // slot with a longer name than any at the root. `layout` derives the rails
  // from the same sizes, so the solve keeps agreeing with the padding.
  const labelRegions = navigable ? regions : view;
  const labelSizes = useMemo(
    () => measureLabelSizes(labelRegions),
    [labelRegions],
  );

  const padding = useMemo(
    () => reservePadding(labelSizes, anatomyConstants),
    [labelSizes],
  );

  // One worker per overlay, alive for as long as the component is. The solve is
  // a second of arithmetic on the eleven-zone story, and running it here would
  // freeze the page for that second — the annotations were already deferred
  // behind a paint, but deferring a blocking call only moves the block. Off the
  // thread entirely, the page stays scrollable and hoverable throughout.
  useEffect(() => {
    // The specifier ends in `.js`, not the source's `.ts`: this file ships
    // compiled, and the worker alongside it, so the URL has to name the emitted
    // module. Vite in the consuming host resolves it against this module's own
    // URL and serves the sibling `place-labels.worker.js` as a real worker — the
    // solve genuinely runs off the main thread across the package boundary. See
    // the package README for why the core ships as unbundled ESM to keep this
    // resolution honest.
    const instance = new Worker(
      new URL("./place-labels.worker.js", import.meta.url),
      { type: "module" },
    );

    instance.onmessage = (event: MessageEvent<SolveResponse>): void => {
      const reply = event.data;

      // Anything but the newest answer describes geometry the overlay has
      // already thrown away. Painting it would be worse than painting nothing.
      if (reply.id !== requestId.current) {
        return;
      }

      if (!reply.ok) {
        // Hard rules 9 and 10, arriving from the other thread. They throw by
        // design and the story is supposed to die on them, so the message is
        // put back into a real exception here — an unhandled throw in this
        // callback surfaces exactly as the old one did from its timeout.
        const error = new Error(reply.message);

        if (reply.stack !== undefined) {
          error.stack = reply.stack;
        }

        throw error;
      }

      setPlacement(attachRegions(reply.placement, requestRegions.current));
    };

    worker.current = instance;

    return (): void => {
      worker.current = null;
      instance.terminate();
    };
  }, []);

  // Post the solve once the geometry is worth solving. The component has already
  // painted into gutters reserved up front, so nothing shifts when the answer
  // arrives — which is what the old rAF-plus-timeout dance was buying, and it is
  // no longer buying it: posting a message is cheap and returns immediately, so
  // there is nothing left to defer behind a paint.
  useEffect(() => {
    const instance = worker.current;

    if (!settled || view.length === 0 || !instance) {
      return;
    }

    const id = requestId.current + 1;

    requestId.current = id;
    requestRegions.current = view;

    instance.postMessage({
      id,
      zones: toZones(view, anatomyConstants),
      labelSizes,
      overrides: {},
      constants: anatomyConstants,
    } satisfies SolveRequest);
  }, [settled, view, labelSizes]);

  // The placement is a whole level behind for as long as a solve is in flight.
  // Painting the old level's frames against the new level's dimming would be a
  // diagram that describes nothing, so the overlay shows the last coherent
  // answer and nothing else until the next one lands.
  const solved = placement?.labels[0]?.region;
  const current = solved === undefined || view.includes(solved);
  const labels = current ? (placement?.labels ?? []) : [];
  const frames = current ? (placement?.frames ?? []) : [];

  // When nesting is shown, fade the container frames slightly so the leaf
  // regions (whose leaders inevitably cross their ancestors) stay readable. In
  // a navigable view that is exactly the zone dived into, which is the reading
  // it was always meant to have.
  const deepest = view.reduce((max, region) => Math.max(max, region.depth), 1);

  // Whether a zone leads anywhere. Asked of the tree, because the view has by
  // construction thrown away the levels this is about.
  const opens = (region: Region): boolean =>
    navigable && region.id !== active?.id && hasChildren(regions, region.id);

  // One weight per region, chosen by the strongest claim on it rather than by
  // multiplying the claims together. Hover isolation is a question about the
  // labelled set, so it is answered inside it: an off-level frame is context
  // that hovering does not reach, and pushing it back twice would only make it
  // invisible.
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

  // Diving into a zone, from wherever the reader clicked — the frame, or the
  // chip in the gutter. Both go through here so there is one dive, not two that
  // can drift: the same stale/reset guards cover a label click for free.
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
      // Deeper draws on top, said out loud. Where two borders do land on each
      // other — §9's nudge clears the nested case, but adjacent siblings still
      // share the line between them — the inner zone is the one the reader is
      // looking at, so it wins the pixel. It also wins the *click*, which is
      // what makes the dive land on the zone being pointed at rather than on
      // whatever encloses it. This held by accident of DOM order before, since
      // zones arrive parents-first and later siblings paint over earlier ones.
      // Accidents that the hit-testing depends on are worth spelling out.
      zIndex: region.depth,
    };

    if (!opens(region)) {
      return <div key={region.id} style={style} />;
    }

    return (
      // A real button, not a div that listens: the dive is then reachable by
      // keyboard for free, and the a11y lint is asking for the same thing the
      // reader is. The frames sit in a `pointer-events-none` layer and only the
      // ones that lead somewhere opt back in. That does swallow clicks meant for
      // the component underneath, which for a docs overlay is the right trade —
      // nothing under a frame is interactive here, and the frame is the
      // affordance for the dive. Nesting resolves itself: zones are painted
      // parents first, so a child is painted over its container and takes the
      // click, which is the zone the reader was pointing at.
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
        {/*
         * The tell that a zone opens. It sits in the bottom-right corner
         * because that is the one place a leader provably never reaches: §4.1
         * insets every candidate span by the corner radius plus the stub cap,
         * so anchors keep clear of the corners by construction. Four pixels, in
         * the zone's own colour, is as loud as a docs overlay should be about a
         * thing the reader will otherwise find with the cursor.
         */}
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
    // Three wrappers now, and each of the two splits is load-bearing.
    //
    // Padding must not land on the element the regions are measured against:
    // applying it would shift the content and invalidate the very geometry it
    // came from, and the observers would re-measure, re-solve and repaint. That
    // loop did settle — but only after painting the frames 71px off their
    // components for the length of a solve. So the middle div takes the padding
    // and nothing else, and the inner div is both the measurement root and the
    // overlay's containing block.
    //
    // The breadcrumbs then have to live outside the padding as well as outside
    // the measurement root — inside the padded div they would sit in the top
    // gutter, in among the labels reserved for it. Hence the outer div: the bar
    // is a sibling of the whole diagram, at a fixed height, and navigating moves
    // nothing.
    <div className={className} style={{ display: "inline-block" }}>
      {navigable && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            height: breadcrumbHeight,
            font: "600 10px/1.5 ui-sans-serif, system-ui, sans-serif",
            letterSpacing: "0.02em",
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
            <span key={region.id} style={{ display: "flex", gap: 4 }}>
              <span style={{ color: boundaryColor, opacity: 0.5 }}>/</span>

              <button
                type="button"
                onClick={(): void => {
                  setActiveId(region.id);
                  setHovered(null);
                }}
                style={{
                  ...chip,
                  borderRadius: 3,
                  background: colorOf(region),
                  cursor: index === path.length - 1 ? "default" : "pointer",
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
          paddingTop: padding.top || undefined,
          paddingRight: padding.right || undefined,
          paddingBottom: padding.bottom || undefined,
          paddingLeft: padding.left || undefined,
        }}
      >
        {/*
         * Absolutely positioned children resolve against this element's padding
         * box, while `getBoundingClientRect` reports its border box. Keeping it
         * free of padding and borders makes the two coincide, so the frames sit
         * exactly where the measurement said they would.
         */}
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
              // Decorative, and deliberately not a zone: it is never fed to the
              // solve, never counted as a crossing, and never labelled. The
              // solve's frame is the zones' bounding box, which at the root is
              // this rect anyway — unifying them would buy identical numbers and
              // cost the solve its independence from what the overlay draws.
              //
              // Held three pixels out for the same reason §9 insets the nesting:
              // an outline sitting exactly on a flush slot's border is an
              // outline nobody can see. Three is nothing against a 28px gutter.
              <div
                style={{
                  position: "absolute",
                  inset: -3,
                  border: `1px dashed ${boundaryColor}`,
                  opacity: 0.6,
                  // Under every zone: it is the shallowest thing on screen, and
                  // it is not one of them.
                  zIndex: 0,
                }}
              />
            )}

            {frameRects(offLevelRegions).map((rect) =>
              renderFrame({ ...rect, inView: false }),
            )}

            {frames.map((frame) =>
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
              // Pin the box to the width the placer measured, and align the
              // text to the gutter-facing edge: a left-gutter chip's right edge
              // then sits exactly where every left fan ends, whatever the text
              // does.
              width: label.labelWidth,
              justifyContent: label.side === "left" ? "flex-end" : "flex-start",
              alignItems: "center",
              borderRadius: 3,
              background: colorOf(label.region),
              opacity: annotationOpacity(label.region),
              transition: fade,
              // The chip dives into its slot, the same as clicking the zone —
              // it is the most obvious handle, and following the reader's
              // instinct beats defending the letter of "you clicked the gutter,
              // not the box". A chip whose zone leads nowhere stays inert.
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

            // A real button when it dives, so keyboard reach and the a11y lint
            // come for free — the same trade the zone frames make. The border
            // and padding a button carries by default would fatten the chip past
            // the width the placer measured and pull the fan off its edge, so
            // they are stripped back to the span's box exactly.
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
