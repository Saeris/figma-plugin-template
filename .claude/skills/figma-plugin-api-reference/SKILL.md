---
name: figma-plugin-api-reference
description: Quick reference for the figma.* Plugin API used inside sandbox (src/main) handlers — creating/reading nodes, fonts, selection, viewport, notify, clientStorage, showUI options, and the dynamic-page async API. Use when writing or debugging code in src/main that manipulates the Figma document.
---

# Figma Plugin API Reference

The `figma` global is available **only in the sandbox** (`src/main`). Call these
inside your `bridge.handle(...)` procedures. Full docs:
https://developers.figma.com/docs/plugins/api/api-reference/

## Lifecycle & UI

```ts
figma.showUI(__html__, { themeColors: true, width, height }); // open the UI iframe
figma.closePlugin(notifyMessage?);  // end the plugin (one-shot plugins)
figma.notify("Saved", { timeout: 2000, error?: boolean }); // toast
figma.on("run" | "selectionchange" | "currentpagechange" | "close", handler);
```

`showUI` options worth knowing: `themeColors` (inject `--figma-color-*` vars — see
`figma-plugin-ui-theming`), `width`/`height`, `visible: false` (run headless), `title`.

## Reading the document

```ts
figma.currentPage.selection;          // SceneNode[]
figma.currentPage.selection.length;   // common: how many selected
figma.root;                           // the document node
figma.viewport.center / .zoom;
figma.viewport.scrollAndZoomIntoView(nodes);
```

### Dynamic-page (async) access — IMPORTANT

This template sets `documentAccess: "dynamic-page"`, so pages load lazily. Use the
**async** API for anything not guaranteed to be on the current page:

```ts
await figma.getNodeByIdAsync(id); // not figma.getNodeById (removed under dynamic-page)
await figma.loadAllPagesAsync(); // before iterating figma.root.children
await figma.currentPage.loadAsync();
const styles = await figma.getLocalPaintStylesAsync();
```

## Creating & editing nodes

```ts
const rect = figma.createRectangle();
rect.resize(width, height);
rect.x = 0;
rect.y = 0;
rect.fills = [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 } }]; // 0–1 floats, not 0–255
figma.currentPage.appendChild(rect);

figma.createFrame();
figma.createEllipse();
figma.createLine();
figma.createComponent();
figma.group(nodes, parent);
figma.flatten(nodes);
```

### Text needs a loaded font first

```ts
const text = figma.createText();
await figma.loadFontAsync({ family: "Inter", style: "Regular" }); // REQUIRED before set
text.characters = "Hello";
text.fontSize = 24;
```

Forgetting `loadFontAsync` throws "Cannot write to node … font is not loaded" — a very
common error. Load every font/style you'll use, including for edits to existing text.

## Persistence

```ts
await figma.clientStorage.setAsync(key, value); // per-user, per-plugin, local
const v = await figma.clientStorage.getAsync(key);
node.setPluginData(key, stringValue); // stored ON the node, in the file
node.getPluginData(key);
node.setSharedPluginData(namespace, key, value); // readable by other plugins
```

`clientStorage` is the usual choice for plugin settings. `setPluginData` travels with
the document and is shared with collaborators.

## Parameters & relaunch (optional UX)

```ts
figma.parameters.on("input", ({ key, query, result }) => {
  /* quick-actions input */
});
node.setRelaunchData({ edit: "Edit this thing" }); // adds a button in the properties panel
```

## Gotchas

- **Colors are 0–1 floats**, not 0–255. `{ r: 1, g: 0.5, b: 0 }` is orange.
- **`fills`/`strokes` are immutable arrays** — assign a new array, don't mutate in place.
- **Node objects can't cross the IPC bridge.** Return ids/plain data to the UI; resolve
  nodes again in the sandbox via `getNodeByIdAsync`.
- **Async everywhere** under dynamic-page — prefer the `*Async` variants.

## Related skills

- `figma-plugin-architecture` — where this code runs and how the UI calls it.
- `figma-plugin-ui-theming` — the UI-side counterpart for theme-matched styling.
