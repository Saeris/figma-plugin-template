---
name: figma-plugin-ui-theming
description: How to style the plugin UI (src/ui) so it matches Figma's editor and follows the user's light/dark/FigJam theme, using the official --figma-color-* CSS variables. Use when building or styling UI components, fixing UI that looks wrong in dark mode, or deciding on a component library.
---

# Figma Plugin UI Theming

The plugin UI is a real iframe (`src/ui`), so you style it with normal CSS — but to
look native and respect the user's theme, use **Figma's official CSS variables**
instead of hard-coded colors. Docs:
https://developers.figma.com/docs/plugins/css-variables/

## Enable theme variables

The sandbox must opt in when opening the UI (already done in `src/main/code.ts`):

```ts
figma.showUI(__html__, { themeColors: true });
```

With `themeColors: true`, Figma injects a `<style>` block of `--figma-color-*`
variables into the iframe and adds a class to `<html>`:

- `figma-light` or `figma-dark` (Figma Design), and FigJam-specific variants.
- The variables **update live** when the user switches theme — no JS needed.

## Use the variables (never hard-code colors)

```css
.panel {
  background: var(--figma-color-bg);
  color: var(--figma-color-text);
  border: 1px solid var(--figma-color-border);
}
.primary-button {
  background: var(--figma-color-bg-brand);
  color: var(--figma-color-text-onbrand);
}
.primary-button:hover {
  background: var(--figma-color-bg-brand-hover);
}
```

### The variables you'll reach for most

| Purpose                    | Variable                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Default surface / text     | `--figma-color-bg`, `--figma-color-text`                                               |
| Secondary/tertiary text    | `--figma-color-text-secondary`, `--figma-color-text-tertiary`                          |
| Borders                    | `--figma-color-border`, `--figma-color-border-strong`, `--figma-color-border-selected` |
| Primary action             | `--figma-color-bg-brand`, `--figma-color-bg-brand-hover`, `--figma-color-text-onbrand` |
| Danger / success / warning | `--figma-color-bg-danger`, `--figma-color-bg-success`, `--figma-color-bg-warning`      |
| Icons                      | `--figma-color-icon`, `--figma-color-icon-secondary`                                   |

There are 150+ tokens organized by **type** (bg/text/icon/border) × **role**
(brand/danger/warning/success/component) × **prominence/state** (secondary, hover,
pressed, disabled, selected). Compose the name from those parts.

## Components in this template

This template **vendors a tiny set of components** in `src/ui/components/` (`Button`,
`Input`) styled with the variables above — because the React Figma component libraries
are either empty stubs (`figma-kit`) or abandoned (`figma-ui-kit`, `react-figma-ui`).
Extend this local set rather than adding a dead dependency.

If you want a richer, maintained set today, the only healthy option is
`@create-figma-plugin/ui` — but it is **Preact**, so adopting it means aliasing
`react`→`preact/compat` in `vite.config.ts`. Weigh that against keeping the React-native
vendored set.

## Tips

- Match Figma's metrics: 11px base font, 24–32px control heights, 6px radii, tight
  spacing — that's what makes a plugin feel native, as much as the colors do.
- Test both themes: toggle Figma's appearance (or temporarily add `class="figma-dark"`
  to `<html>` when developing the UI standalone in a browser).
- Don't ship your own light/dark logic — let the injected variables do it.

## Related skills

- `figma-plugin-architecture` — the UI thread and how it talks to the sandbox.
- `figma-plugin-publishing` — Community listing art vs. in-plugin UI.
