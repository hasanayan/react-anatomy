import { anatomyConstants } from "../constants";
import type { Constants } from "../constants";
import type { Zone } from "../geometry";
import type { LabelSize } from "../label-metrics";
import type { Region } from "../regions/collect-regions";

import type { Overrides, PlacementData } from "./place-labels";
import { placeZones } from "./place-labels";
import type { Placement } from "./zones";
import { attachRegions, toZones } from "./zones";

// Latest-wins invariant: a newer `solve` supersedes those in flight, which
// resolve to null. §6.

export interface SolveRequest {
  // Monotonic, echoed back untouched, to tell a current answer from a stale one.
  id: number;
  zones: Zone[];
  labelSizes: Record<string, LabelSize>;
  overrides: Overrides;
  constants: Constants;
}

// A transport's reply in native form: a real Error on failure. Only the worker
// adapter (de)serializes — a throw can't cross `postMessage` — so this interface
// and every non-worker transport stay in exceptions, never in error-as-data.
export type SolveReply =
  | { id: number; ok: true; placement: PlacementData }
  | { id: number; ok: false; error: Error };

export interface Solver {
  // Resolves with the placement, or null when superseded or disposed before the
  // answer lands. Rejects with hard rules 9 and 10; awaiters must rethrow them.
  solve(
    regions: Region[],
    labelSizes: Record<string, LabelSize>,
    overrides?: Overrides,
    constants?: Constants,
  ): Promise<Placement | null>;
  dispose(): void;
}

// Ids and staleness are `createSolver`'s; a transport just moves requests and
// replies. Error serialization is the worker adapter's alone, not this seam's.
export interface SolveTransport {
  post(request: SolveRequest): void;
  dispose(): void;
}

interface Pending {
  id: number;
  // A `Region` carries its `el`, which cannot cross a worker boundary; the
  // reply is matched back to these regions by zone id.
  regions: Region[];
  resolve: (placement: Placement | null) => void;
  reject: (error: Error) => void;
}

export function createSolver(
  connect: (onReply: (reply: SolveReply) => void) => SolveTransport,
): Solver {
  let pending: Pending | null = null;
  let requestId = 0;
  let disposed = false;

  const transport = connect((reply: SolveReply): void => {
    if (!pending || reply.id !== pending.id) {
      return;
    }

    const settled = pending;

    pending = null;

    if (reply.ok) {
      settled.resolve(attachRegions(reply.placement, settled.regions));
    } else {
      settled.reject(reply.error);
    }
  });

  return {
    solve(
      regions: Region[],
      labelSizes: Record<string, LabelSize>,
      overrides: Overrides = {},
      constants: Constants = anatomyConstants,
    ): Promise<Placement | null> {
      // Supersede first, before the disposed check.
      pending?.resolve(null);
      pending = null;

      if (disposed) {
        return Promise.resolve(null);
      }

      const id = ++requestId;

      return new Promise((resolve, reject) => {
        pending = { id, regions, resolve, reject };

        transport.post({
          id,
          zones: toZones(regions, constants),
          labelSizes,
          overrides,
          constants,
        });
      });
    },

    dispose(): void {
      disposed = true;
      // A solve in flight resolves to null, never hangs.
      pending?.resolve(null);
      pending = null;
      transport.dispose();
    },
  };
}

// Runs the solve on the calling thread; for tests and worker-less hosts. It
// crosses no boundary, so a throw becomes a real Error reply directly — no
// serialize/rehydrate round-trip the worker adapter needs.
export function createSyncSolver(): Solver {
  return createSolver((onReply) => ({
    post(request: SolveRequest): void {
      try {
        onReply({
          id: request.id,
          ok: true,
          placement: placeZones(
            request.zones,
            request.labelSizes,
            request.overrides,
            request.constants,
          ),
        });
      } catch (error) {
        onReply({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    },
    dispose(): void {},
  }));
}
