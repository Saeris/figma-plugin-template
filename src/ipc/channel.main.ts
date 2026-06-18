/**
 * The MAIN-thread (sandbox) {@link Channel}, over `figma.ui`. Imported only by
 * `src/main` — kept out of the IPC core so the core never references the `figma`
 * global. Uses a structural `FigmaUiLike` shape rather than the `figma` types, so
 * even this file has no hard dependency on `@figma/plugin-typings`.
 */

import { mainBridgeOver, type MainBridge } from "./bridge.js";
import { toSubscription, type Subscription } from "./disposable.js";
import type { Channel, Envelope } from "./transport.js";

/** The slice of `figma.ui` the main channel needs. */
export interface FigmaUiLike {
  postMessage: (pluginMessage: unknown) => void;
  on: (type: "message", callback: (pluginMessage: unknown) => void) => void;
  off: (type: "message", callback: (pluginMessage: unknown) => void) => void;
}

/**
 * Build the {@link Channel} for the sandbox over `figma.ui`: messages are sent
 * with `postMessage` and received via the `"message"` event. Pass `figma.ui`.
 */
export const mainChannel = (ui: FigmaUiLike): Channel => ({
  post: (envelope): void => ui.postMessage(envelope),
  subscribe: (listener): Subscription => {
    const handler = (message: unknown): void => listener(message);
    ui.on("message", handler);
    return toSubscription(() => ui.off("message", handler));
  }
});

/**
 * Create the {@link MainBridge} wired to `figma.ui`. Call after `figma.showUI`,
 * passing `figma.ui`. The entry point for the sandbox side of the bridge.
 */
export const createMainBridge = (ui: FigmaUiLike): MainBridge =>
  mainBridgeOver(mainChannel(ui));
