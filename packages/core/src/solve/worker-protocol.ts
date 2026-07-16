import { placeZones } from "./place-labels";
import type { PlacementData } from "./place-labels";
import type { SolveReply, SolveRequest } from "./solver";

// The wire format across the worker boundary: a throw can't be structured-
// cloned, so a failed solve travels as data and is rebuilt into an Error on
// receipt. Confined to the worker adapter — the sync path never serializes, and
// the `Solver` interface speaks real exceptions.

export type SolveResponse =
  | { id: number; ok: true; placement: PlacementData }
  | { id: number; ok: false; message: string; stack?: string };

// Worker side: run the solve and flatten any throw to data. §9, §10.
export function serializeResponse(request: SolveRequest): SolveResponse {
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

// Main-thread side: rebuild the Error the worker couldn't send, so awaiters see
// a real throw with its message and stack intact.
export function reviveResponse(response: SolveResponse): SolveReply {
  if (response.ok) {
    return { id: response.id, ok: true, placement: response.placement };
  }

  const error = new Error(response.message);

  if (response.stack !== undefined) {
    error.stack = response.stack;
  }

  return { id: response.id, ok: false, error };
}
