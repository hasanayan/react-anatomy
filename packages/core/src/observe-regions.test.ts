import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Region } from "./collect-regions";
import { observeRegions } from "./observe-regions";

// jsdom lacks ResizeObserver and document.fonts; a stub and a controllable fake
// stand in, and resolving the fake's `ready` steps past the font wait.

class ResizeObserverStub {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

let resolveFontsReady: () => void;

beforeEach(() => {
  const ready = new Promise<void>((resolve) => {
    resolveFontsReady = resolve;
  });

  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      load: (): Promise<unknown[]> => Promise.resolve([]),
      ready,
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, "fonts");
});

function build(html: string): HTMLElement {
  const root = document.createElement("div");

  root.innerHTML = html;

  return root;
}

const names = (regions: Region[]): string[] =>
  regions.map((region) => region.name);

// A macrotask: flushes the font promise and mutation observer queue at once.
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

interface Delivery {
  names: string[];
  settled: boolean;
}

function record(
  root: HTMLElement,
  scope?: string,
): {
  deliveries: Delivery[];
  dispose: () => void;
} {
  const deliveries: Delivery[] = [];

  const dispose = observeRegions(root, {
    ...(scope === undefined ? {} : { scope }),
    onChange: (regions, settled): void => {
      deliveries.push({ names: names(regions), settled });
    },
  });

  return { deliveries, dispose };
}

describe("observeRegions", () => {
  it("delivers a provisional measure synchronously, before the fonts settle", () => {
    const root = build(`<div data-slot="a"></div>`);
    const { deliveries, dispose } = record(root);

    expect(deliveries).toStrictEqual([{ names: ["a"], settled: false }]);

    dispose();
  });

  it("delivers a settled measure once the label font is ready", async () => {
    const root = build(`<div data-slot="a"></div>`);
    const { deliveries, dispose } = record(root);

    expect(deliveries).toHaveLength(1);

    resolveFontsReady();
    await tick();

    // The settle delivery fires even when regions didn't change; it flips flag.
    expect(deliveries).toStrictEqual([
      { names: ["a"], settled: false },
      { names: ["a"], settled: true },
    ]);

    dispose();
  });

  it("re-measures on a subtree mutation, delivering the new region settled", async () => {
    const root = build(`<div data-slot="a"></div>`);
    const { deliveries, dispose } = record(root);

    resolveFontsReady();
    await tick();

    const extra = document.createElement("div");

    extra.setAttribute("data-slot", "b");
    root.appendChild(extra);
    await tick();

    expect(deliveries.at(-1)).toStrictEqual({
      names: ["a", "b"],
      settled: true,
    });

    dispose();
  });

  it("delivers nothing when a re-measure finds the same regions", async () => {
    const root = build(`<div data-slot="a"></div>`);
    const { deliveries, dispose } = record(root);

    resolveFontsReady();
    await tick();

    const before = deliveries.length;

    root.appendChild(document.createElement("span"));
    await tick();

    expect(deliveries).toHaveLength(before);

    dispose();
  });

  it("delivers nothing after dispose, even when the font promise resolves later", async () => {
    const root = build(`<div data-slot="a"></div>`);
    const { deliveries, dispose } = record(root);

    expect(deliveries).toHaveLength(1);

    dispose();
    resolveFontsReady();
    await tick();

    const orphan = document.createElement("div");

    orphan.setAttribute("data-slot", "b");
    root.appendChild(orphan);
    await tick();

    expect(deliveries).toHaveLength(1);
  });
});
