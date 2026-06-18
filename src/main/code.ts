/**
 * Main thread (sandbox) entry — runs in Figma's QuickJS sandbox with the `figma`
 * global but no DOM. It opens the UI, then registers typed handlers for every
 * procedure the UI can `call`, and pushes `selectionChanged` events.
 *
 * This is the sandbox half of the "hello figma!" demo. Grow your plugin by adding
 * procedures/events to `src/ipc/contract.ts` and handling them here.
 */

import { createMainBridge } from "../ipc/channel.main.js";
import { installDisposeShim } from "../ipc/disposable.js";

// Seed `Symbol.dispose` before any `using` runs (the sandbox is ES2020 and may
// lack it). No-op where it already exists.
installDisposeShim();

// Open the UI. `themeColors: true` injects Figma's `--figma-color-*` variables so
// the UI matches the user's light/dark theme. `__html__` is the bundled ui.html.
figma.showUI(__html__, { themeColors: true, width: 280, height: 240 });

const bridge = createMainBridge(figma.ui);

// --- Procedure handlers: answer the UI's typed `call`s ---

bridge.handle("createRectangles", ({ count }) => {
  const nodes: SceneNode[] = [];
  for (let i = 0; i < count; i++) {
    const rect = figma.createRectangle();
    rect.x = i * 150;
    rect.fills = [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 } }];
    figma.currentPage.appendChild(rect);
    nodes.push(rect);
  }
  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
  return { created: nodes.length };
});

bridge.handle("getSelectionCount", () => ({
  count: figma.currentPage.selection.length
}));

bridge.handle("close", (input) => {
  figma.closePlugin(input?.notify);
});

// --- Events: push live document state to the UI ---

figma.on("selectionchange", () => {
  bridge.emit("selectionChanged", {
    count: figma.currentPage.selection.length
  });
});
