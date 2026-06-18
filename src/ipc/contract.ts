/**
 * The IPC contract — the single source of truth for everything that crosses the
 * sandbox↔UI boundary. Both threads import these types, so a change here is a
 * compile error on whichever side falls out of sync. This is the piece that makes
 * the bridge tRPC-like: the transport is untyped `postMessage`, but every `call`
 * and `on` is typed against this contract.
 *
 * Two kinds of message:
 *
 * - **Procedures** ({@link Procedures}) — request→reply RPC. The UI `call`s a
 *   procedure; the main thread handles it and returns a value (the reply travels
 *   back over a correlation id, see `transport.ts`). Model your plugin's actions
 *   and reads here (`createRectangles`, `getSelectionCount`, …).
 * - **Events** ({@link Events}) — fire-and-forget push from main→UI. The main
 *   thread `emit`s; the UI `on`s. Model live document state here
 *   (`selectionChanged`, …).
 *
 * Replace the example members below with your plugin's real surface. The bridge,
 * transport, and signals are all generic over these maps — you only edit this file
 * to grow the API.
 */

/**
 * Request→reply procedures the UI can `call` and the main thread handles.
 * Each entry is `(input) => output`; either may be `void`. Inputs and outputs
 * must be structured-clonable (no functions, DOM nodes, or class instances) —
 * everything crossing `postMessage` is cloned.
 */
export interface Procedures {
  /** Create `count` orange rectangles on the current page; returns how many were made. */
  createRectangles: (input: { count: number }) => { created: number };
  /** Read the number of currently selected nodes. */
  getSelectionCount: () => { count: number };
  /** Close the plugin (optionally surfacing a toast first). */
  close: (input?: { notify?: string }) => void;
}

/**
 * Push events the main thread `emit`s and the UI `on`s. Each entry is the payload
 * type for that event (use `void` for payload-less events).
 */
export interface Events {
  /** Fired whenever the document selection changes, with the new count. */
  selectionChanged: { count: number };
}

// --- derived helper types (you should not need to touch these) ---

/** Names of all procedures. */
export type ProcedureName = keyof Procedures;
/** Names of all events. */
export type EventName = keyof Events;

/** The input type of procedure `K` (its single argument, or `undefined`). */
export type ProcedureInput<K extends ProcedureName> = Procedures[K] extends (
  input: infer I
) => unknown
  ? I
  : undefined;

/** The resolved output type of procedure `K`. */
export type ProcedureOutput<K extends ProcedureName> = Awaited<
  ReturnType<Procedures[K]>
>;

/** A handler for procedure `K`, as registered on the main thread. May be async. */
export type ProcedureHandler<K extends ProcedureName> = (
  input: ProcedureInput<K>
) => ProcedureOutput<K> | Promise<ProcedureOutput<K>>;

/** A listener for event `K`, as registered on the UI thread. */
export type EventHandler<K extends EventName> = (payload: Events[K]) => void;
