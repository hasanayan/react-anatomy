import type {
  Constants,
  LabelSize,
  Overrides,
  PlacementData,
  Zone,
} from "./place-labels";
import { placeZones } from "./place-labels";

// Runs the exact-search placement off the main thread. The search is a second of
// arithmetic on the eleven-zone story, and it used to run inline: the component
// painted first, but the page then sat frozen for the whole solve — no scroll,
// no hover, nothing. Deferring it never fixed that, because deferring a blocking
// call only moves the block. Only another thread removes it.
//
// Nothing about the answer changes here. `placeZones` is a pure function of
// zones, label sizes and constants, all of which arrive in the message, so the
// worker computes the same numbers the main thread would have — see §6. What it
// does not get is the DOM, and that is the point: `Region` carries an `el`, and
// structured clone would throw on it, so the boundary sits at `Zone` and the
// regions are re-attached on the way out.

export interface SolveRequest {
  // Monotonic, and echoed back untouched. A re-measure can land while a solve is
  // in flight, and the main thread uses this to tell a current answer from one
  // that describes geometry it has already thrown away.
  id: number;
  zones: Zone[];
  labelSizes: Record<string, LabelSize>;
  overrides: Overrides;
  constants: Constants;
}

export type SolveResponse =
  | { id: number; ok: true; placement: PlacementData }
  | { id: number; ok: false; message: string; stack?: string };

// The dedicated-worker scope, typed for exactly the two messages that cross
// this boundary. The package compiles against the DOM lib rather than the
// WebWorker one — the overlay's `new Worker(new URL(...))` needs the DOM
// globals, and the two libs cannot both be loaded without redeclaring half the
// platform — so `self` arrives typed as a `Window`, whose `postMessage` demands
// a target origin. This narrows it back to the worker contract the runtime
// actually honours.
const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<SolveRequest>) => void) | null;
  postMessage: (message: SolveResponse) => void;
};

workerSelf.onmessage = (event: MessageEvent<SolveRequest>): void => {
  const { id, zones, labelSizes, overrides, constants } = event.data;

  try {
    workerSelf.postMessage({
      id,
      ok: true,
      placement: placeZones(zones, labelSizes, overrides, constants),
    } satisfies SolveResponse);
  } catch (error) {
    // Hard rules 9 and 10 throw on purpose, and a story that dies loudly with
    // the reason is the correct outcome for a dev-time docs tool. An exception
    // in here reaches nobody, though: it would surface as an `error` event on
    // the worker, stripped of its message by the same-origin rules, or as
    // nothing at all. So the failure is posted like any other result and thrown
    // again on the other side, where someone is listening.
    const stack = error instanceof Error ? error.stack : undefined;

    workerSelf.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      ...(stack === undefined ? {} : { stack }),
    } satisfies SolveResponse);
  }
};
