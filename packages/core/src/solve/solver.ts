import type { Region } from "../regions/collect-regions";

import type {
  Constants,
  LabelSize,
  Overrides,
  PlacementData,
  Zone,
} from "./place-labels";
import { anatomyConstants, placeZones } from "./place-labels";
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

export type SolveResponse =
  | { id: number; ok: true; placement: PlacementData }
  | { id: number; ok: false; message: string; stack?: string };

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

// Ids, staleness and errors are `createSolver`'s, not a transport's.
export interface SolveTransport {
  post(request: SolveRequest): void;
  dispose(): void;
}

// A throw cannot cross a worker boundary intact, so failures travel as data
// here and are rebuilt into an exception by the solver. §9, §10.
export function answer(request: SolveRequest): SolveResponse {
  try {
    return {
      id: request.id,
      ok: true,
      placement: placeZones(
        request.zones,
        request.labelSizes,
        request.overrides,
        request.constants,
      ),
    };
  } catch (error) {
    const stack = error instanceof Error ? error.stack : undefined;

    return {
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      ...(stack === undefined ? {} : { stack }),
    };
  }
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
  connect: (onReply: (response: SolveResponse) => void) => SolveTransport,
): Solver {
  let pending: Pending | null = null;
  let requestId = 0;
  let disposed = false;

  const transport = connect((reply: SolveResponse): void => {
    if (!pending || reply.id !== pending.id) {
      return;
    }

    const settled = pending;

    pending = null;

    if (reply.ok) {
      settled.resolve(attachRegions(reply.placement, settled.regions));
    } else {
      const error = new Error(reply.message);

      if (reply.stack !== undefined) {
        error.stack = reply.stack;
      }

      settled.reject(error);
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

// Runs the solve on the calling thread; for tests and worker-less hosts.
export function createSyncSolver(): Solver {
  return createSolver((onReply) => ({
    post(request: SolveRequest): void {
      onReply(answer(request));
    },
    dispose(): void {},
  }));
}
