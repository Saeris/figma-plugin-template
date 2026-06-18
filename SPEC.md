# Figma Plugin Template — Architecture Spec

> **Status:** Draft / pre-implementation. This document records the architecture
> decisions, research findings, and rationale for converting this repository
> (originally [`Saeris/library-template`](https://github.com/Saeris/library-template))
> into an opinionated Figma plugin template. It is the source of truth for _why_
> the template is shaped the way it is. Once implemented, the user-facing subset
> moves into `README.md` / `ARCHITECTURE.md`; this file remains the decision log.

---

## 1. Goal

Ship a minimal **"hello figma!"** boilerplate that gets a developer from clone to a
running plugin in minutes, with **best-in-class DX on the [Vite+](https://viteplus.dev)
(`vp`) toolchain** and deep AI-assistant support. The headline differentiator over
existing templates is a **type-safe, tRPC-like IPC bridge** between the plugin's two
threads, replacing the untyped `postMessage` event-emitter pattern that every other
template ships.

Two supporting libraries may be extracted from this template **later** (explicitly
out of scope here — we prove the ideas minimally first):

1. A React Figma **UI component library** built on React Aria (a more accessible fork
   of [`figma-kit`](https://github.com/tigranpetrossian/figma-kit)).
2. A reusable **type-safe IPC helper** for main↔UI communication.

---

## 2. Starting point: what the template was

The repo was a **library template** — its entire shape assumes "build an npm package →
publish to npm":

- `package.json` declares `exports`, `publishConfig` (npm registry), `files: ["dist/**/*"]`,
  `sideEffects: false`, and a single ESM entry built by **tsdown** via `vp pack`.
- `vite.config.ts` has a `pack` block emitting one `.mjs` + `.d.mts` (`dts: true`).
- CI/CD (`release.yml`, `bumpy-check.yml`) uses **Bumpy** to version-bump and
  **publish to npm via OIDC trusted publishing**.
- `src/index.ts` and `src/__tests__/index.spec.ts` are **empty**. `.bumpy/_config.json`
  still references an unrelated package (`valimock`).

**A Figma plugin is architecturally the opposite of a library.** A library is
_consumed_ by other code via `exports`; a plugin is a **deployed application** shipped
as a `manifest.json` + bundled artifacts that the Figma host loads. This changes the
build target, the entry config, and the entire release pipeline — so the npm-publishing
scaffolding is removed rather than extended.

---

## 3. Figma plugin fundamentals (research)

Sources: [Figma plugin docs](https://developers.figma.com/docs/plugins/),
[manifest reference](https://developers.figma.com/docs/plugins/manifest/),
[how plugins run](https://developers.figma.com/docs/plugins/css-variables/),
and the official [`figma/plugin-samples`](https://github.com/figma/plugin-samples) source.

### 3.1 Two-thread model

A plugin runs as **two isolated contexts** that share no runtime — only a `postMessage`
channel passing structured-clonable data:

| Thread                               | Globals             | Has                 | Lacks                                   | Built to                          |
| ------------------------------------ | ------------------- | ------------------- | --------------------------------------- | --------------------------------- |
| **Main / sandbox** (`manifest.main`) | `figma`, `__html__` | the Figma scene API | **no DOM, no `fetch`, no `setTimeout`** | one JS file (`dist/code.js`)      |
| **UI** (`manifest.ui`)               | `window`, DOM       | full browser APIs   | **no `figma`**                          | one inlined HTML (`dist/ui.html`) |

- Main → UI: `figma.ui.postMessage(msg)`; UI receives via `window.onmessage` (`event.data.pluginMessage`).
- UI → Main: `parent.postMessage({ pluginMessage: msg }, "*")`; main receives via `figma.ui.onmessage`.
- Always call `figma.closePlugin()` when done (for one-shot plugins).

The sandbox is **QuickJS compiled to Wasm**, supporting **ES2020+** (classes, private
fields, async/await, generators, modules) but **not guaranteed** to support ES2022+
Explicit Resource Management (`using` / `Symbol.dispose`) — see §6.3.

### 3.2 Manifest

Required fields: `name`, `id`, `api`, `main`, `editorType`. Newly created plugins also
require `documentAccess: "dynamic-page"`. Network access must be declared
(`networkAccess.allowedDomains`). UI theming is enabled with
`figma.showUI(__html__, { themeColors: true })`, which injects Figma's
`--figma-color-*` CSS variables and a `figma-light` / `figma-dark` class.

`manifest.id` is **assigned by Figma on first publish**; the template ships a
placeholder with a note to replace it.

### 3.3 Reference implementation

The official **`plugin-samples/esbuild-react`** is the closest prior art and was read
in full. Notable findings:

- Despite the name, **it uses Vite** (not esbuild) for the UI, via
  [`vite-plugin-singlefile`](https://www.npmjs.com/package/vite-plugin-singlefile);
  esbuild only bundles `code.js`.
- **Split source dirs** `plugin-src/` + `ui-src/`, each with **its own `tsconfig.json`**
  (incompatible `lib`: `es6` + figma typings vs. `DOM` + `react-jsx`). This per-thread
  tsconfig split is universal across the ecosystem.
- UI build inlines _everything_: `assetsInlineLimit: 100000000`, `cssCodeSplit: false`,
  `inlineDynamicImports: true` — because Figma loads exactly one HTML file.
- **Messaging is untyped** (stringly-typed `msg.type` switch). This is the weak point
  we improve on.

---

## 4. Ecosystem survey & best practices

Surveyed: Figma's official samples, [`create-figma-plugin`](https://yuanqing.github.io/create-figma-plugin/)
(the de-facto community framework), [`figma-kit`](https://github.com/tigranpetrossian/figma-kit),
and [Tokens Studio](https://github.com/tokens-studio/figma-plugin) (largest production
React plugin).

| Practice                                                    | Consensus source                      |
| ----------------------------------------------------------- | ------------------------------------- |
| Separate `main`/`ui` source dirs, per-thread tsconfig       | Official samples, create-figma-plugin |
| UI bundled to a single inlined HTML (`viteSingleFile`)      | Official Vite sample, Bolt Figma      |
| `documentAccess: "dynamic-page"` + declared `networkAccess` | Required for new plugins              |
| `themeColors: true` + `--figma-color-*` vars for theming    | Official theming API                  |
| Watch-rebuild + Figma hot-reload (no true HMR)              | Forums, Bolt, Ditto template          |
| `manifest.json` generated from one config source            | create-figma-plugin                   |
| `@figma/plugin-typings` (v1.124) via `typeRoots`/`types`    | All                                   |

**`create-figma-plugin`** — borrow the _ideas_ (config-as-single-source, typed event
ergonomics, Figma-native components), **skip the framework**: it is Preact-first
(swaps React→`preact/compat` at build) with its own `build-figma-plugin` CLI, which
conflicts with our Vite+ + React choice.

**Skills landscape** — checked skills.sh / officialskills.sh and Figma's
`community-resources/agent_skills` (40+ skills). **Every existing Figma skill is about
_using_ Figma via the MCP server** (design generation, design systems, Code Connect).
**None teach plugin _authoring_** (manifest, sandbox/UI split, postMessage, plugin
lifecycle). This template fills that gap with **original** skills rather than
re-bundling existing ones.

---

## 5. Build & tooling architecture (Vite+)

Verified against the bundled docs (`node_modules/vite-plus/docs`) and by **empirically
probing `vp`** (see §5.4).

### 5.1 Key Vite+ facts

- `vp build` runs the **standard Vite production build** — config model is **identical
  to upstream Vite** (Vite 8 + Rolldown): `build`, `plugins`, `rollupOptions`, `--mode`,
  `--watch` all behave as documented by Vite.
- `vp pack` is **tsdown / library-only** — correctly dropped (a plugin is not a library).
- **You cannot override `build`/`dev` via `package.json` scripts.** `vp build` _always_
  runs the built-in Vite build; a `package.json` "build" script is reachable only via
  `vp run build`. Orchestration must live in **`run.tasks`** in `vite.config.ts`. A task
  name cannot exist in both `package.json` and `vite.config.ts`.

### 5.2 One config, not two

The two Figma artifacts have **mutually incompatible build settings**:

- **UI** needs `viteSingleFile()`, which _globally_ mutates the build
  (`inlineDynamicImports`, `cssCodeSplit: false`, huge `assetsInlineLimit`) and expects
  an HTML input.
- **Sandbox** must be a single plain JS file (no HTML, no DOM), ES2020, IIFE.

A single `vp build` invocation applies one plugin/build config to all inputs, so the
collision (not the input count) forces **two passes**. But both passes live in **one
`vite.config.ts`** that branches on `--mode`:

```ts
// vite.config.ts (shape; final values set during implementation)
export default defineConfig(({ mode }) => {
  const base = {
    lint,
    fmt,
    test: {
      /* node env for ipc tests */
    }
  };
  if (mode === "main")
    return {
      ...base,
      build: {
        target: "es2020",
        emptyOutDir: false,
        lib: {
          entry: "src/main/code.ts",
          formats: ["iife"],
          fileName: () => "code.js"
        }
      }
    };
  // mode === "ui"
  return {
    ...base,
    root: "src/ui",
    plugins: [react(), viteSingleFile()],
    build: {
      target: "esnext",
      emptyOutDir: false,
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
      rollupOptions: { output: { inlineDynamicImports: true } }
    }
  };
});
```

### 5.3 Tasks orchestrate the two passes

```ts
run: {
  tasks: {
    "build:main": { command: "vp build --mode main",
                    input: ["src/main/**","src/ipc/**","vite.config.ts"], output: ["dist/code.js"] },
    "build:ui":   { command: "vp build --mode ui",
                    input: ["src/ui/**","src/ipc/**","vite.config.ts"], output: ["dist/index.html"] },
    manifest:     { command: "node ./scripts/manifest.mjs",
                    input: ["figma.manifest.ts"], output: ["dist/manifest.json"] },
    build: { command: ["vp run build:main", "vp run build:ui", "vp run manifest"], dependsOn: ["lint"] },
    dev:   { command: ["vp build --mode main --watch", "vp dev --mode ui"], cache: false },
  }
}
```

- Users run **`vp run build`** and **`vp run dev`** (not bare `vp build`, which is the
  raw single Vite pass — documented to avoid the known footgun).
- **Per-pass `input`/`output`** is a real DX win unique to the Vite+ task graph: editing
  UI code is a **cache hit on the sandbox build**, and vice-versa. Two separate config
  files could not provide this.
- `manifest` task runs `scripts/manifest.mjs`, which imports `figma.manifest.ts`
  (single manifest source) and writes `dist/manifest.json`.
- The `dev` task chains a sandbox `--watch` with the UI dev server; the exact
  parallelization (`vp run --parallel` vs. a `concurrently`-style helper) is finalized
  during implementation.

### 5.4 Empirical verification

Rather than assume, `vp` was probed directly:

- **`defineConfig(({ mode, command }) => ({...}))` function form is supported** — a probe
  config printed `PROBE_FN mode=ui command=build`.
- **`--mode` plumbs through** to the function config (`mode=ui`).
- **`root: "src/ui"` + html entry builds correctly** — a probe emitted `dist/index.html`
  - an `assets/*.js` chunk that `viteSingleFile()` then inlines.

---

## 6. IPC bridge — the headline feature

Both official samples and `create-figma-plugin` expose messaging as an **untyped or
cast-based event channel**. We instead ship a **tRPC-like, type-safe bridge**, modeled
on the architecture of **`@discordkit/electron`** (`C:\GitHub\@saeris\discordkit`,
PR [#60](https://github.com/discordkit/discordkit/pull/60)).

> **Why Electron's pattern ports here:** Electron and Figma plugins are the _same
> problem_ — a privileged process (Electron main / Figma sandbox) and a sandboxed UI
> (renderer / iframe) exchanging only structured-clonable messages. DiscordKit's
> insight — _don't expose the raw emitter; expose a typed `call`/`on` bridge and project
> state as Signals_ — transfers almost 1:1.

### 6.1 Primitives (ported)

| DiscordKit primitive                       | Role                                                                                                               | Figma adaptation                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `BridgeIo` = `call` + `on`                 | `call` = request→reply RPC; `on` = event sub → `Unsubscribe`                                                       | same surface, new transport (§6.2)                      |
| `Subscription = (() => void) & Disposable` | unsubscribe fn that's also `using`-compatible (`Object.assign(fn, { [Symbol.dispose]: fn })`)                      | same shim                                               |
| `statusSignal` / `asyncSignal`             | wrap push events as pull `Signal.State`; `asyncSignal` adds `{ loading, data, error }` + monotonic stale-run guard | wrap plugin→UI messages; `asyncSignal` for `call` reads |
| `useSyncExternalStore` adapter             | framework-agnostic signal → React                                                                                  | identical in UI thread                                  |

### 6.2 The one thing we invent: a correlation-id transport

Electron has `ipcRenderer.invoke` (built-in request/reply). `postMessage` is
fire-and-forget, so our `call` adds a small **correlation-id layer**: each request gets
an id; the reply echoes it; the pending promise resolves on match. ~20 lines, the only
piece beyond DiscordKit's design.

### 6.3 `using` / Explicit Resource Management — where it's safe

- **UI thread** = a real browser iframe → `using` and `Symbol.dispose` are fully
  supported. The ergonomic `using off = subscribe(sig, fn)` story lives here.
- **Main thread** = QuickJS sandbox, ES2020, **not guaranteed** to support `using`. We
  provide a `Symbol.dispose` **shim** + plain unsubscribe functions there.

`signal-polyfill` (v0.2.2, the TC39 Signals impl DiscordKit uses) works in both threads.

### 6.4 Why this is the testable core

The IPC contract is the one piece with **real logic worth unit-testing** (CLAUDE.md
Rule 9), unlike the empty placeholder spec today: a `contract.spec.ts` round-trips a
`call` through a fake transport and asserts the type-safe reply + the `asyncSignal`
stale-run guard.

---

## 7. UI layer

- **React + Vite**, bundled to a single inlined `ui.html` via `vite-plugin-singlefile`.
- **`figma-kit`** (React-native Figma components; peer `react`/`react-dom` ^18) included
  for batteries-included Figma-styled controls. **Caveat:** pre-1.0 (`0.0.0`), so it is
  **pinned exactly**.
- Styling uses Figma's official `--figma-color-*` variables via `themeColors: true` for
  automatic light/dark + FigJam theming.
- **Future:** fork `figma-kit` onto **React Aria** for a more robust, accessible
  implementation (separate from this template).

---

## 8. Project structure

```
src/
  main/
    code.ts              # sandbox entry: figma.showUI + registers RPC handlers
    tsconfig.json        # target es2020, lib es2020, @figma/plugin-typings
  ui/
    index.html
    main.tsx             # React mount
    App.tsx              # "Hello Figma!" — figma-kit Button → create rectangles via typed call()
    App.css              # --figma-color-* vars
    tsconfig.json        # DOM + react-jsx
  ipc/                   # the headline: typed tRPC-like bridge (ported from DiscordKit)
    contract.ts          # the typed RPC + event contract (single source of truth)
    transport.ts         # correlation-id call/on over postMessage (the new bit)
    bridge.ts            # createBridge(io) → typed { call, on } both sides use
    disposable.ts        # Subscription = (()=>void) & Disposable + Symbol.dispose shim
    signals.ts           # statusSignal / asyncSignal (signal-polyfill)
    react.ts             # useSignal() via useSyncExternalStore
  __tests__/
    contract.spec.ts     # round-trips a call through a fake transport; asserts reply + stale-run guard
figma.manifest.ts        # single manifest source → scripts/manifest.mjs writes dist/manifest.json
scripts/
  manifest.mjs           # imports figma.manifest.ts → dist/manifest.json
vite.config.ts           # single mode-branched config + run.tasks (build/dev/manifest)
```

---

## 9. CI/CD

Figma has **no official publish API**. The community tool
[`parrot-figcd`](https://github.com/opral/parrot-figcd) wrapped the private web API but
was **archived Jan 2026** and breaks when Figma changes its private endpoint. Honest
pipeline:

- **Keep & retarget** `ci.yml` — already good (`vp check` + `vp test` on a Node matrix).
- **Replace** `release.yml` — drop OIDC/npm publish; on tag/dispatch → `vp run build` →
  zip `dist/` (`manifest.json` + `code.js` + `ui.html`) → attach to a GitHub Release.
- **Remove** Bumpy (`bumpy-check.yml`, `.bumpy/`) — npm-versioning-specific, references
  the unrelated `valimock` package.
- **Publishing to Figma Community stays a documented manual step.**

---

## 10. Authoring skills (`.claude/skills/`, original content)

No plugin-authoring skill exists in the ecosystem (§4), so we create four:

- **`figma-plugin-architecture`** — two-thread model, manifest, typed postMessage, pitfalls.
- **`figma-plugin-api-reference`** — the `figma.*` surface (nodes, `createX`,
  `loadFontAsync`, `notify`, `clientStorage`, `showUI` options).
- **`figma-plugin-publishing`** — manifest prep, review guidelines, manual/figcd flow
  (with the archived-tool caveat).
- **`figma-plugin-ui-theming`** — `themeColors`, `--figma-color-*` vars, light/dark,
  accessible patterns.

> `.gitignore` currently ignores `.claude/`. A negation will be added so committed
> skills are tracked while local agent state stays ignored.

---

## 11. Decisions log (confirmed with the user)

| #   | Decision            | Choice                                                                         |
| --- | ------------------- | ------------------------------------------------------------------------------ |
| 1   | UI stack            | React + Vite, single-file inlined                                              |
| 2   | UI components       | Include `figma-kit` now; React-Aria fork later                                 |
| 3   | Build tool          | `vp build` two-pass (Vite for both threads); drop tsdown/`vp pack`/dts         |
| 4   | npm scaffolding     | Strip (`exports`, `publishConfig`, `files`, `sideEffects`, OIDC, Bumpy)        |
| 5   | CI/CD               | Build + validate + zip GitHub Release artifact; manual Community publish       |
| 6   | Skills              | Four original authoring skills                                                 |
| 7   | Build config files  | **One** mode-branched `vite.config.ts` (no `vite.main.ts`/`vite.ui.ts`)        |
| 8   | Build/dev override  | Via `run.tasks` (not `package.json` scripts)                                   |
| 9   | Config branching    | `defineConfig(({ mode }) => …)` + `--mode` — **empirically verified**          |
| 10  | Manifest generation | Separate cached `manifest` task running `scripts/manifest.mjs`                 |
| 11  | IPC architecture    | tRPC-like typed bridge + Signals + `using`, ported from `@discordkit/electron` |

---

## 12. Open items / assumptions to resolve during implementation

- **`manifest.id`** — ships as a placeholder; Figma assigns the real id on first publish.
- **`dev` task parallelization** — chaining `--watch` + dev server: confirm cleanest
  Vite+-native approach (`vp run --parallel` vs. a `concurrently`-style helper). The
  official sample uses `concurrently`.
- **`using` in main thread** — shim `Symbol.dispose`; confirm QuickJS behavior, keep the
  ergonomic `using` story primarily in the UI thread.
- **`figma-kit` at `0.0.0`** — pinned exactly; revisit if a stable release lands or if a
  plain-React + Figma-vars base is preferred.

---

## 13. Success criteria

- `vp install` succeeds with the new dependency set.
- `vp check` + `vp test` pass — the IPC `contract.spec.ts` is real logic, not a placeholder.
- `vp run build` emits `dist/code.js`, `dist/ui.html`, `dist/manifest.json`; the manifest
  has all required fields and resolving paths.
- The plugin imports into Figma desktop ("Import plugin from manifest") and the
  "Hello Figma!" button creates rectangles via the typed bridge.
- The four skills have valid frontmatter and load.
