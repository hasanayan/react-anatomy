import { describe, expect, it } from "vitest";

import { anatomyConstants } from "../constants";
import type { Constants } from "../constants";
import type { LabelSize } from "../label-metrics";
import type { Region } from "../regions/collect-regions";

import { placeZones } from "./place-labels";
import { createSolver, createSyncSolver } from "./solver";
import type { SolveReply, SolveRequest, Solver } from "./solver";
import { reviveResponse, serializeResponse } from "./worker-protocol";
import type { SolveResponse } from "./worker-protocol";
import { attachRegions, toZones } from "./zones";

const region = (name: string, index: number, top: number): Region => ({
  name,
  id: `${name}-${index}`,
  depth: 1,
  top,
  left: 0,
  width: 120,
  height: 40,
  radius: "0px",
  radii: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
  el: document.createElement("div"),
});

// Two stacked regions, comfortably apart — every solve survives.
const regions = (): Region[] => [region("media", 0, 0), region("body", 1, 60)];

const sizesFor = (set: Region[]): Record<string, LabelSize> =>
  Object.fromEntries(set.map((item) => [item.id, { w: 48, h: 20 }]));

// Hand-driven transport: requests pile up in `posted`, answered only when the
// test says — the in-flight window latest-wins is about.
function harness(): {
  solver: Solver;
  posted: SolveRequest[];
  reply: (reply: SolveReply) => void;
  disposals: () => number;
} {
  const posted: SolveRequest[] = [];
  let deliver: (reply: SolveReply) => void = () => {};
  let disposed = 0;

  const solver = createSolver((onReply) => {
    deliver = onReply;

    return {
      post(request): void {
        posted.push(request);
      },
      dispose(): void {
        disposed += 1;
      },
    };
  });

  return {
    solver,
    posted,
    reply: (response): void => {
      deliver(response);
    },
    disposals: () => disposed,
  };
}

// The native reply a transport hands back for a successful solve.
const nativeReply = (request: SolveRequest): SolveReply => ({
  id: request.id,
  ok: true,
  placement: placeZones(
    request.zones,
    request.labelSizes,
    request.overrides,
    request.constants,
  ),
});

describe("latest-wins", () => {
  it("resolves a superseded solve to null and paints only the newest", async () => {
    const { solver, posted, reply } = harness();
    const set = regions();
    const sizes = sizesFor(set);

    const first = solver.solve(set, sizes);
    const second = solver.solve(set, sizes);
    const third = solver.solve(set, sizes);

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();

    expect(posted).toHaveLength(3);

    const request = posted[2];

    if (!request) {
      throw new Error("third request was not posted");
    }

    reply(nativeReply(request));

    const placement = await third;

    expect(placement).not.toBeNull();
    expect(placement?.labels.map((label) => label.region.id)).toStrictEqual(
      set.map((item) => item.id),
    );
  });

  it("drops a reply that arrives for a superseded solve", async () => {
    const { solver, posted, reply } = harness();
    const set = regions();
    const sizes = sizesFor(set);

    const first = solver.solve(set, sizes);
    const second = solver.solve(set, sizes);

    const [stale, current] = posted;

    if (!stale || !current) {
      throw new Error("requests were not posted");
    }

    reply(nativeReply(stale));
    await expect(first).resolves.toBeNull();

    reply(nativeReply(current));
    await expect(second).resolves.not.toBeNull();
  });

  it("releases an in-flight solve on dispose instead of stranding it", async () => {
    const { solver, disposals } = harness();

    const inFlight = solver.solve(regions(), sizesFor(regions()));

    solver.dispose();

    await expect(inFlight).resolves.toBeNull();
    expect(disposals()).toBe(1);

    await expect(
      solver.solve(regions(), sizesFor(regions())),
    ).resolves.toBeNull();
  });
});

describe("error rehydration", () => {
  it("rejects with the Error a transport reports, untouched", async () => {
    const { solver, posted, reply } = harness();
    const set = regions();

    const solve = solver.solve(set, sizesFor(set));
    const request = posted[0];

    if (!request) {
      throw new Error("request was not posted");
    }

    // The transport hands back a real Error (the worker adapter rebuilds it from
    // the wire); the solver just rejects with it.
    const failure = new Error(
      '[anatomy] zone "media-0" has no candidate segments',
    );

    reply({ id: request.id, ok: false, error: failure });

    await expect(solve).rejects.toBe(failure);
  });

  it("rejects identically from the synchronous adapter when a hard rule fires", async () => {
    // Rule 9 fixture: child covers all four parent edges, depth inset off.
    const flush: Constants = { ...anatomyConstants, depthInset: 0 };
    const parent = region("card", 0, 0);
    const child: Region = {
      ...region("media", 1, 0),
      depth: 2,
      parentId: parent.id,
    };

    const solver = createSyncSolver();

    await expect(
      solver.solve([parent, child], sizesFor([parent, child]), {}, flush),
    ).rejects.toThrow(/no candidate segments/);
  });
});

// The seam exists so a `Region.el` never reaches `postMessage`. A real worker
// structured-clones both ways; this transport does the same on the calling
// thread, so the contract is checked without spinning a `Worker`.
function cloningHarness(mangle: (response: SolveResponse) => SolveResponse): {
  solver: Solver;
} {
  const solver = createSolver((onReply) => ({
    post(request): void {
      // Throws if a DOM handle leaked into the request — the failure the seam
      // is here to prevent.
      const crossed = structuredClone(request);

      // Serialize on the worker side, clone across, revive on the main side —
      // exactly the worker adapter's path, checked without spinning a `Worker`.
      const wire = structuredClone(mangle(serializeResponse(crossed)));

      onReply(reviveResponse(wire));
    },
    dispose(): void {},
  }));

  return { solver };
}

describe("the worker transport contract", () => {
  it("solves across a structured clone without a DOM handle in the request", async () => {
    const set = regions();
    const { solver } = cloningHarness((response) => response);

    const placement = await solver.solve(set, sizesFor(set));

    expect(placement?.labels.map((label) => label.region.id)).toStrictEqual(
      set.map((item) => item.id),
    );
  });

  it("re-attaches the right region even when the reply comes back reordered", async () => {
    const set = regions();
    // A transport that reverses labels and frames: positional re-attach would
    // now pair every placement with the wrong region; id-keyed does not.
    const { solver } = cloningHarness((response) =>
      response.ok
        ? {
            ...response,
            placement: {
              labels: [...response.placement.labels].reverse(),
              frames: [...response.placement.frames].reverse(),
            },
          }
        : response,
    );

    const placement = await solver.solve(set, sizesFor(set));

    for (const label of placement?.labels ?? []) {
      expect(label.region.id).toBe(label.zoneId);
    }
    for (const frame of placement?.frames ?? []) {
      expect(frame.region.id).toBe(frame.zoneId);
    }
  });
});

describe("the synchronous adapter", () => {
  it("resolves the placement the pure pipeline computes", async () => {
    const set = regions();
    const sizes = sizesFor(set);

    const solver = createSyncSolver();
    const placement = await solver.solve(set, sizes);

    expect(placement).toStrictEqual(
      attachRegions(placeZones(toZones(set, anatomyConstants), sizes), set),
    );
  });

  it("returns a frame, but no label, for a hidden region", async () => {
    const set = regions();
    const sizes = sizesFor(set);
    const hidden = set[1];

    if (!hidden) {
      throw new Error("fixture lost its second region");
    }

    const solver = createSyncSolver();
    const placement = await solver.solve(set, sizes, {
      [hidden.id]: { hidden: true },
    });

    expect(placement?.labels.map((label) => label.region.id)).toStrictEqual([
      set[0]?.id,
    ]);
    expect(placement?.frames.map((frame) => frame.region.id)).toStrictEqual(
      set.map((item) => item.id),
    );
  });
});
