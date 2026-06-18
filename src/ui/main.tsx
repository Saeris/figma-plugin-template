/**
 * UI thread entry — runs in the plugin iframe (full DOM, no `figma` global).
 * Mounts the React app into the root element from `index.html`. Vite bundles this
 * and `index.html` into a single inlined `dist/index.html` (via
 * `vite-plugin-singlefile`), which the manifest points `ui` at.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
