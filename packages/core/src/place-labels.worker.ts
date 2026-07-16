import type { SolveRequest, SolveResponse } from "./solver";
import { answer } from "./solver";

// Runs the solve off the main thread. Errors cross as data inside `answer`'s
// response — a worker `error` event would arrive stripped by same-origin rules.

// The package compiles against the DOM lib (the overlay needs `new Worker`),
// so `self` is typed as `Window`; narrow it to the actual worker contract.
const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<SolveRequest>) => void) | null;
  postMessage: (message: SolveResponse) => void;
};

workerSelf.onmessage = (event: MessageEvent<SolveRequest>): void => {
  workerSelf.postMessage(answer(event.data));
};
