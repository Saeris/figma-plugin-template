/**
 * The UI-thread {@link Channel}, over the iframe `window`. Imported only by
 * `src/ui` — kept out of the IPC core so the core never references `window` /
 * `parent` (which don't exist in the sandbox). Figma wraps plugin messages as
 * `event.data.pluginMessage` inbound and expects `{ pluginMessage }` outbound via
 * `parent.postMessage`.
 */

import { uiBridgeOver, type UiBridge } from "./bridge.js";
import { toSubscription, type Subscription } from "./disposable.js";
import type { Channel, Envelope } from "./transport.js";

/** Build the {@link Channel} for the UI iframe over `window` / `parent`. */
export const uiChannel = (): Channel => ({
  post: (envelope): void =>
    parent.postMessage({ pluginMessage: envelope }, "*"),
  subscribe: (listener): Subscription => {
    const handler = (event: MessageEvent): void => {
      // `event.data` is `any` (DOM typing); read the Figma envelope wrapper
      // through `unknown` so nothing leaks untyped. The transport's runtime guard
      // validates the shape, so we forward the inner value as-is.
      const data: unknown = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "pluginMessage" in data
      ) {
        listener((data as { pluginMessage: unknown }).pluginMessage);
      }
    };
    window.addEventListener("message", handler);
    return toSubscription(() => window.removeEventListener("message", handler));
  }
});

/**
 * Create the {@link UiBridge} wired to the iframe `window`. The entry point for
 * the UI side of the bridge — call once and share the result across your app.
 */
export const createUiBridge = (): UiBridge => uiBridgeOver(uiChannel());
