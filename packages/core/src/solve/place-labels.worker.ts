import type { SolveRequest } from "./solver";
import { serializeResponse } from "./worker-protocol";
import type { SolveResponse } from "./worker-protocol";

// Runs the solve off the main thread. Errors cross as data inside the response
// — a worker `error` event would arrive stripped by same-origin rules.

// The package compiles against the DOM lib (the overlay needs `new Worker`),
// so `self` is typed as `Window`; narrow it to the actual worker contract.
const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<SolveRequest>) => void) | null;
  postMessage: (message: SolveResponse) => void;
};

workerSelf.onmessage = (event: MessageEvent<SolveRequest>): void => {
  workerSelf.postMessage(serializeResponse(event.data));
};
