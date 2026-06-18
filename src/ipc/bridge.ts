/**
 * The typed bridge: projects the untyped {@link Transport} into a surface typed
 * against the {@link Procedures}/{@link Events} contract. This is the API your
 * plugin code actually uses — the `postMessage` plumbing disappears behind it.
 *
 * Two asymmetric halves, because the threads have asymmetric roles:
 *
 * - **UI** gets {@link UiBridge}: `call` a procedure (typed input → typed reply
 *   promise) and `on` an event (typed payload). The UI drives; it never handles.
 * - **Main** gets {@link MainBridge}: `handle` each procedure (the responder) and
 *   `emit` events. The main thread serves; it never calls.
 *
 * Both are generic only over the contract, so growing the API means editing
 * `contract.ts` — never this file.
 */

import type {
  EventHandler,
  EventName,
  Events,
  ProcedureHandler,
  ProcedureInput,
  ProcedureName,
  ProcedureOutput
} from "./contract.js";
import { toSubscription, type Subscription } from "./disposable.js";
import { createTransport, type Channel } from "./transport.js";

/** The UI-thread bridge: `call` procedures, `on` events. */
export interface UiBridge {
  /**
   * Invoke a main-thread procedure and await its typed reply.
   *
   * ```ts
   * const { created } = await bridge.call("createRectangles", { count: 5 });
   * ```
   */
  call: <K extends ProcedureName>(
    name: K,
    // The input arg is omittable when the procedure takes `void` OR an optional
    // input (i.e. `undefined` is assignable to it) — so `call("close")` and
    // `call("close", { notify })` both typecheck.
    ...input: undefined extends ProcedureInput<K>
      ? [input?: ProcedureInput<K>]
      : [input: ProcedureInput<K>]
  ) => Promise<ProcedureOutput<K>>;
  /**
   * Subscribe to a main-thread event. Returns a {@link Subscription} (call it, or
   * `using`, to stop listening).
   *
   * ```ts
   * using off = bridge.on("selectionChanged", ({ count }) => setCount(count));
   * ```
   */
  on: <K extends EventName>(name: K, handler: EventHandler<K>) => Subscription;
}

/** The main-thread bridge: `handle` procedures, `emit` events. */
export interface MainBridge {
  /**
   * Register the handler for a procedure. The last registration for a given name
   * wins; the returned {@link Subscription} removes it.
   *
   * ```ts
   * bridge.handle("createRectangles", ({ count }) => {
   *   // ...create nodes...
   *   return { created: count };
   * });
   * ```
   */
  handle: <K extends ProcedureName>(
    name: K,
    handler: ProcedureHandler<K>
  ) => Subscription;
  /**
   * Push an event to the UI.
   *
   * ```ts
   * bridge.emit("selectionChanged", { count: figma.currentPage.selection.length });
   * ```
   */
  emit: <K extends EventName>(name: K, payload: Events[K]) => void;
}

/**
 * Build a {@link UiBridge} over a {@link Channel}. Prefer {@link createUiBridge}
 * in the UI thread; pass an explicit channel only for tests or custom transports.
 */
export const uiBridgeOver = (channel: Channel): UiBridge => {
  const transport = createTransport(channel);
  // The transport speaks `unknown`; the bridge is the single seam that re-applies
  // the contract types. Build the impl against the transport's loose signatures,
  // then assert to `UiBridge` once — the unavoidable erasure cast lives in exactly
  // one reviewed place (see the disable below), not scattered per call site.
  const impl = {
    call: async (name: string, input: unknown): Promise<unknown> =>
      transport.request(name, input),
    on: (name: string, handler: (payload: unknown) => void): Subscription =>
      transport.onEvent(name, handler)
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- erasure seam: the transport is intentionally untyped; the contract re-applies types here.
  return impl as unknown as UiBridge;
};

/**
 * Build a {@link MainBridge} over a {@link Channel}. Prefer {@link createMainBridge}
 * in the sandbox; pass an explicit channel only for tests or custom transports.
 *
 * Registered handlers are dispatched by name; `handle` for an unknown procedure
 * rejects the caller with a clear error.
 */
export const mainBridgeOver = (channel: Channel): MainBridge => {
  const transport = createTransport(channel);
  // `never` input makes every procedure handler (whatever its typed input)
  // contravariantly assignable here, so dispatch needs no cast. This is the main
  // side's type-erasure seam, mirroring the UI side's output erasure.
  const handlers = new Map<string, (input: never) => unknown>();

  // `respond` wants a promise-returning handler. We `await` the dispatched
  // handler's result so a sync handler, a sync throw, and a rejected promise all
  // surface uniformly as this function's rejection — which the transport
  // serializes back to the caller.
  transport.respond(async (name, input) => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`No handler registered for "${name}"`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- erasure seam: the wire input is `unknown`; the contract guarantees it matches this handler's typed input.
    return await handler(input as never);
  });

  return {
    handle: (name, handler) => {
      handlers.set(name, handler);
      return toSubscription(() => {
        if (handlers.get(name) === handler) handlers.delete(name);
      });
    },
    emit: (name, payload) => transport.emit(name, payload)
  };
};
