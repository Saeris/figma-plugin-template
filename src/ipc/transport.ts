/**
 * The wire layer: a correlation-id request/reply protocol on top of Figma's
 * fire-and-forget `postMessage`, plus the thread-specific endpoint adapters.
 *
 * Electron's IPC has a built-in `invoke` (request→reply); `postMessage` does not.
 * So this is the one piece we add beyond the `@discordkit/electron` design: each
 * request carries a unique `id`; the responder echoes it on the reply; the pending
 * promise resolves when an envelope with the matching `id` comes back. Everything
 * above this (`bridge.ts`, `signals.ts`) is generic and transport-agnostic.
 *
 * A {@link Channel} is the minimal duplex primitive — `post` one envelope, and
 * `subscribe` to incoming ones. The thread-specific channels live next to their
 * thread (`channel.main.ts` over `figma.ui`, `channel.ui.ts` over `window`) so
 * this core never references `figma` or `window` and stays buildable on both
 * sides; tests inject a fake pair (see `__tests__/contract.spec.ts`).
 */

import { toSubscription, type Subscription } from "./disposable.js";

/** The three envelope kinds that travel over a {@link Channel}. */
export type Envelope =
  | { kind: "request"; id: number; name: string; input: unknown }
  | { kind: "response"; id: number; ok: true; output: unknown }
  | { kind: "response"; id: number; ok: false; error: string }
  | { kind: "event"; name: string; payload: unknown };

/**
 * A duplex message channel: send one {@link Envelope}, and register a listener for
 * incoming ones (returns an unsubscribe). This is the only surface the protocol
 * depends on, so any transport — Figma's `postMessage`, or a fake in tests —
 * satisfies it.
 */
export interface Channel {
  post: (envelope: Envelope) => void;
  /**
   * Register a listener for inbound messages. The payload is `unknown` because it
   * comes off the wire untyped; {@link createTransport} narrows it with a runtime
   * `kind` guard, so the channel adapters never need to cast.
   */
  subscribe: (listener: (message: unknown) => void) => Subscription;
}

/** Runtime guard: is `value` a well-formed {@link Envelope}? */
const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  typeof (value as { kind: unknown }).kind === "string";

/**
 * The transport pair built over a {@link Channel}: `request` performs a typed
 * round-trip (used by the UI side's `call`), `respond` registers the responder
 * (used by the main side), `emit` pushes an event, and `onEvent` listens for one.
 * `bridge.ts` projects this into the contract-typed `call`/`on`/`emit`/`handle`.
 */
export interface Transport {
  /** Send a request and resolve with its reply (or reject with the responder's error). */
  request: (name: string, input: unknown) => Promise<unknown>;
  /** Register the single handler that answers every incoming request. */
  respond: (
    handler: (name: string, input: unknown) => Promise<unknown>
  ) => Subscription;
  /** Push a fire-and-forget event. */
  emit: (name: string, payload: unknown) => void;
  /** Listen for a named event. */
  onEvent: (name: string, listener: (payload: unknown) => void) => Subscription;
}

/** Build the correlation-id {@link Transport} over any {@link Channel}. */
export const createTransport = (channel: Channel): Transport => {
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  // One shared inbound listener fans envelopes out to the right place.
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  let responder:
    | ((name: string, input: unknown) => Promise<unknown>)
    | undefined;

  channel.subscribe((message) => {
    if (!isEnvelope(message)) return; // not ours / malformed — ignore
    const envelope = message;
    switch (envelope.kind) {
      case "response": {
        const entry = pending.get(envelope.id);
        if (!entry) return; // stale or unknown id — ignore
        pending.delete(envelope.id);
        if (envelope.ok) entry.resolve(envelope.output);
        else entry.reject(new Error(envelope.error));
        return;
      }
      case "request": {
        const { id, name, input } = envelope;
        const handler = responder;
        if (!handler) {
          channel.post({
            kind: "response",
            id,
            ok: false,
            error: `No responder registered for "${name}"`
          });
          return;
        }
        void (async (): Promise<void> => {
          try {
            const output = await handler(name, input);
            channel.post({ kind: "response", id, ok: true, output });
          } catch (error) {
            channel.post({
              kind: "response",
              id,
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        })();
        return;
      }
      case "event": {
        const listeners = eventListeners.get(envelope.name);
        if (!listeners) return;
        for (const listener of listeners) listener(envelope.payload);
        return;
      }
    }
  });

  const request = async (name: string, input: unknown): Promise<unknown> => {
    const id = nextId++;
    const reply = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    channel.post({ kind: "request", id, name, input });
    return reply;
  };

  return {
    request,
    respond: (handler) => {
      responder = handler;
      return toSubscription(() => {
        if (responder === handler) responder = undefined;
      });
    },
    emit: (name, payload) => channel.post({ kind: "event", name, payload }),
    onEvent: (name, listener) => {
      let set = eventListeners.get(name);
      if (!set) {
        set = new Set();
        eventListeners.set(name, set);
      }
      set.add(listener);
      return toSubscription(() => {
        set.delete(listener);
        if (set.size === 0) eventListeners.delete(name);
      });
    }
  };
};
