import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { lint, fmt, mergeLint } from "@saeris/configs";

/**
 * `@saeris/configs` enables both `promise-function-async` (force `async` on any
 * promise-returning function) and `require-await` (forbid `async` with no inner
 * `await`). For thin pass-through wrappers like the IPC transport's `request` —
 * which legitimately just return a promise — these two rules are mutually
 * unsatisfiable (and `no-return-await` strips any `await` added to appease them).
 * Relax `require-await` here; the wrappers are correct. TODO: reconcile upstream.
 */
const lintConfig = mergeLint(lint, { rules: { "require-await": "off" } });

/**
 * One config, two build passes, selected by `--mode`. A Figma plugin ships two
 * artifacts with incompatible build settings:
 *
 *   - `--mode main` → `dist/code.js`: the sandbox bundle. Single IIFE file, no
 *     DOM, ES2020-compatible. Built in library mode so there's no HTML wrapper.
 *   - `--mode ui`   → `dist/index.html`: the UI. `viteSingleFile` inlines all
 *     JS/CSS into one HTML (Figma loads exactly one file), so it globally mutates
 *     the build — which is why it can't share a pass with the sandbox bundle.
 *
 * The two passes are orchestrated by the `build` task below (`vp run build`), NOT
 * by a `package.json` script — in Vite+, bare `vp build` always runs the built-in
 * Vite build, so build orchestration must live in `run.tasks`.
 */
export default defineConfig(({ mode }) => {
  const base = {
    lint: lintConfig,
    fmt,
    // Tests cover the environment-agnostic IPC core; node env, no DOM/figma.
    test: {
      name: "figma-plugin-template",
      globals: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      environment: "node",
      passWithNoTests: true
    },
    // Orchestration: `vp run build` / `vp run dev`. See file header.
    run: {
      tasks: {
        // Defined so `build` can `dependsOn` it (dependsOn references tasks, not
        // bare commands). Lints before producing release artifacts.
        lint: { command: "vp lint", input: ["src/**", "vite.config.ts"] },
        "build:main": {
          command: "vp build --mode main",
          input: ["src/main/**", "src/ipc/**", "vite.config.ts"],
          output: ["dist/code.js"]
        },
        "build:ui": {
          command: "vp build --mode ui",
          input: ["src/ui/**", "src/ipc/**", "vite.config.ts"],
          output: ["dist/index.html"]
        },
        manifest: {
          command: "node ./scripts/manifest.mjs",
          input: ["figma.manifest.ts", "scripts/manifest.mjs"],
          output: ["dist/manifest.json"]
        },
        // The orchestrated production build: both passes + manifest, in order.
        build: {
          command: ["vp run build:main", "vp run build:ui", "vp run manifest"],
          dependsOn: ["lint"]
        },
        // Dev loop: rebuild the sandbox on change + serve the UI with HMR.
        // No true HMR for the sandbox (Figma re-runs the plugin on rebuild via its
        // hot-reload toggle); the UI gets real Vite HMR in a browser tab.
        dev: {
          command: ["vp build --mode main --watch", "vp dev --mode ui"],
          cache: false
        }
      }
    }
  };

  if (mode === "main") {
    return {
      ...base,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        target: "es2020",
        // Library mode → a single plain JS file with no HTML wrapper.
        lib: {
          entry: "src/main/code.ts",
          formats: ["iife"],
          name: "figmaPluginMain",
          fileName: (): string => "code.js"
        },
        rollupOptions: {
          // The sandbox has no module system at runtime; bundle everything.
          output: { inlineDynamicImports: true }
        }
      }
    };
  }

  if (mode === "ui") {
    return {
      ...base,
      root: "src/ui",
      plugins: [react(), viteSingleFile()],
      build: {
        outDir: "../../dist",
        emptyOutDir: false,
        target: "esnext",
        cssCodeSplit: false,
        // Inline everything: Figma's `ui` is a single HTML file.
        assetsInlineLimit: 100_000_000,
        chunkSizeWarningLimit: 100_000_000,
        rollupOptions: { output: { inlineDynamicImports: true } }
      }
    };
  }

  // Any other mode (notably `vp test`, which runs with mode "test"): no UI `root`
  // or build branch — just the shared base so Vitest discovers `src/__tests__`.
  return base;
});
