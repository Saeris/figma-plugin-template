/**
 * The teardown primitive shared by every subscription in the bridge.
 *
 * A `Subscription` is an unsubscribe function that is ALSO `Disposable`, so it
 * works both ways:
 *
 * ```ts
 * const off = bridge.on("selection", handleSelection);
 * off(); // imperative teardown
 *
 * using off = bridge.on("selection", handleSelection); // scope-based teardown
 * ```
 *
 * Modeled on `@discordkit/native`'s `toSubscription` — the single place the
 * "unsubscribe + `[Symbol.dispose]`" shape is defined so every `on*` API returns
 * the exact same object.
 *
 * ## A note on `using` across the two threads
 *
 * The UI thread is a real browser iframe, where Explicit Resource Management
 * (`using` / `Symbol.dispose`) is fully supported — use it freely there.
 *
 * The main thread runs in Figma's QuickJS sandbox (ES2020+), where `Symbol.dispose`
 * is not guaranteed to exist. {@link toSubscription} therefore DEFINES
 * `Symbol.dispose` on the returned function rather than relying on it existing, and
 * {@link installDisposeShim} seeds the well-known symbol itself so a downlevel
 * `using` (compiled by tsdown/esbuild to look up `Symbol.dispose`) still resolves.
 * Calling the returned function directly always works regardless.
 */

/** An unsubscribe handle that is also a {@link Disposable} for `using`. */
export type Subscription = (() => void) & Disposable;

/**
 * Ensure `Symbol.dispose` (and `Symbol.asyncDispose`) exist on the global
 * `Symbol`. The Figma sandbox is ES2020 and may predate these well-known symbols;
 * downleveled `using` syntax looks them up by `Symbol.dispose`, so seed them once
 * at startup in the main thread before any `using` runs. No-op where they already
 * exist (e.g. the UI thread). Safe to call more than once.
 */
export const installDisposeShim = (): void => {
  const sym = Symbol as { dispose?: symbol; asyncDispose?: symbol };
  if (typeof sym.dispose !== `symbol`) {
    sym.dispose = Symbol.for(`Symbol.dispose`);
  }
  if (typeof sym.asyncDispose !== `symbol`) {
    sym.asyncDispose = Symbol.for(`Symbol.asyncDispose`);
  }
};

/**
 * Wrap a teardown function as a {@link Subscription}: idempotent (safe to call
 * more than once) and `Disposable` (works with `using`). The teardown runs at
 * most once no matter how the subscription is released.
 */
export const toSubscription = (teardown: () => void): Subscription => {
  let done = false;
  const unsubscribe = (): void => {
    if (done) return;
    done = true;
    teardown();
  };
  // `installDisposeShim` seeds `Symbol.dispose` so this computed key is a real
  // symbol in the sandbox; in the UI thread it already exists. Defining the method
  // on the returned function (rather than relying on a class) is what makes a
  // plain unsubscribe also `using`-disposable.
  return Object.assign(unsubscribe, {
    [Symbol.dispose]: unsubscribe
  });
};
