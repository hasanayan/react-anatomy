import type { Region } from "./collect-regions";
import { collectRegions } from "./collect-regions";
import { whenLabelFontReady } from "./measure-labels";
import { regionsEqual } from "./region-tree";

// Provisional first delivery is synchronous (before `observeRegions` returns)
// so a caller reserves gutters from names early; deliveries are deduped.

export interface ObserveRegionsOptions {
  scope?: string;
  // Flips false->true once, on the settle delivery, which fires even when
  // regions are unchanged.
  onChange: (regions: Region[], settled: boolean) => void;
}

export function observeRegions(
  root: HTMLElement,
  options: ObserveRegionsOptions,
): () => void {
  const { scope, onChange } = options;

  let disposed = false;
  // Last set delivered and its flag; dedup skips a delivery unless regions
  // changed or the settle flag flipped.
  let delivered: Region[] | null = null;
  let deliveredSettled = false;

  let rootResize: ResizeObserver | undefined;
  let mutation: MutationObserver | undefined;
  // Re-attached to the current regions on every change; its targets move.
  let slotResize: ResizeObserver | undefined;

  const observeSlots = (regions: Region[]): void => {
    slotResize?.disconnect();
    slotResize = new ResizeObserver(remeasure);

    for (const region of regions) {
      slotResize.observe(region.el);
    }
  };

  const deliver = (next: Region[], settled: boolean): void => {
    if (disposed) {
      return;
    }

    const changed = delivered === null || !regionsEqual(delivered, next);

    // A settle flip is never skipped; every other delivery needs a real change.
    if (!changed && settled === deliveredSettled) {
      return;
    }

    // On a settle-only flip the sets are value-equal, so hand back the prior
    // array: this module owns the dedup, and a stable reference lets callers
    // rely on identity instead of re-running the comparison themselves.
    const regions = changed ? next : (delivered ?? next);

    delivered = regions;
    deliveredSettled = settled;

    // A bare settle flip leaves the same elements under the same observer.
    if (changed) {
      observeSlots(regions);
    }

    onChange(regions, settled);
  };

  function remeasure(): void {
    deliver(collectRegions(root, scope), deliveredSettled);
  }

  // Provisional pass: synchronous, before returning. Not for the solve.
  deliver(collectRegions(root, scope), false);

  // Text metrics move when a web font swaps in, so nothing is solved until the
  // label font loads. Then re-measure and start watching for late content.
  void whenLabelFontReady().then(() => {
    if (disposed) {
      return;
    }

    deliver(collectRegions(root, scope), true);

    rootResize = new ResizeObserver(remeasure);
    rootResize.observe(root);

    mutation = new MutationObserver(remeasure);
    mutation.observe(root, { childList: true, subtree: true });
  });

  return (): void => {
    disposed = true;
    rootResize?.disconnect();
    mutation?.disconnect();
    slotResize?.disconnect();
  };
}
