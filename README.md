<div align="center">

# 🖼 Figma Plugin Template

[![CI status][ci_badge]][ci]

An opinionated template for building **Figma plugins** with React, a **type-safe IPC
bridge**, and the [Vite+][viteplus] toolchain — get from "Use this template" to a
running _hello figma!_ in minutes.

</div>

---

## ✨ What's in the box

- **Two-thread plugin** done right — sandbox (`src/main`) + React UI (`src/ui`), each
  with its own tsconfig, bundled to the single `code.js` + inlined `index.html` Figma
  requires.
- **A tRPC-like typed IPC bridge** (`src/ipc`) instead of stringly-typed `postMessage`.
  Define your API once in `contract.ts`; types flow across the thread boundary. Backed
  by [TC39 Signals][signals] for reactive state and `using` for scope-based cleanup.
- **Single mode-branched [Vite+] build** with per-pass caching — editing the UI doesn't
  rebuild the sandbox.
- **Theme-matched UI** via Figma's official `--figma-color-*` variables (light/dark
  automatic).
- **CI/CD** that checks, tests, builds, and attaches a ready-to-import `plugin.zip` to a
  GitHub Release.
- **Agent skills** (`.claude/skills/`) teaching plugin authoring — architecture, the
  `figma.*` API, theming, and publishing.

## 🚀 Quick start

```bash
vp install            # install dependencies
vp run build          # → dist/{code.js, index.html, manifest.json}
```

Then, in the **Figma desktop app**: **Plugins → Development → Import plugin from
manifest…** and pick `dist/manifest.json`. Run the plugin — the _hello figma!_ UI
creates rectangles and shows your live selection count.

> First time using this template? Click **“Use this template”** on GitHub to create
> your own repo, then clone it.

## 🧭 Architecture in 30 seconds

A plugin is **two isolated contexts** that share no runtime — only a message channel:

|           | **Main / sandbox** (`src/main`) | **UI** (`src/ui`)                      |
| --------- | ------------------------------- | -------------------------------------- |
| Globals   | `figma`, `__html__`             | `window`, DOM, React                   |
| Can       | read/write the document         | render, use browser APIs               |
| Can't     | touch the DOM                   | touch `figma`                          |
| Builds to | `dist/code.js`                  | `dist/index.html` (everything inlined) |

They communicate through the **typed bridge** in `src/ipc`. You grow the plugin by
editing one file — `src/ipc/contract.ts`:

```ts
// 1. declare the API (contract.ts)
export interface Procedures {
  createRectangles: (input: { count: number }) => { created: number };
}
export interface Events {
  selectionChanged: { count: number };
}
```

```ts
// 2. handle it in the sandbox (src/main/code.ts)
bridge.handle("createRectangles", ({ count }) => {
  /* ...create nodes... */ return { created: count };
});
bridge.emit("selectionChanged", { count: figma.currentPage.selection.length });
```

```tsx
// 3. use it in the UI (src/ui/App.tsx) — fully typed, no postMessage
const { created } = await bridge.call("createRectangles", { count: 5 });
using off = bridge.on("selectionChanged", ({ count }) => setCount(count));
```

For the full picture (signals, `asyncSignal`, disposables, pitfalls) see
[`SPEC.md`](./SPEC.md) and the `figma-plugin-architecture` skill.

## 🔧 Dev loop

```bash
vp run dev     # rebuilds the sandbox on change + serves the UI
```

Then enable **Plugins → Development → Hot reload plugin** in Figma.

> **There is no true HMR for Figma plugins.** Figma re-runs the plugin when the build
> changes (that's what “Hot reload” does); the sandbox does a full restart, not HMR. The
> **UI alone** can get real Vite HMR in a browser tab when you mock the bridge — handy
> for fast UI iteration outside Figma.

## 🛠 Project layout

```
src/
  main/        sandbox entry (figma global, no DOM)  → dist/code.js
  ui/          React UI + vendored components        → dist/index.html
    components/ Figma-CSS-var styled Button, Input
  ipc/         the typed bridge (contract, transport, bridge, signals, react)
  __tests__/   contract.spec.ts — the bridge's behavior is the tested logic
figma.manifest.ts   single manifest source → scripts/manifest.mjs → dist/manifest.json
vite.config.ts      one mode-branched config + run.tasks
```

## ✅ Scripts

```bash
vp run build    # the two-pass build + manifest (production artifacts)
vp run dev      # watch the sandbox + serve the UI
vp check        # format + lint + typecheck
vp check --fix  # …with autofixes
vp test         # run Vitest
```

> `vp run build` (not bare `vp build`) is the orchestrated build — in Vite+, bare
> `vp build` runs a single raw Vite pass. Build/dev are defined as `run.tasks` in
> `vite.config.ts`, which is the only place Vite+ lets you override them.

## 🎨 Theming & UI components

Style with Figma's `--figma-color-*` variables (enabled via `showUI({ themeColors:
true })`) so the UI tracks the user's light/dark theme automatically — see the
`figma-plugin-ui-theming` skill.

This template **vendors** a tiny `Button`/`Input` set in `src/ui/components/` rather
than depending on a package: the React Figma component libraries are either empty stubs
(`figma-kit`) or abandoned (`figma-ui-kit`, `react-figma-ui`). The only maintained
option is [`@create-figma-plugin/ui`][cfp], but it is Preact (would require a
`react`→`preact/compat` alias). Extend the local set, or swap one in deliberately.

## 📦 Publishing

Figma has **no official publish API**, so publishing is a manual step in the desktop
app (the CI Release workflow just builds and attaches `plugin.zip`):

1. `vp run build`, then **Plugins → Development → Import plugin from manifest…**.
2. **Manage plugins → your plugin → Publish**, fill in the Community listing, submit for
   review.
3. After your first publish, copy the **id Figma assigns** back into `figma.manifest.ts`.

Details and review tips: the `figma-plugin-publishing` skill.

## 🤖 Agent skills

`.claude/skills/` ships four original skills (no existing skill teaches plugin
_authoring_):

- **figma-plugin-architecture** — the two-thread model and the typed bridge.
- **figma-plugin-api-reference** — the `figma.*` surface for sandbox handlers.
- **figma-plugin-ui-theming** — theme-matched UI with `--figma-color-*`.
- **figma-plugin-publishing** — manifest prep and Community publishing.

## 🤝 Contributing

Uses [Vite+][viteplus] (Oxlint + Oxfmt + Vitest, Rolldown builds).

```bash
vp install        # install dependencies
vp check --fix    # format + lint + typecheck
vp test           # run Vitest
```

## 🥂 License

Released under the [MIT license][license] © [Drake Costa][personal-website].

[ci_badge]: https://github.com/Saeris/figma-plugin-template/actions/workflows/ci.yml/badge.svg
[ci]: https://github.com/Saeris/figma-plugin-template/actions/workflows/ci.yml
[viteplus]: https://viteplus.dev/
[signals]: https://github.com/tc39/proposal-signals
[cfp]: https://yuanqing.github.io/create-figma-plugin/
[license]: ./LICENSE.md
[personal-website]: https://saeris.gg
