import { labelFont, labelHeight } from "../label-metrics";
import type { LabelSize } from "../label-metrics";

import type { Region } from "./collect-regions";

// DOM adapter for label measurement; the `typeof document` guards are its SSR
// posture, not the solve's.

// An offscreen span, not canvas `measureText`: the DOM's mono stack (SF Mono)
// and canvas's fallback (Courier) differ enough to mis-size the box.
let measureSpan: HTMLSpanElement | undefined;

function labelMeasurer(): HTMLSpanElement {
  if (measureSpan === undefined) {
    measureSpan = document.createElement("span");
    measureSpan.style.cssText =
      "position:absolute;visibility:hidden;top:-9999px;left:-9999px;" +
      `white-space:nowrap;padding:1px 5px;box-sizing:border-box;font:${labelFont};`;
    document.body.appendChild(measureSpan);
  }

  return measureSpan;
}

// `document.fonts.ready` can settle before the `--font-mono` face is requested,
// so `fonts.load` forces the request first; then `ready` waits it out.
export async function whenLabelFontReady(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const family = getComputedStyle(labelMeasurer()).fontFamily;

  try {
    await document.fonts.load(`600 10px ${family}`);
  } catch {
    // A malformed family string throws here; observers still catch later swaps.
  }

  await document.fonts.ready;
}

function measureLabelWidth(text: string): number {
  if (typeof document === "undefined") {
    return text.length * 7 + 12; // deterministic fallback for non-DOM builds
  }

  const span = labelMeasurer();

  span.textContent = text;

  return Math.ceil(span.getBoundingClientRect().width);
}

// Label sizes keyed by region id. Callers gate the first measure on
// `whenLabelFontReady` so late web fonts don't leave padding against fallbacks.
export function measureLabelSizes(
  regions: Region[],
): Record<string, LabelSize> {
  return Object.fromEntries(
    regions.map((region) => [
      region.id,
      { w: measureLabelWidth(region.name), h: labelHeight },
    ]),
  );
}
