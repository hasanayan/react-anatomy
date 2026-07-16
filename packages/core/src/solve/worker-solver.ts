// `?worker&inline` embeds the worker as a base64 blob, so `dist` ships no
// separate worker file and hosts need no worker-specific config.
import PlaceLabelsWorker from "./place-labels.worker?worker&inline";
import { createSolver } from "./solver";
import type { Solver } from "./solver";
import { reviveResponse } from "./worker-protocol";
import type { SolveResponse } from "./worker-protocol";

// In its own module so nothing else drags the inlined worker blob in. One
// worker per solver, off-thread so the page stays interactive during a solve.
// eslint-disable-next-line import/prefer-default-export -- barrel re-exports this by name
export function createWorkerSolver(): Solver {
  return createSolver((onReply) => {
    const worker = new PlaceLabelsWorker();

    worker.onmessage = (event: MessageEvent<SolveResponse>): void => {
      onReply(reviveResponse(event.data));
    };

    return {
      post(request): void {
        worker.postMessage(request);
      },
      dispose(): void {
        worker.terminate();
      },
    };
  });
}
