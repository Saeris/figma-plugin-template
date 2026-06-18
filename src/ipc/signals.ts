/**
 * Reactive renderer state, built on the TC39 Signals proposal (via
 * `signal-polyfill`). The bridge delivers state two ways — push ({@link UiBridge.on}
 * events) and pull ({@link UiBridge.call} reads) — and neither is directly a value
 * you can render. These factories turn both into a `Signal` with a synchronous
 * current value, so ANY UI framework can consume them:
 *
 * - **React** — `react.ts`'s `useSignal(sig)` (a `useSyncExternalStore` adapter).
 * - **Vue / Solid** — read `sig.get()` inside a reactive effect/computed.
 * - **Svelte** — `readable(sig.get(), (set) => { using off = subscribe(sig, set); })`.
 *
 * Ported from `@discordkit/electron`'s signals: `eventSignal` mirrors its
 * push-backed `statusSignal`; `asyncSignal` is the pull-only resource with the
 * same monotonic stale-run guard.
 *
 * This module imports `signal-polyfill`, so it's only paid for if you use signals;
 * the bridge itself does not depend on it.
 */

import { Signal } from "signal-polyfill";
import type { EventName, Events } from "./contract.js";
import { type Subscription, toSubscription } from "./disposable.js";
import type { UiBridge } from "./bridge.js";

/**
 * Subscribe to any signal and run `onChange` whenever its value changes. The
 * framework-free "call me on change" glue (a `Signal.subscribe`-style watcher over
 * the polyfill's `Watcher`). Returns a {@link Subscription} so it composes with
 * `using`.
 *
 * ```ts
 * const count = eventSignal(bridge, "selectionChanged", (p) => p.count, 0);
 * using off = subscribe(count, (n) => console.log("selection:", n));
 * ```
 */
export const subscribe = <T>(
  signal: Signal.State<T> | Signal.Computed<T>,
  onChange: (value: T) => void
): Subscription => {
  let watcher: Signal.subtle.Watcher | undefined = new Signal.subtle.Watcher(
    () => {
      // Watcher callbacks must not read signals synchronously; defer.
      queueMicrotask(() => {
        if (!watcher) return;
        onChange(signal.get());
        watcher.watch(); // re-arm
      });
    }
  );
  watcher.watch(signal);
  return toSubscription(() => {
    watcher?.unwatch(signal);
    watcher = undefined;
  });
};

/**
 * A `Signal.State<T>` fed by a bridge EVENT. Seeds with `initial`, then updates on
 * every `bridge.on(name, …)` payload (projected through `select`). Use this for
 * live document state the main thread pushes — e.g. selection, page, viewport.
 *
 * ```ts
 * const selectionCount = eventSignal(
 *   bridge, "selectionChanged", (p) => p.count, 0
 * );
 * ```
 *
 * The subscription lives for the app's lifetime; if you need to tear it down, use
 * the lower-level `bridge.on` directly.
 */
export const eventSignal = <K extends EventName, T>(
  bridge: UiBridge,
  name: K,
  select: (payload: Events[K]) => T,
  initial: T
): Signal.State<T> => {
  const state = new Signal.State<T>(initial);
  bridge.on(name, (payload) => state.set(select(payload)));
  return state;
};

/** The reactive state of an in-flight async bridge read. */
export interface AsyncState<T> {
  /** True while a run is in flight (initial load or a {@link AsyncSignal.reload}). */
  loading: boolean;
  /** The most recent successful result, or `undefined` before the first one. */
  data: T | undefined;
  /** The error from the most recent failed run, else `undefined`. */
  error: unknown;
}

/** A {@link Signal.State} of {@link AsyncState} with a `reload` to re-run the read. */
export interface AsyncSignal<T> extends Signal.State<AsyncState<T>> {
  /** Re-run the underlying read (e.g. after a mutating `call`). Resolves when settled. */
  reload: () => Promise<void>;
}

/**
 * Wrap a promise-returning bridge `call` as a reactive **resource**: a signal
 * tracking `{ loading, data, error }`, re-runnable on demand. This is the answer
 * for PULL-only reads — a `call` has no event stream to drive an auto-updating
 * signal, so instead we model the thing that's actually hard across IPC: the async
 * request lifecycle. Runs once on creation; a monotonic stale-run guard ensures a
 * slow earlier reply can't clobber a newer one.
 *
 * ```ts
 * const selection = asyncSignal(() => bridge.call("getSelectionCount"));
 * // after a mutation:
 * await bridge.call("createRectangles", { count: 3 });
 * await selection.reload();
 * ```
 *
 * For state the main thread PUSHES events for, prefer {@link eventSignal}.
 */
export const asyncSignal = <T>(read: () => Promise<T>): AsyncSignal<T> => {
  const state = new Signal.State<AsyncState<T>>({
    loading: true,
    data: undefined,
    error: undefined
  });

  // Only the latest run may write results, so an out-of-order reply from a
  // superseded run can't overwrite fresher data.
  let latestRun = 0;

  const reload = async (): Promise<void> => {
    const run = ++latestRun;
    state.set({ ...state.get(), loading: true, error: undefined });
    try {
      const data = await read();
      if (run === latestRun) {
        state.set({ loading: false, data, error: undefined });
      }
    } catch (error) {
      if (run === latestRun) {
        state.set({ loading: false, data: state.get().data, error });
      }
    }
  };

  void reload();
  return Object.assign(state, { reload }) as AsyncSignal<T>;
};
