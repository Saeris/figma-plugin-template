/**
 * Writes `dist/manifest.json` from the typed `figma.manifest.ts` source. Run as
 * the `manifest` task in `vite.config.ts` after the two build passes, so the
 * emitted manifest always matches the artifacts (`code.js`, `index.html`) sitting
 * next to it in `dist/`.
 *
 * Imports the `.ts` source directly — Node (>=22.18 / 24+) strips types natively,
 * so no build step is needed for this script. Edit `figma.manifest.ts`, never the
 * generated JSON.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { manifest } = await import(
  new URL("../figma.manifest.ts", import.meta.url).href
);

const distDir = resolve(root, "dist");
await mkdir(distDir, { recursive: true });

const target = resolve(distDir, "manifest.json");
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`✓ wrote ${target}`);
