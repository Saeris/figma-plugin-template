---
name: figma-plugin-publishing
description: How to prepare the manifest, build the artifact, and publish this plugin to the Figma Community (or share privately). Use when getting ready to ship, filling out manifest fields, setting the plugin id, writing review-friendly metadata, or asking about CI auto-publish.
---

# Publishing a Figma Plugin

There is **no official Figma publish API**. Publishing to the Community is a manual
step in the Figma desktop app. CI builds and packages the artifact; you publish from
the app. This skill covers both.

## 1. Prepare the manifest (`figma.manifest.ts`)

Edit `figma.manifest.ts` (the typed source — never edit the generated
`dist/manifest.json`). Before publishing:

- **`id`** — the placeholder `"000000000000000000"` works for local development
  ("Import plugin from manifest"), but Figma assigns the **real id on first publish**.
  After your first publish, copy that id back into `figma.manifest.ts` so future builds
  match the published plugin.
- **`name`** — the Community display name.
- **`editorType`** — `["figma"]`, add `"figjam"`/`"slides"`/`"dev"` if supported.
- **`networkAccess.allowedDomains`** — list every domain you `fetch`. Use `["none"]`
  if you make no network calls (faster review, more trust). Add a `reasoning` string if
  you do request domains — reviewers read it.
- **`documentAccess: "dynamic-page"`** — leave as-is (required for new plugins).

## 2. Build & package

```bash
vp run build          # → dist/{code.js, index.html, manifest.json}
```

The three files in `dist/` are the entire plugin. CI's Release workflow zips them into
`plugin.zip` and attaches it to a GitHub Release on a `v*` tag (see
`.github/workflows/release.yml`).

## 3. Publish to the Community (manual)

In the **Figma desktop app**:

1. **Plugins → Development → Import plugin from manifest…** → pick `dist/manifest.json`
   (do this once; run the plugin to test locally).
2. **Plugins → Manage plugins → your plugin → Publish** (or right-click → Publish).
3. Fill in the Community listing: icon (128×128), cover art, description, tags, support
   contact. These are Community metadata, **not** manifest fields.
4. Submit for review. First-time and updated plugins go through Figma review.

### Review tips (reduce rejections)

- Keep `networkAccess` minimal and honest; `["none"]` reviews fastest.
- Don't request capabilities you don't use.
- Make sure the plugin does something useful on its first run and handles an empty
  selection / empty document gracefully.
- Test in a fresh file before submitting.

## 4. CI auto-publish (why it's not included)

The community tool that automated Community publishing (`parrot-figcd`) was **archived
in Jan 2026** and drives Figma's private web API, which breaks when Figma changes it.
This template deliberately does **not** auto-publish — it produces a verified
`plugin.zip` artifact and leaves publishing as the documented manual step above. If you
want auto-publish anyway, you'd add a job that runs figcd with a `FIGMA_WEB_AUTHN_TOKEN`
secret, accepting that it relies on an unofficial, unstable endpoint.

## Related skills

- `figma-plugin-architecture` — the manifest's role in the two-thread model.
- `figma-plugin-api-reference` — `clientStorage`/`networkAccess` implications.
