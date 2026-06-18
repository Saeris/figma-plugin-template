# Figma Plugin Template — Architecture Spec

> **Status:** Built. This document is the decision log for why the template is shaped
> the way it is — the research, the constraints, and the choices behind the code now in
> the repo (originally forked from
> [`Saeris/library-template`](https://github.com/Saeris/library-template)). The README
> is the human-facing intro; `CLAUDE.md` primes agents working in the repo; the
> `.claude/skills/figma-plugin-*` skills cover task-specific depth. This file explains
> the _why_ those don't.

---

## 1. Goal

A minimal **"hello figma!"** boilerplate that gets a developer from clone to a running
plugin in minutes, with strong DX on the [Vite+](https://viteplus.dev) (`vp`) toolchain
and first-class AI-assistant support. The headline differentiator over existing
templates is a **type-safe, tRPC-like IPC bridge** between the plugin's two threads,
replacing the untyped `postMessage` event-emitter pattern every other template ships.

Two supporting libraries may be extracted from this template **later** (out of scope
here — the ideas are proven minimally first):

1. A React Figma **UI component library** built on React Aria (the vendored
   `src/ui/components/` set is its seed).
2. A reusable **type-safe IPC helper** for main↔UI communication (the `src/ipc/` layer
   is its prototype).

---

## 2. Starting point: what the template was

The repo was a **library template** — its whole shape assumed "build an npm package →
publish to npm": `package.json` `exports`/`publishConfig`/`files`/`sideEffects`, a
tsdown `pack` build emitting `.mjs` + `.d.mts`, and Bumpy + OIDC npm publishing in CI.
`src/index.ts` and its spec were empty.

**A Figma plugin is architecturally the opposite of a library.** A library is
_consumed_ by other code via `exports`; a plugin is a **deployed application** shipped
as a `manifest.json` + bundled artifacts the Figma host loads. So the npm-publishing
scaffolding was **removed**, not extended: no `exports`/`publishConfig`/`files`,
no tsdown/`vp pack`, no Bumpy.

---

## 3. Figma plugin fundamentals (research)

Sources: [Figma plugin docs](https://developers.figma.com/docs/plugins/),
[manifest reference](https://developers.figma.com/docs/plugins/manifest/),
[CSS variables / theming](https://developers.figma.com/docs/plugins/css-variables/),
and the official [`figma/plugin-samples`](https://github.com/figma/plugin-samples) source.

### 3.1 Two-thread model

A plugin runs as **two isolated contexts** that share no runtime — only a `postMessage`
channel passing structured-clonable data:

| Thread                               | Globals             | Has                 | Lacks                                   | Builds to                            |
| ------------------------------------ | ------------------- | ------------------- | --------------------------------------- | ------------------------------------ |
| **Main / sandbox** (`manifest.main`) | `figma`, `__html__` | the Figma scene API | **no DOM, no `fetch`, no `setTimeout`** | one JS file (`dist/code.js`)         |
| **UI** (`manifest.ui`)               | `window`, DOM       | full browser APIs   | **no `figma`**                          | one inlined HTML (`dist/index.html`) |

- Main → UI: `figma.ui.postMessage(msg)`; UI receives via `window` `message` events
  (`event.data.pluginMessage`).
- UI → Main: `parent.postMessage({ pluginMessage: msg }, "*")`; main receives via
  `figma.ui.onmessage`.

The sandbox is **QuickJS compiled to Wasm**, supporting **ES2020+** (classes, private
fields, async/await, generators, modules) but **not guaranteed** to support ES2022+
Explicit Resource Management (`using` / `Symbol.dispose`) — see §6.3.

### 3.2 Manifest

Required: `name`, `id`, `api`, `main`, `editorType`. Newly created plugins also require
`documentAccess: "dynamic-page"` (which makes pages load lazily → use the async
`figma.*` API). Network access is declared via `networkAccess.allowedDomains`. UI
theming is enabled with `figma.showUI(__html__, { themeColors: true })`, which injects
the `--figma-color-*` CSS variables and a `figma-light`/`figma-dark` class.

`manifest.id` is **assigned by Figma on first publish**; the template ships a
placeholder (`"000000000000000000"`) with a note to replace it.

### 3.3 Reference implementation

The official **`plugin-samples/esbuild-react`** is the closest prior art and was read
in full. Findings that shaped this template:

- Despite the name, **it uses Vite** for the UI, via
  [`vite-plugin-singlefile`](https://www.npmjs.com/package/vite-plugin-singlefile).
- **Split source dirs**, each with **its own `tsconfig.json`** (incompatible `lib`:
  figma typings vs. `DOM` + `react-jsx`). This per-thread tsconfig split is universal.
- UI build inlines _everything_ (`assetsInlineLimit: 100000000`, `cssCodeSplit: false`,
  `inlineDynamicImports: true`) because Figma loads exactly one HTML file.
- **Messaging is untyped** (stringly-typed `msg.type` switch) — the weak point we
  improve on with the IPC bridge (§6).

---

## 4. Ecosystem survey & best practices

Surveyed: Figma's official samples,
[`create-figma-plugin`](https://yuanqing.github.io/create-figma-plugin/) (the de-facto
community framework), the React Figma UI libraries, and
[Tokens Studio](https://github.com/tokens-studio/figma-plugin) (largest production React
plugin).

| Practice                                                    | Consensus source                      |
| ----------------------------------------------------------- | ------------------------------------- |
| Separate `main`/`ui` source dirs, per-thread tsconfig       | Official samples, create-figma-plugin |
| UI bundled to a single inlined HTML (`viteSingleFile`)      | Official Vite sample, Bolt Figma      |
| `documentAccess: "dynamic-page"` + declared `networkAccess` | Required for new plugins              |
| `themeColors: true` + `--figma-color-*` vars for theming    | Official theming API                  |
| Watch-rebuild + Figma hot-reload (no true HMR)              | Forums, Bolt, Ditto template          |
| `manifest.json` generated from one config source            | create-figma-plugin                   |
| `@figma/plugin-typings` via `types`                         | All                                   |

**`create-figma-plugin`** — we borrowed the _ideas_ (config-as-single-source, typed
event ergonomics, Figma-native components) but **skipped the framework**: it is
Preact-first (swaps React→`preact/compat`) with its own `build-figma-plugin` CLI, which
conflicts with our Vite+ + React choice.

**Skills landscape** — every existing Figma skill (skills.sh, Figma's
`community-resources/agent_skills`) is about _using_ Figma via the MCP server (design
generation, design systems, Code Connect). **None teach plugin _authoring_.** This
template fills that gap with **original** skills (§10).

---

## 5. Build & tooling architecture (Vite+)

Verified against the bundled docs (`node_modules/vite-plus/docs`) and by **empirically
probing `vp`** (§5.4).

### 5.1 Key Vite+ facts

- `vp build` runs the **standard Vite production build** — config model identical to
  upstream Vite (Vite 8 + Rolldown): `build`, `plugins`, `rollupOptions`, `--mode`,
  `--watch` all behave as documented.
- `vp pack` is **tsdown / library-only** — dropped (a plugin is not a library).
- **You cannot override `build`/`dev` via `package.json` scripts.** Bare `vp build`
  always runs the built-in Vite build; orchestration must live in **`run.tasks`** in
  `vite.config.ts`, reached via `vp run build`. A task name cannot exist in both
  `package.json` and `vite.config.ts`.

### 5.2 One config, not two

The two Figma artifacts have **mutually incompatible build settings**:

- **UI** needs `viteSingleFile()`, which _globally_ mutates the build
  (`inlineDynamicImports`, `cssCodeSplit: false`, huge `assetsInlineLimit`) and expects
  an HTML input.
- **Sandbox** must be a single plain JS file (no HTML, no DOM), ES2020, IIFE (lib mode).

One `vp build` invocation applies one plugin/build config to all inputs, so the
collision (not input count) forces **two passes** — but both live in one
`vite.config.ts` that branches on `--mode`. The actual config also relaxes one lint rule
via `mergeLint` (§6.5):

```ts
const lintConfig = mergeLint(lint, { rules: { "require-await": "off" } });

export default defineConfig(({ mode }) => {
  const base = {
    lint: lintConfig,
    fmt,
    test: {
      /* node env, no DOM/figma */
    },
    run: {
      tasks: {
        /* §5.3 */
      }
    }
  };
  if (mode === "main")
    return {
      ...base,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        target: "es2020",
        lib: {
          entry: "src/main/code.ts",
          formats: ["iife"],
          name: "figmaPluginMain",
          fileName: () => "code.js"
        },
        rollupOptions: { output: { inlineDynamicImports: true } }
      }
    };
  if (mode === "ui")
    return {
      ...base,
      root: "src/ui",
      plugins: [react(), viteSingleFile()],
      build: {
        outDir: "../../dist",
        emptyOutDir: false,
        target: "esnext",
        cssCodeSplit: false,
        assetsInlineLimit: 100_000_000,
        chunkSizeWarningLimit: 100_000_000,
        rollupOptions: { output: { inlineDynamicImports: true } }
      }
    };
  // any other mode (notably `vp test`, which runs mode "test"): base only — no UI root,
  // or Vitest won't discover src/__tests__.
  return base;
});
```

### 5.3 Tasks orchestrate the two passes

```ts
run: {
  tasks: {
    lint:         { command: "vp lint", input: ["src/**", "vite.config.ts"] },
    "build:main": { command: "vp build --mode main", input: ["src/main/**","src/ipc/**","vite.config.ts"], output: ["dist/code.js"] },
    "build:ui":   { command: "vp build --mode ui",   input: ["src/ui/**","src/ipc/**","vite.config.ts"],   output: ["dist/index.html"] },
    manifest:     { command: "node ./scripts/manifest.mjs", input: ["figma.manifest.ts","scripts/manifest.mjs"], output: ["dist/manifest.json"] },
    build:        { command: ["vp run build:main", "vp run build:ui", "vp run manifest"], dependsOn: ["lint"] },
    dev:          { command: ["vp build --mode main --watch", "vp dev --mode ui"], cache: false },
  }
}
```

- Users run **`vp run build`** / **`vp run dev`** (not bare `vp build`).
- **Per-pass `input`/`output`** is a real DX win unique to the Vite+ task graph: editing
  UI code is a **cache hit on the sandbox build**, and vice-versa (confirmed: a second
  `vp run build` reports `4/4 cache hit`). Two separate config files couldn't provide this.
- `dependsOn` references **task names**, so a `lint` task exists for `build` to depend on
  (a bare command can't be a dependency target).
- `manifest` runs `scripts/manifest.mjs`, which imports the typed `figma.manifest.ts`
  (Node ≥22.18 strips types natively) and writes `dist/manifest.json`.

### 5.4 Empirical verification

`vp` was probed directly rather than assumed:

- **`defineConfig(({ mode, command }) => ({...}))` function form is supported** (probe
  printed `mode=ui command=build`).
- **`--mode` plumbs through** to the function config.
- **`vp test` runs with `mode === "test"`**, which is why the config's non-build branch
  must omit the UI `root` (else Vitest can't find `src/__tests__`).
- **`root: "src/ui"` + HTML entry builds correctly**; `viteSingleFile()` then inlines the
  emitted JS/CSS into one `index.html`.

---

## 6. IPC bridge — the headline feature

Both official samples and `create-figma-plugin` expose messaging as an **untyped or
cast-based event channel**. This template ships a **tRPC-like, type-safe bridge**,
modeled on **`@discordkit/electron`**
(`C:\GitHub\@saeris\discordkit`, PR [#60](https://github.com/discordkit/discordkit/pull/60)).

> **Why Electron's pattern ports here:** Electron and Figma plugins are the _same
> problem_ — a privileged process (Electron main / Figma sandbox) and a sandboxed UI
> (renderer / iframe) exchanging only structured-clonable messages. DiscordKit's
> insight — _don't expose the raw emitter; expose a typed `call`/`on` bridge and project
> state as Signals_ — transfers almost 1:1.

### 6.1 The layers (as built, `src/ipc/`)

- **`contract.ts`** — the single source of truth: `Procedures` (request→reply) and
  `Events` (push). Everything else is generic over it; growing the plugin's API means
  editing only this file.
- **`bridge.ts`** — the typed surface: `UiBridge` (`call`/`on`) and `MainBridge`
  (`handle`/`emit`), built over a channel-injected transport.
- **`transport.ts`** — the correlation-id request/reply protocol (§6.2) plus the runtime
  `Envelope` guard; transport-agnostic (tests inject a fake `Channel`).
- **`channel.main.ts` / `channel.ui.ts`** — the thread-specific `Channel` adapters
  (`figma.ui` vs. `window`) and the `createMainBridge` / `createUiBridge` entry points.
  Split by thread so the IPC core never references both global sets — the per-thread
  tsconfig then enforces "no DOM in main, no figma in UI" at compile time.
- **`signals.ts`** — `eventSignal` (push events → `Signal.State`), `asyncSignal`
  (pull-only `call` reads → `{ loading, data, error }` with a monotonic stale-run
  guard), and `subscribe` (framework-free watcher).
- **`react.ts`** — `useSignal` via `useSyncExternalStore`.
- **`disposable.ts`** — `Subscription` (an unsubscribe that's also `using`-compatible)
  and `installDisposeShim` (§6.3).

### 6.2 The one thing we invent: a correlation-id transport

Electron has `ipcRenderer.invoke` (built-in request/reply). `postMessage` is
fire-and-forget, so `call` adds a **correlation-id layer**: each request gets an id; the
reply echoes it; the pending promise resolves on match. This is the only piece beyond
DiscordKit's design.

### 6.3 `using` / Explicit Resource Management — where it's safe

- **UI thread** = a real browser iframe → `using` / `Symbol.dispose` fully supported.
- **Main thread** = QuickJS, ES2020, `Symbol.dispose` not guaranteed. `code.ts` calls
  `installDisposeShim()` at startup (seeds `Symbol.dispose`/`asyncDispose`) so `using`
  resolves there too; `toSubscription` also defines the dispose method explicitly. Plain
  `off()` always works regardless.

`signal-polyfill` (v0.2.2, the TC39 Signals impl DiscordKit uses) works in both threads.

### 6.4 Why this is the testable core

The IPC contract is the one piece with **real logic worth unit-testing** (CLAUDE.md Rule
9). `src/__tests__/contract.spec.ts` wires the two bridges through an in-memory fake
`Channel` pair and asserts the guarantees: a `call` resolves with the handler's typed
reply, a throwing handler rejects the caller, unknown procedures reject, events deliver
typed payloads, subscriptions stop on disposal, and — the subtle one — `asyncSignal`'s
**stale-run guard** discards a slow earlier reply when a newer `reload` supersedes it.
11 tests, all passing.

### 6.5 The type-erasure seam (and a lint conflict we hit)

`unknown` must become a contract type _somewhere_; that seam is irreducible. It is
contained to **two documented `oxlint-disable` casts** (one per thread side in
`bridge.ts`/dispatch). Every other warning was resolved by improving the code — a
runtime `Envelope` guard in the transport, `undefined` instead of `void` in conditional
types, a `never`-typed handler map, dropping a default export. Final bar: **0 errors, 0
warnings.**

We also hit a genuine **`@saeris/configs` rule conflict**: `promise-function-async`
forces thin promise-returning wrappers to be `async`, then `require-await` errors
because they have no inner `await`, and `no-return-await` strips any `await` added to
appease it. No source form satisfies all three, so `vite.config.ts` relaxes
`require-await` via `mergeLint`, with a `TODO` to reconcile upstream (the config is
shared across repos).

---

## 7. UI layer

- **React 19 + Vite**, bundled to a single inlined `index.html` via
  `vite-plugin-singlefile`.
- **No external Figma component library.** The intended pick, `figma-kit`, turned out to
  be an **empty name-squat stub** (`0.0.0`, 0-byte dist, "Coming soon"); every other
  React Figma UI lib (`figma-ui-kit`, `react-figma-ui`) is abandoned (2021–2023). The
  only maintained option, `@create-figma-plugin/ui`, is Preact. So the template
  **vendors a tiny set** (`Button`, `Input`) in `src/ui/components/`, styled with
  `--figma-color-*` variables — which doubles as the seed for the future React-Aria
  component library.
- Theming uses `themeColors: true` + the `--figma-color-*` variables for automatic
  light/dark/FigJam theming.

---

## 8. Project structure (as built)

```
src/
  main/
    code.ts              # sandbox entry: showUI, installDisposeShim, register handlers, emit events
    tsconfig.json        # ESNext lib, @figma/plugin-typings, no DOM
  ui/
    index.html
    main.tsx             # React 19 mount (createRoot)
    App.tsx              # "Hello Figma!" — typed call() + useSignal over an eventSignal
    App.css              # --figma-color-* vars
    components/          # vendored Figma-styled Button + Input (seed for the RA lib)
    tsconfig.json        # DOM + react-jsx
    vite-env.d.ts
  ipc/
    contract.ts          # the typed Procedures/Events contract (single source of truth)
    bridge.ts            # UiBridge (call/on) + MainBridge (handle/emit)
    transport.ts         # correlation-id request/reply + Envelope guard
    channel.main.ts      # figma.ui channel + createMainBridge
    channel.ui.ts        # window channel + createUiBridge
    signals.ts           # eventSignal / asyncSignal / subscribe (signal-polyfill)
    react.ts             # useSignal via useSyncExternalStore
    disposable.ts        # Subscription + installDisposeShim
  __tests__/
    contract.spec.ts     # 11 tests over a fake Channel pair (reply, errors, events, stale-run guard)
figma.manifest.ts        # single typed manifest source
scripts/
  manifest.mjs           # imports figma.manifest.ts → dist/manifest.json
vite.config.ts           # one mode-branched config + run.tasks
tsconfig.json            # root: IPC core + tests; src/main and src/ui have their own
```

---

## 9. CI/CD

Figma has **no official publish API**. The community tool
[`parrot-figcd`](https://github.com/opral/parrot-figcd) wrapped the private web API but
was **archived Jan 2026** and breaks when Figma changes the endpoint. So:

- **`ci.yml`** — `vp check` + `vp test` + `vp run build` on a Node matrix (the build
  step means a broken build fails CI, not release).
- **`release.yml`** — on a `v*` tag (or dispatch): build, then zip
  `dist/{manifest.json, code.js, index.html}` into `plugin.zip` and attach it to a
  GitHub Release. No npm/OIDC/Bumpy.
- **Publishing to Figma Community stays a documented manual step** (desktop app).

---

## 10. Authoring skills (`.claude/skills/`, original content)

No plugin-authoring skill exists in the ecosystem (§4), so the template ships four:

- **`figma-plugin-architecture`** — two-thread model, the typed bridge, the
  add-a-feature workflow, pitfalls.
- **`figma-plugin-api-reference`** — the `figma.*` surface (nodes, `createX`,
  `loadFontAsync`, `notify`, `clientStorage`, dynamic-page async API, `showUI` options).
- **`figma-plugin-publishing`** — manifest prep, review tips, the manual Community flow,
  and why CI doesn't auto-publish.
- **`figma-plugin-ui-theming`** — `themeColors`, the `--figma-color-*` variables,
  light/dark, the vendored-components rationale.

`.gitignore` ignores `.claude/*` but negates `.claude/skills/`, so committed skills are
tracked while local agent state stays ignored.

---

## 11. Decisions log

| #   | Decision            | Choice                                                                         |
| --- | ------------------- | ------------------------------------------------------------------------------ |
| 1   | UI stack            | React 19 + Vite, single-file inlined                                           |
| 2   | UI components       | **Vendor a tiny local set** (figma-kit is an empty stub; others abandoned)     |
| 3   | Build tool          | Two-pass Vite via `vp run build`; dropped tsdown/`vp pack`/dts                 |
| 4   | npm scaffolding     | Stripped (`exports`, `publishConfig`, `files`, `sideEffects`, OIDC, Bumpy)     |
| 5   | CI/CD               | Check + test + build + zip GitHub Release artifact; manual Community publish   |
| 6   | Skills              | Four original authoring skills                                                 |
| 7   | Build config files  | **One** mode-branched `vite.config.ts` (no `vite.main.ts`/`vite.ui.ts`)        |
| 8   | Build/dev override  | Via `run.tasks` (not `package.json` scripts)                                   |
| 9   | Config branching    | `defineConfig(({ mode }) => …)` + `--mode` — empirically verified              |
| 10  | Manifest generation | Separate cached `manifest` task running `scripts/manifest.mjs`                 |
| 11  | IPC architecture    | tRPC-like typed bridge + Signals + `using`, ported from `@discordkit/electron` |
| 12  | Lint conflict       | `require-await` relaxed via `mergeLint` (promise-function-async conflict)      |

---

## 12. Verified outcomes

- `vp install` succeeds; deps are at the latest **non-quarantined** versions
  (`@figma/plugin-typings` 1.128.0 and `@vitest/coverage-v8` 4.1.8 stepped down from
  quarantined latests; `vite: "catalog:"` added so `@vitejs/plugin-react` resolves Vite).
- `vp check` → **0 errors, 0 warnings**, all files formatted.
- `vp test` → **11/11 passing** (the IPC contract, including the stale-run guard).
- `vp run build` → emits `dist/{code.js, index.html, manifest.json}`; `code.js` is a
  proper IIFE, `index.html` is fully self-contained (no external `src`/`href`), the
  manifest has all required fields with resolving paths. Re-runs hit 100% task cache.
- The four skills have valid frontmatter and load.

Remaining manual step (by design): import `dist/manifest.json` into Figma desktop to run
the plugin, and publish from there.

---

## 13. Future work (not in this template)

- Extract the IPC bridge (`src/ipc/`) into a standalone, reusable type-safe IPC library.
- Build the React-Aria-based Figma UI component library (the vendored
  `src/ui/components/` is the seed).
- Reconcile the `@saeris/configs` `promise-function-async` / `require-await` conflict
  upstream so the `mergeLint` override (§6.5) can be removed.
