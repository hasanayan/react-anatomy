import { describe, expect, it } from "vitest";

import { anatomyConstants } from "../constants";
import type { Constants } from "../constants";
import type { Zone } from "../geometry";
import type { LabelSize } from "../label-metrics";

import { placeZones } from "./place-labels";
import type { SolveRequest } from "./solver";
import { reviveResponse, serializeResponse } from "./worker-protocol";
import type { SolveResponse } from "./worker-protocol";

// The worker adapter's marshalling in isolation — the one place the ok/err-as-
// data wire format lives, tested without spinning a real `Worker`.

const labelSizes: Record<string, LabelSize> = {
  "media-0": { w: 48, h: 20 },
  "body-1": { w: 48, h: 20 },
};

const solvable: Zone[] = [
  { id: "media-0", rect: { x: 0, y: 0, w: 120, h: 40 }, depth: 1 },
  { id: "body-1", rect: { x: 0, y: 60, w: 120, h: 40 }, depth: 1 },
];

// Rule 9: the child shares every parent edge with the depth inset off.
const flush: Constants = { ...anatomyConstants, depthInset: 0 };
const covered: Zone[] = [
  { id: "card-0", rect: { x: 0, y: 0, w: 120, h: 40 }, depth: 1 },
  {
    id: "media-1",
    rect: { x: 0, y: 0, w: 120, h: 40 },
    depth: 2,
    parentId: "card-0",
  },
];

const request = (
  zones: Zone[],
  constants: Constants = anatomyConstants,
): SolveRequest => ({ id: 1, zones, labelSizes, overrides: {}, constants });

describe("serializeResponse", () => {
  it("carries the placement the solve computes", () => {
    expect(serializeResponse(request(solvable))).toStrictEqual({
      id: 1,
      ok: true,
      placement: placeZones(solvable, labelSizes, {}, anatomyConstants),
    });
  });

  it("flattens a hard-rule throw into message and stack data", () => {
    const response = serializeResponse(request(covered, flush));

    if (response.ok) {
      throw new Error("expected a failed response");
    }

    expect(response.message).toMatch(/no candidate segments/);
    expect(response.stack).toContain("Error");
  });
});

describe("reviveResponse", () => {
  it("passes a successful response through as a native reply", () => {
    const placement = placeZones(solvable, labelSizes, {}, anatomyConstants);

    expect(reviveResponse({ id: 2, ok: true, placement })).toStrictEqual({
      id: 2,
      ok: true,
      placement,
    });
  });

  it("rebuilds a real Error with the transported message and stack", () => {
    const wire: SolveResponse = {
      id: 3,
      ok: false,
      message: '[anatomy] zone "media-0" has no candidate segments',
      stack: "Error: staged stack",
    };

    const reply = reviveResponse(wire);

    if (reply.ok) {
      throw new Error("expected a failed reply");
    }

    expect(reply.error).toBeInstanceOf(Error);
    expect(reply.error.message).toBe(wire.message);
    expect(reply.error.stack).toBe("Error: staged stack");
  });

  it("survives the structured clone the worker boundary imposes", () => {
    const reply = reviveResponse(
      structuredClone(serializeResponse(request(covered, flush))),
    );

    if (reply.ok) {
      throw new Error("expected a failed reply");
    }

    expect(reply.error.message).toMatch(/no candidate segments/);
  });
});
