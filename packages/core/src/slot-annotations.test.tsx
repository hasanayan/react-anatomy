import type { ReactElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fitPadding } from "./gutters";
import type { Overrides } from "./place-labels";
import { labelHeight } from "./place-labels";
import { SlotAnnotations } from "./slot-annotations";
import type { Solver } from "./solver";
import { createSyncSolver } from "./solver";
import type { Placement } from "./zones";

// Pins that the mounted component threads measure→solve into exactly one solve
// per settle, none for a no-op re-measure, and a fresh one per real change/dive.

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lacks ResizeObserver; the session is driven through subtree mutations.
class ResizeObserverStub {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom returns a zero rect for everything; slots carry their box in
// `data-rect` and label width is faked per character.
function rectOf(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  } as DOMRect;
}

Element.prototype.getBoundingClientRect = function (): DOMRect {
  const encoded = (this as HTMLElement).dataset?.["rect"];

  if (encoded !== undefined) {
    const parts = encoded.split(",").map(Number);

    return rectOf(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0);
  }

  // Label measurer: a hidden span, 6px per character — deterministic, non-zero.
  const text = this.textContent ?? "";

  if (this.tagName === "SPAN" && text.length > 0) {
    return rectOf(0, 0, text.length * 6, labelHeight);
  }

  return rectOf(0, 0, 0, 0);
};

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

const mounted: { container: HTMLElement; root: Root }[] = [];

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }

  Reflect.deleteProperty(document, "fonts");
});

interface SolveCall {
  overrides: Overrides;
  result: Promise<Placement | null>;
}

// Delegates to the sync adapter and records each call's overrides and result.
function recordingSolver(): { solver: Solver; calls: SolveCall[] } {
  const inner = createSyncSolver();
  const calls: SolveCall[] = [];

  return {
    calls,
    solver: {
      solve(
        regions,
        labelSizes,
        overrides = {},
        constants,
      ): Promise<Placement | null> {
        const result = inner.solve(regions, labelSizes, overrides, constants);

        calls.push({ overrides, result });

        return result;
      },
      dispose(): void {
        inner.dispose();
      },
    },
  };
}

// A macrotask inside `act`: flushes the solver's microtask answer and the
// mutation observer's later-tick queue together.
const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function render(ui: ReactElement): Promise<{
  container: HTMLElement;
  root: Root;
}> {
  const container = document.createElement("div");

  document.body.appendChild(container);

  let root: Root | undefined;

  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });

  if (!root) {
    throw new Error("root was not created");
  }

  const handle = { container, root };

  mounted.push(handle);

  return handle;
}

// Resolve the font wait and flush: flips settled and posts the first solve.
async function settle(): Promise<void> {
  resolveFontsReady();
  await flush();
}

// Two outermost slots, one a container with two children — enough to dive into.
function card(): ReactElement {
  return (
    <>
      <div data-slot="media" data-rect="10,10,120,40" />
      <div data-slot="card" data-rect="10,80,200,120">
        <div data-slot="title" data-rect="20,90,120,30" />
        <div data-slot="footer" data-rect="20,140,120,30" />
      </div>
    </>
  );
}

const chips = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("span, button")]
    .map((el) => el.textContent ?? "")
    .filter((text) => text.length > 0);

describe("SlotAnnotations session", () => {
  it("posts exactly one solve per settle", async () => {
    const { solver, calls } = recordingSolver();

    await render(<SlotAnnotations solver={solver}>{card()}</SlotAnnotations>);

    // Nothing solved before the font wait lands.
    expect(calls).toHaveLength(0);

    await settle();

    expect(calls).toHaveLength(1);
  });

  it("does not re-solve when a re-measure finds the same regions", async () => {
    const { solver, calls } = recordingSolver();
    const { container } = await render(
      <SlotAnnotations solver={solver}>{card()}</SlotAnnotations>,
    );

    await settle();
    expect(calls).toHaveLength(1);

    // A mutation that adds no slot: `regionsEqual` holds identity, no re-solve.
    const media = container.querySelector('[data-slot="media"]');

    if (!media) {
      throw new Error("media slot was not rendered");
    }

    await act(async () => {
      media.appendChild(document.createElement("span"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(calls).toHaveLength(1);
  });

  it("re-solves and renders the new slot when the tree changes", async () => {
    const { solver, calls } = recordingSolver();
    const { root, container } = await render(
      <SlotAnnotations solver={solver}>{card()}</SlotAnnotations>,
    );

    await settle();
    expect(calls).toHaveLength(1);
    expect(chips(container)).not.toContain("extra");

    // A real change: a new outermost slot re-solves and lands on screen.
    await act(async () => {
      root.render(
        <SlotAnnotations solver={solver}>
          {card()}
          <div data-slot="extra" data-rect="10,230,120,40" />
        </SlotAnnotations>,
      );
    });
    await flush();

    expect(calls).toHaveLength(2);
    expect(chips(container)).toContain("extra");
  });

  it("posts the off-level regions as hidden overrides on a dive", async () => {
    const { solver, calls } = recordingSolver();
    const { container } = await render(
      <SlotAnnotations solver={solver}>{card()}</SlotAnnotations>,
    );

    await settle();
    expect(calls).toHaveLength(1);
    // Root solve names the whole level — nothing off-level yet.
    expect(calls[0]?.overrides).toStrictEqual({});

    // Diving into `card`: its sibling `media` rides along hidden.
    const diveInto = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "card");

    if (!diveInto) {
      throw new Error("the card chip was not rendered as a dive button");
    }

    await act(async () => {
      diveInto.click();
    });
    await flush();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.overrides).toStrictEqual({ "media-0": { hidden: true } });
  });

  it("withholds a fitted overlay until the solve lands, then reveals it fitted", async () => {
    const { solver, calls } = recordingSolver();
    const { container } = await render(
      <SlotAnnotations solver={solver} gutters="fitted" depth={1}>
        {card()}
      </SlotAnnotations>,
    );

    const wrapper = container.firstElementChild;

    if (!(wrapper instanceof HTMLElement)) {
      throw new Error("the overlay wrapper was not rendered");
    }

    // No gutter to reveal into until the solve lands.
    expect(wrapper.style.visibility).toBe("hidden");

    await settle();

    // Placement landed, fitted gutter cut, reveal in the same commit.
    expect(wrapper.style.visibility).toBe("");
    expect(calls).toHaveLength(1);

    // Applied padding is the fitted one, not the reserved bound.
    const placement = await calls[0]?.result;

    if (!placement) {
      throw new Error("the fitted solve did not resolve a placement");
    }

    const expected = fitPadding(placement, { x: 0, y: 0, w: 0, h: 0 });
    const padded = wrapper.firstElementChild;

    if (!(padded instanceof HTMLElement)) {
      throw new Error("the padded div was not rendered");
    }

    const asPx = (value: number): string => (value ? `${value}px` : "");

    expect(padded.style.paddingTop).toBe(asPx(expected.top));
    expect(padded.style.paddingRight).toBe(asPx(expected.right));
    expect(padded.style.paddingBottom).toBe(asPx(expected.bottom));
    expect(padded.style.paddingLeft).toBe(asPx(expected.left));
    expect(expected.left).toBeGreaterThan(0);
  });
});
