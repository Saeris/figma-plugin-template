/**
 * Tests the IPC bridge at its contract boundary — the one piece of this template
 * with real logic. These assert the GUARANTEES the bridge makes to plugin authors,
 * not just that messages move:
 *
 * - a `call` resolves with the handler's typed reply (request→reply correlation works),
 * - a throwing handler rejects the caller with its message (errors cross the boundary),
 * - `emit`/`on` deliver typed event payloads,
 * - `asyncSignal`'s stale-run guard prevents a slow earlier reply from clobbering
 *   a newer one — the subtle correctness property that makes reload-after-mutation safe.
 *
 * A fake in-memory {@link Channel} pair wires the two bridges together with no
 * Figma or DOM, so the protocol is exercised exactly as in production but in pure
 * Node. (If the wiring ever drifts from `figma.ui` / `window`, that's a thin
 * adapter in `transport.ts`, not contract logic — so it lives outside these tests.)
 */

import { describe, expect, it, vi } from "vitest";
import { mainBridgeOver, uiBridgeOver } from "../ipc/bridge.js";
import { asyncSignal, eventSignal, subscribe } from "../ipc/signals.js";
import type { Channel, Envelope } from "../ipc/transport.js";

/**
 * A connected pair of in-memory {@link Channel}s. Posting on one delivers
 * (asynchronously, like a real `postMessage`) to the other's subscribers.
 */
const channelPair = (): [Channel, Channel] => {
  const aListeners = new Set<(e: Envelope) => void>();
  const bListeners = new Set<(e: Envelope) => void>();
  const deliver = (to: Set<(e: Envelope) => void>, e: Envelope): void => {
    // Defer so the round-trip is genuinely async, matching postMessage semantics.
    queueMicrotask(() => {
      for (const listener of to) listener(e);
    });
  };
  const make = (
    own: Set<(e: Envelope) => void>,
    other: Set<(e: Envelope) => void>
  ): Channel => ({
    post: (envelope) => deliver(other, envelope),
    subscribe: (listener) => {
      own.add(listener);
      return Object.assign(() => own.delete(listener), {
        [Symbol.dispose]: () => own.delete(listener)
      });
    }
  });
  return [make(aListeners, bListeners), make(bListeners, aListeners)];
};

const connectedBridges = (): {
  ui: ReturnType<typeof uiBridgeOver>;
  main: ReturnType<typeof mainBridgeOver>;
} => {
  const [uiChan, mainChan] = channelPair();
  return { ui: uiBridgeOver(uiChan), main: mainBridgeOver(mainChan) };
};

describe("bridge call/handle", () => {
  it("resolves a call with the handler's typed reply", async () => {
    const { ui, main } = connectedBridges();
    main.handle("createRectangles", ({ count }) => ({ created: count }));

    const result = await ui.call("createRectangles", { count: 5 });

    // The reply is typed as { created: number } from the contract, no cast.
    expect(result).toEqual({ created: 5 });
  });

  it("routes each call to its own handler", async () => {
    const { ui, main } = connectedBridges();
    main.handle("createRectangles", ({ count }) => ({ created: count }));
    main.handle("getSelectionCount", () => ({ count: 2 }));

    await expect(ui.call("getSelectionCount")).resolves.toEqual({ count: 2 });
    await expect(ui.call("createRectangles", { count: 1 })).resolves.toEqual({
      created: 1
    });
  });

  it("rejects the caller when the handler throws, preserving the message", async () => {
    const { ui, main } = connectedBridges();
    main.handle("createRectangles", () => {
      throw new Error("font not loaded");
    });

    await expect(ui.call("createRectangles", { count: 1 })).rejects.toThrow(
      "font not loaded"
    );
  });

  it("rejects a call with no registered handler", async () => {
    const { ui } = connectedBridges();
    await expect(ui.call("getSelectionCount")).rejects.toThrow(/no handler/i);
  });

  it("stops dispatching after a handler subscription is disposed", async () => {
    const { ui, main } = connectedBridges();
    const off = main.handle("getSelectionCount", () => ({ count: 9 }));
    off();
    await expect(ui.call("getSelectionCount")).rejects.toThrow(/no handler/i);
  });
});

describe("bridge emit/on", () => {
  it("delivers a typed event payload from main to UI", async () => {
    const { ui, main } = connectedBridges();
    const received: number[] = [];
    ui.on("selectionChanged", ({ count }) => received.push(count));

    main.emit("selectionChanged", { count: 3 });
    await vi.waitFor(() => expect(received).toEqual([3]));
  });

  it("stops delivering after the listener is disposed", async () => {
    const { ui, main } = connectedBridges();
    const received: number[] = [];
    const off = ui.on("selectionChanged", ({ count }) => received.push(count));

    main.emit("selectionChanged", { count: 1 });
    await vi.waitFor(() => expect(received).toEqual([1]));

    off();
    main.emit("selectionChanged", { count: 2 });
    // give any erroneous delivery a chance to land before asserting absence
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toEqual([1]);
  });
});

describe("eventSignal", () => {
  it("seeds with the initial value and tracks event payloads", async () => {
    const { ui, main } = connectedBridges();
    const count = eventSignal(ui, "selectionChanged", (p) => p.count, 0);
    expect(count.get()).toBe(0);

    main.emit("selectionChanged", { count: 7 });
    await vi.waitFor(() => expect(count.get()).toBe(7));
  });
});

describe("asyncSignal stale-run guard", () => {
  it("ignores a slow earlier run when a newer reload has superseded it", async () => {
    // Two reads in flight: the FIRST resolves LAST. Without the monotonic guard,
    // the stale first reply would clobber the fresher second one. This is the
    // property that makes "mutate, then reload" safe.
    const deferreds: ((value: number) => void)[] = [];
    const read = async (): Promise<number> =>
      new Promise<number>((resolve) => deferreds.push(resolve));

    const sig = asyncSignal(read); // run #1 starts on creation
    await vi.waitFor(() => expect(deferreds).toHaveLength(1));

    const reloadPromise = sig.reload(); // run #2 starts
    await vi.waitFor(() => expect(deferreds).toHaveLength(2));

    // Resolve run #2 (the latest) first, then the stale run #1.
    deferreds[1](222);
    deferreds[0](111);
    await reloadPromise;

    // The latest run's value wins; the stale 111 is discarded.
    expect(sig.get().data).toBe(222);
    expect(sig.get().loading).toBe(false);
  });

  it("captures errors into the signal without rejecting", async () => {
    const sig = asyncSignal(async () => Promise.reject(new Error("boom")));
    await vi.waitFor(() => expect(sig.get().loading).toBe(false));
    expect((sig.get().error as Error).message).toBe("boom");
  });

  it("notifies subscribers when the resource settles", async () => {
    const sig = asyncSignal(async () => Promise.resolve(42));
    const seen: (number | undefined)[] = [];
    using _off = subscribe(sig, (state) => seen.push(state.data));
    await vi.waitFor(() => expect(sig.get().data).toBe(42));
    await vi.waitFor(() => expect(seen).toContain(42));
  });
});
