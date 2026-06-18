/**
 * React adapter for the bridge's signals. `useSignal` reads any `Signal` and
 * re-renders the component when it changes, via `useSyncExternalStore` (the
 * React-blessed way to subscribe to an external store — tear-free, Suspense-safe).
 *
 * Kept in its own module so the rest of `src/ipc` stays framework-agnostic: only
 * the UI thread (which has React) imports this.
 *
 * ```tsx
 * const selection = useMemo(() => asyncSignal(() => bridge.call("getSelectionCount")), []);
 * const { loading, data } = useSignal(selection);
 * ```
 */

import { useSyncExternalStore } from "react";
import type { Signal } from "signal-polyfill";
import { subscribe } from "./signals.js";

/**
 * Subscribe a React component to a `Signal` and return its current value.
 * Re-renders on change; unsubscribes on unmount.
 *
 * The signal should be stable across renders (create it once with `useMemo` or
 * module scope) — passing a fresh signal every render resubscribes each time.
 */
export const useSignal = <T>(signal: Signal.State<T> | Signal.Computed<T>): T =>
  useSyncExternalStore(
    (onStoreChange: () => void) => subscribe(signal, onStoreChange),
    () => signal.get(),
    () => signal.get()
  );
