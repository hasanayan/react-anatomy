import { describe, expect, it } from "vitest";

import { rootLabelFor } from "./root-label";

describe("rootLabelFor", () => {
  it("uses the scope as the root when one is set", () => {
    expect(rootLabelFor("Core/Card", "heading")).toBe("heading");
  });

  it("falls back to the story title's last segment", () => {
    expect(rootLabelFor("Core/Layout/Card", undefined)).toBe("Card");
  });

  it("takes the whole title when it has no group segment", () => {
    expect(rootLabelFor("Card", undefined)).toBe("Card");
  });
});
