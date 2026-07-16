import { describe, expect, it } from "vitest";

import type { Rect } from "../geometry";
import type { LabelSize } from "../label-metrics";
import type { Region } from "../regions/collect-regions";
import type { Placement, PlacedLabel } from "../solve/zones";

import {
  colourIndex,
  composeView,
  openablesIn,
  resolveOverlay,
  viewIdentity,
} from "./overlay-model";

// `composeView`/`resolveOverlay` at their interface — regions and a placement
// in, drawable state out — no DOM, no React.

// `el` is required by the type but never read by the model.
function region(over: Partial<Region> & { name: string; id: string }): Region {
  return {
    depth: 1,
    top: 0,
    left: 0,
    width: 100,
    height: 20,
    radius: "0px",
    radii: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
    el: document.createElement("div"),
    ...over,
  };
}

// Root `card` with two children, one (`body`) with its own child.
const tree: Region[] = [
  region({ name: "card", id: "card-0", depth: 1 }),
  region({ name: "header", id: "header-1", depth: 2, parentId: "card-0" }),
  region({ name: "body", id: "body-2", depth: 2, parentId: "card-0" }),
  region({ name: "avatar", id: "avatar-3", depth: 3, parentId: "body-2" }),
];

const sizes = (regions: Region[]): Record<string, LabelSize> =>
  Object.fromEntries(regions.map((r) => [r.id, { w: 60, h: 20 }]));

// Only the pieces the model reads are filled in: `labels[].region` and the
// label rects `fitPadding` measures.
function placementOf(regions: Region[]): Placement {
  const labels: PlacedLabel[] = regions.map((r) => ({
    zoneId: r.id,
    region: r,
    side: "left",
    anchorX: 0,
    anchorY: 0,
    labelLeft: -60,
    labelTop: 0,
    labelWidth: 50,
    points: [{ x: 0, y: 0 }],
  }));

  return {
    labels,
    frames: regions.map((r) => ({
      zoneId: r.id,
      region: r,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    })),
  };
}

describe("composeView", () => {
  it("selects the outermost slots at the root of a navigable overlay", () => {
    const { view, offLevelRegions, path, drawn, overrides } = composeView(
      tree,
      null,
      { navigable: true, maxDepth: 1 },
    );

    expect(view.map((r) => r.id)).toStrictEqual(["card-0"]);
    expect(offLevelRegions).toStrictEqual([]);
    expect(path).toStrictEqual([]);
    expect(drawn.map((r) => r.id)).toStrictEqual(["card-0"]);
    expect(overrides).toStrictEqual({});
  });

  it("dives into a zone as container plus the zones inside it", () => {
    const { view, path } = composeView(tree, "card-0", {
      navigable: true,
      maxDepth: 1,
    });

    // Container and its two children, depths rebased so the container sits at 1.
    expect(view.map((r) => r.id)).toStrictEqual([
      "card-0",
      "header-1",
      "body-2",
    ]);
    expect(view.find((r) => r.id === "card-0")?.depth).toBe(1);
    expect(view.find((r) => r.id === "header-1")?.depth).toBe(2);
    expect(path.map((r) => r.id)).toStrictEqual(["card-0"]);
  });

  it("posts off-level regions hidden and draws them alongside the view", () => {
    // Dived into `body`: its sibling `header` rides along hidden.
    const { view, offLevelRegions, drawn, overrides } = composeView(
      tree,
      "body-2",
      { navigable: true, maxDepth: 1 },
    );

    expect(view.map((r) => r.id)).toStrictEqual(["body-2", "avatar-3"]);
    expect(offLevelRegions.map((r) => r.id)).toStrictEqual(["header-1"]);

    expect(drawn.map((r) => r.id)).toStrictEqual([
      "body-2",
      "avatar-3",
      "header-1",
    ]);

    expect(overrides).toStrictEqual({ "header-1": { hidden: true } });
  });

  it("resolves a stale active id to the root rather than a phantom view", () => {
    const { active, view } = composeView(tree, "gone-99", {
      navigable: true,
      maxDepth: 1,
    });

    expect(active).toBeNull();
    expect(view.map((r) => r.id)).toStrictEqual(["card-0"]);
  });

  it("takes a fixed depth and no off-level context when static", () => {
    const { view, offLevelRegions, path, overrides } = composeView(tree, null, {
      navigable: false,
      maxDepth: 2,
    });

    expect(view.map((r) => r.id)).toStrictEqual([
      "card-0",
      "header-1",
      "body-2",
    ]);
    expect(offLevelRegions).toStrictEqual([]);
    expect(path).toStrictEqual([]);
    expect(overrides).toStrictEqual({});
  });

  it("reserves gutters from the whole tree when navigable, the view when static", () => {
    const navigable = composeView(tree, null, { navigable: true, maxDepth: 1 });

    expect(navigable.labelRegions.map((r) => r.id)).toStrictEqual(
      tree.map((r) => r.id),
    );

    const staticView = composeView(tree, null, {
      navigable: false,
      maxDepth: 1,
    });

    expect(staticView.labelRegions.map((r) => r.id)).toStrictEqual(["card-0"]);
  });
});

describe("resolveOverlay", () => {
  const view = [region({ name: "card", id: "card-0" })];

  it("withholds a stale placement and draws nothing incoherent", () => {
    // Placement was solved for a different view: its identity no longer matches.
    const other = [region({ name: "other", id: "other-9" })];
    const stale = placementOf(other);

    const overlay = resolveOverlay({
      view,
      labelSizes: sizes(view),
      placement: stale,
      solvedToken: viewIdentity(other),
      fittedBox: null,
      fitted: false,
      settled: true,
    });

    expect(overlay.current).toBe(false);
    expect(overlay.labels).toStrictEqual([]);
    expect(overlay.frames).toStrictEqual([]);
    expect(overlay.labelledIds.size).toBe(0);
  });

  it("draws a placement that matches the current view", () => {
    const placement = placementOf(view);

    const overlay = resolveOverlay({
      view,
      labelSizes: sizes(view),
      placement,
      solvedToken: viewIdentity(view),
      fittedBox: null,
      fitted: false,
      settled: true,
    });

    expect(overlay.current).toBe(true);
    expect(overlay.labels.map((l) => l.region.id)).toStrictEqual(["card-0"]);
    expect(overlay.frames.map((f) => f.region.id)).toStrictEqual(["card-0"]);
    expect(overlay.labelledIds).toStrictEqual(new Set(["card-0"]));
  });

  it("marks an unlabelled frame as context via labelledIds", () => {
    // The off-level frame carries no label, so it is absent from `labelledIds`.
    const off = region({ name: "header", id: "header-1" });
    const placement: Placement = {
      labels: placementOf(view).labels,
      frames: placementOf([...view, off]).frames,
    };

    const overlay = resolveOverlay({
      view,
      labelSizes: sizes(view),
      placement,
      solvedToken: viewIdentity(view),
      fittedBox: null,
      fitted: false,
      settled: true,
    });

    const context = overlay.frames.filter(
      (f) => !overlay.labelledIds.has(f.region.id),
    );

    expect(context.map((f) => f.region.id)).toStrictEqual(["header-1"]);
  });

  it("reveals a reserved overlay from the first paint, before any placement", () => {
    const overlay = resolveOverlay({
      view,
      labelSizes: sizes(view),
      placement: null,
      solvedToken: null,
      fittedBox: null,
      fitted: false,
      settled: false,
    });

    expect(overlay.revealed).toBe(true);
    expect(overlay.padding.left).toBeGreaterThan(0);
  });

  it("withholds a fitted overlay's reveal until the fitted gutter lands", () => {
    // Fitted, settled, no placement: nothing to fit against, stays hidden.
    const pending = resolveOverlay({
      view,
      labelSizes: sizes(view),
      placement: null,
      solvedToken: null,
      fittedBox: null,
      fitted: true,
      settled: true,
    });

    expect(pending.revealed).toBe(false);

    // Placement and its box land: gutter cut, reveal follows in the same read.
    const box: Rect = { x: 0, y: 0, w: 100, h: 20 };
    const landed = resolveOverlay({
      view,
      labelSizes: sizes(view),
      placement: placementOf(view),
      solvedToken: viewIdentity(view),
      fittedBox: box,
      fitted: true,
      settled: true,
    });

    expect(landed.revealed).toBe(true);
    // The label overhangs the left edge by 60; the fitted gutter is tight to it.
    expect(landed.padding.left).toBe(60);
  });

  it("reveals a fitted overlay immediately when the view is empty", () => {
    // Nothing to fit — an empty fitted view reveals once settled.
    const overlay = resolveOverlay({
      view: [],
      labelSizes: {},
      placement: null,
      solvedToken: null,
      fittedBox: null,
      fitted: true,
      settled: true,
    });

    expect(overlay.revealed).toBe(true);
  });

  it("keeps a fitted overlay hidden while the empty view is still unsettled", () => {
    const overlay = resolveOverlay({
      view: [],
      labelSizes: {},
      placement: null,
      solvedToken: null,
      fittedBox: null,
      fitted: true,
      settled: false,
    });

    expect(overlay.revealed).toBe(false);
  });
});

describe("openablesIn", () => {
  it("names the zones with children, skipping leaves", () => {
    // `card` (header + body) and `body` (avatar) open; the leaves do not.
    expect(openablesIn(tree, null, true)).toStrictEqual(
      new Set(["card-0", "body-2"]),
    );
  });

  it("never offers to dive into the active container", () => {
    expect(openablesIn(tree, "card-0", true)).toStrictEqual(
      new Set(["body-2"]),
    );
  });

  it("opens nothing in a static overlay", () => {
    expect(openablesIn(tree, null, false)).toStrictEqual(new Set());
  });
});

describe("colourIndex", () => {
  it("indexes by tree position so a zone's colour is stable across dives", () => {
    expect(colourIndex(tree)).toStrictEqual(
      new Map([
        ["card-0", 0],
        ["header-1", 1],
        ["body-2", 2],
        ["avatar-3", 3],
      ]),
    );
  });
});
