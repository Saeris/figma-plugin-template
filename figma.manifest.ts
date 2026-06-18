/**
 * The single source of truth for `manifest.json`. Edit this file, not the
 * generated `dist/manifest.json` (which is overwritten on every build by
 * `scripts/manifest.mjs`). Keeping it as typed TS means a typo in a field name or
 * editor type is a compile error, not a silent runtime failure in Figma.
 *
 * Reference: https://developers.figma.com/docs/plugins/manifest/
 */

/** The subset of the Figma manifest schema this template uses. */
export interface FigmaManifest {
  name: string;
  /**
   * Assigned by Figma the first time you publish (or import a published plugin).
   * The placeholder below is fine for local development via "Import plugin from
   * manifest"; replace it with the real id before publishing.
   */
  id: string;
  api: string;
  /** Path to the bundled sandbox code, relative to the manifest (in `dist/`). */
  main: string;
  /** Path to the bundled, inlined UI HTML, relative to the manifest. */
  ui: string;
  editorType: Array<"figma" | "figjam" | "dev" | "slides" | "buzz">;
  /** Required for all newly created plugins. */
  documentAccess: "dynamic-page";
  networkAccess: {
    allowedDomains: string[];
    reasoning?: string;
    devAllowedDomains?: string[];
  };
}

export const manifest: FigmaManifest = {
  name: "Figma Plugin Template",
  // Replace with the id Figma assigns on first publish.
  id: "000000000000000000",
  api: "1.0.0",
  // These are emitted into `dist/` alongside the manifest by the build.
  main: "code.js",
  ui: "index.html",
  editorType: ["figma"],
  documentAccess: "dynamic-page",
  // This template makes no network requests. Declare domains here if yours does.
  networkAccess: { allowedDomains: ["none"] }
};
