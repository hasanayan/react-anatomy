import { describe, expect, it } from "vitest";

import type { Region } from "./collect-regions";
import { collectRegions } from "./collect-regions";

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
