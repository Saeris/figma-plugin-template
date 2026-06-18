---
name: figma-plugin-architecture
description: Explains how a Figma plugin is structured in this template — the two-thread (sandbox/UI) model, the manifest, and the typed IPC bridge. Use when adding a feature, wiring main↔UI communication, deciding which thread code belongs in, or debugging "figma is not defined" / "document is not defined" / messages not arriving.
---

# Figma Plugin Architecture (this template)

A Figma plugin runs as **two isolated contexts that share no runtime** — only a
`postMessage` channel passing structured-clonable data. Getting code in the wrong
context is the #1 source of plugin bugs. This skill is the map.

## The two threads

|           | **Main / sandbox**                                     | **UI**                                        |
| --------- | ------------------------------------------------------ | --------------------------------------------- |
| Entry     | `src/main/code.ts` → `dist/code.js` (`manifest.main`)  | `src/ui/` → `dist/index.html` (`manifest.ui`) |
| Globals   | `figma`, `__html__`                                    | `window`, `document`, full DOM                |
| Has       | the Figma scene/document API                           | browser APIs, React, `fetch`                  |
| **Lacks** | **no DOM, no `fetch`, no real `setTimeout` semantics** | **no `figma`**                                |
| Runtime   | QuickJS-in-Wasm, **ES2020+** (no guaranteed `using`)   | a real browser iframe (full modern JS)        |
| tsconfig  | `src/main/tsconfig.json` (figma typings, no DOM)       | `src/ui/tsconfig.json` (DOM + react-jsx)      |

**Rule of thumb:** anything that reads or mutates the document goes in `src/main`.
Anything that renders or uses browser APIs goes in `src/ui`. They talk only through
the bridge.

Symptoms of getting it wrong:

- `ReferenceError: figma is not defined` → you used `figma` in `src/ui`. Move it to a
  procedure handler in `src/main` and `call` it.
- `ReferenceError: document is not defined` (or `window`) → you used the DOM in
  `src/main`. Move it to the UI.

## The typed IPC bridge (`src/ipc`)

Instead of raw `postMessage` + stringly-typed `msg.type` switches, this template
ships a **tRPC-like typed bridge**. You almost never touch `postMessage` directly.

- `contract.ts` — **the single source of truth.** Define `Procedures` (request→reply
  RPC the UI calls) and `Events` (push from main→UI). Editing this file is how you
  grow the plugin's API; the bridge, transport, and signals are all generic over it.
- `bridge.ts` — the typed surface. UI gets `call`/`on`; main gets `handle`/`emit`.
- `transport.ts` — correlation-id request/reply over `postMessage` (you won't edit this).
- `channel.main.ts` / `channel.ui.ts` — the thread-specific wiring + `createMainBridge`
  / `createUiBridge` entry points.
- `signals.ts` + `react.ts` — wrap pushed events / async reads as reactive signals for
  React (`eventSignal`, `asyncSignal`, `useSignal`).
- `disposable.ts` — `Subscription` (an unsubscribe that's also `using`-compatible).

## How to add a feature (the only workflow you need)

1. **Add to the contract** (`src/ipc/contract.ts`):
   ```ts
   export interface Procedures {
     // request→reply: UI asks, main answers
     getNodeName: (input: { id: string }) => { name: string };
   }
   export interface Events {
     // push: main → UI
     pageChanged: { name: string };
   }
   ```
2. **Handle it in the sandbox** (`src/main/code.ts`):
   ```ts
   bridge.handle("getNodeName", async ({ id }) => {
     const node = await figma.getNodeByIdAsync(id);
     return { name: node?.name ?? "(unknown)" };
   });
   // push an event:
   figma.on("currentpagechange", () =>
     bridge.emit("pageChanged", { name: figma.currentPage.name })
   );
   ```
3. **Use it in the UI** (`src/ui/App.tsx`):
   ```ts
   const { name } = await bridge.call("getNodeName", { id });
   using off = bridge.on("pageChanged", ({ name }) => setPage(name));
   ```

That's it — types flow end to end. A typo in a procedure name or payload is a compile
error, not a silent runtime no-op.

## Pitfalls

- **Only structured-clonable data crosses the bridge.** No functions, class instances,
  DOM nodes, or Figma node objects — pass ids/plain data and re-resolve nodes in the
  sandbox.
- **`documentAccess: "dynamic-page"`** (set in `figma.manifest.ts`) means pages load
  lazily: use the **async** API (`getNodeByIdAsync`, `loadAllPagesAsync`), not the sync
  getters, for anything off the current page.
- **`using` lives in the UI thread.** The sandbox is ES2020; `code.ts` calls
  `installDisposeShim()` at startup so `using` works there too, but prefer plain
  `const off = …; off()` in the sandbox if in doubt.
- **No true HMR.** See the dev loop in the README: the sandbox rebuilds on change and
  Figma re-runs the plugin; the UI alone can get real HMR in a browser tab.

## Related skills

- `figma-plugin-api-reference` — the `figma.*` surface you call inside handlers.
- `figma-plugin-ui-theming` — making the UI match Figma's light/dark theme.
- `figma-plugin-publishing` — manifest prep and shipping to the Community.
