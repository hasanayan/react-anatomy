import { describe, expect, it } from "vitest";

import type { Region } from "./collect-regions";
import {
  childrenOf,
  collectRegions,
  hasChildren,
  pathTo,
  regionsEqual,
  selectDepth,
  selectLevel,
  siblingsOf,
} from "./collect-regions";

// jsdom lays nothing out, so every rect is zero — fine: the tree comes from
// `data-slot` ancestry, not geometry (the property §9 needs).
function build(html: string): HTMLElement {
  const root = document.createElement("div");

  root.innerHTML = html;

  return root;
}

const card = (): HTMLElement =>
  build(`
    <div data-slot="media"></div>
    <div data-slot="heading">
      <div data-slot="icon"></div>
      <div class="not-a-slot">
        <div data-slot="title">
          <div data-slot="text"></div>
          <div data-slot="subtitle"></div>
        </div>
      </div>
      <div data-slot="attribute"></div>
      <div data-slot="attribute"></div>
    </div>
    <div data-slot="body"></div>
  `);

const names = (regions: Region[]): string[] =>
  regions.map((region) => region.name);

const at = (regions: Region[], name: string): Region => {
  const region = regions.find((candidate) => candidate.name === name);

  if (!region) {
    throw new Error(`no region named ${name}`);
  }

  return region;
};

describe("collectRegions", () => {
  it("collects every slot in the tree, not just the outermost ones", () => {
    expect(names(collectRegions(card()))).toStrictEqual([
      "media",
      "heading",
      "icon",
      "title",
      "text",
      "subtitle",
      "attribute",
      "attribute",
      "body",
    ]);
  });

  it("gives repeated names distinct ids", () => {
    const regions = collectRegions(card());
    const attributes = regions.filter((region) => region.name === "attribute");

    expect(attributes).toHaveLength(2);
    expect(attributes[0]?.id).not.toBe(attributes[1]?.id);
  });

  it("counts depth in slots, not in elements", () => {
    const regions = collectRegions(card());

    expect(at(regions, "heading").depth).toBe(1);
    expect(at(regions, "title").depth).toBe(2);
    expect(at(regions, "text").depth).toBe(3);
  });

  it("parents each region to its nearest slot ancestor", () => {
    const regions = collectRegions(card());

    expect(at(regions, "media").parentId).toBeUndefined();
    expect(at(regions, "title").parentId).toBe(at(regions, "heading").id);
    expect(at(regions, "text").parentId).toBe(at(regions, "title").id);
  });

  it("takes the scope as the root, and leaves everything outside it alone", () => {
    const regions = collectRegions(card(), "heading");

    expect(names(regions)).toStrictEqual([
      "icon",
      "title",
      "text",
      "subtitle",
      "attribute",
      "attribute",
    ]);

    expect(at(regions, "icon").depth).toBe(1);
    expect(at(regions, "icon").parentId).toBeUndefined();
    expect(at(regions, "text").depth).toBe(2);
  });
});

describe("regionsEqual", () => {
  it("holds identity across a re-measurement that changed nothing", () => {
    expect(regionsEqual(collectRegions(card()), collectRegions(card()))).toBe(
      false, // different elements — the DOM was rebuilt
    );

    const root = card();

    expect(regionsEqual(collectRegions(root), collectRegions(root))).toBe(true);
  });

  it("notices a slot appearing deep in the tree, where nothing on screen moves", () => {
    const root = card();
    const before = collectRegions(root);

    at(before, "body").el.innerHTML = '<div data-slot="chart"></div>';

    expect(regionsEqual(before, collectRegions(root))).toBe(false);
  });
});

describe("the tree", () => {
  it("reads children off the parent relation", () => {
    const regions = collectRegions(card());

    expect(names(childrenOf(regions, null))).toStrictEqual([
      "media",
      "heading",
      "body",
    ]);

    expect(names(childrenOf(regions, at(regions, "title").id))).toStrictEqual([
      "text",
      "subtitle",
    ]);

    expect(hasChildren(regions, at(regions, "title").id)).toBe(true);
    expect(hasChildren(regions, at(regions, "text").id)).toBe(false);
  });

  it("walks up from a region to the outermost one", () => {
    const regions = collectRegions(card());

    expect(names(pathTo(regions, at(regions, "text").id))).toStrictEqual([
      "heading",
      "title",
      "text",
    ]);

    expect(pathTo(regions, null)).toStrictEqual([]);
  });
});

describe("selectDepth", () => {
  it("labels the slice the static overlay always labelled", () => {
    const regions = collectRegions(card());

    expect(names(selectDepth(regions, 1))).toStrictEqual([
      "media",
      "heading",
      "body",
    ]);

    expect(names(selectDepth(regions, Infinity))).toStrictEqual(names(regions));
  });

  it("leaves depths alone, since they already count from the scope", () => {
    const regions = collectRegions(card());

    expect(at(selectDepth(regions, 2), "title").depth).toBe(2);
  });
});

describe("selectLevel", () => {
  it("opens on the outermost slots, with no container", () => {
    const regions = collectRegions(card());

    expect(names(selectLevel(regions, null))).toStrictEqual([
      "media",
      "heading",
      "body",
    ]);
  });

  it("shows the active region as container, with its direct children inside", () => {
    const regions = collectRegions(card());
    const level = selectLevel(regions, at(regions, "heading").id);

    expect(names(level)).toStrictEqual([
      "heading",
      "icon",
      "title",
      "attribute",
      "attribute",
    ]);

    expect(names(level)).not.toContain("text");
  });

  it("rebases depth onto the view, so a deep level renders like a shallow one", () => {
    const regions = collectRegions(card());
    const level = selectLevel(regions, at(regions, "title").id);

    // Tree depths are 2 and 3; the view is what rule 2 and the inset ask about.
    expect(at(level, "title").depth).toBe(1);
    expect(at(level, "text").depth).toBe(2);
  });

  it("keeps only the parent links the view can honour", () => {
    const regions = collectRegions(card());
    const level = selectLevel(regions, at(regions, "title").id);

    expect(at(level, "title").parentId).toBeUndefined();
    expect(at(level, "text").parentId).toBe(at(regions, "title").id);
  });

  it("falls back to the root when the active id names nothing", () => {
    const regions = collectRegions(card());

    expect(names(selectLevel(regions, "heading-999"))).toStrictEqual(
      names(selectLevel(regions, null)),
    );
  });
});

describe("siblingsOf", () => {
  it("is the level the active region was reached from", () => {
    const regions = collectRegions(card());

    expect(names(siblingsOf(regions, at(regions, "heading").id))).toStrictEqual(
      ["media", "body"],
    );

    expect(names(siblingsOf(regions, at(regions, "title").id))).toStrictEqual([
      "icon",
      "attribute",
      "attribute",
    ]);
  });

  it("rebases to the level it shares with the active region", () => {
    const regions = collectRegions(card());
    const siblings = siblingsOf(regions, at(regions, "title").id);

    expect(at(siblings, "icon").depth).toBe(1);
    expect(at(siblings, "icon").parentId).toBeUndefined();
  });
});
