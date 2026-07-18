# Project Rules

## Figma Design System Rules

These rules define how to translate Figma inputs into code for this project and must be followed for every Figma-driven change.

### Project Profile

- This project is a static vanilla web app, not a framework app.
- Client languages are `html,css,javascript`.
- Framework is `unknown` / none. Do not introduce React, Vue, Svelte, Tailwind, build tools, package managers, or bundlers unless the user explicitly asks.
- Runtime files live at the project root:
  - Markup and DOM templates: `index.html`
  - Styling and design tokens: `styles.css`
  - State, rendering, and event logic: `app.js`

### Required Figma MCP Flow

1. Run `get_design_context` first for the exact Figma node(s).
2. If the response is too large or truncated, run `get_metadata` to inspect the node map, then re-fetch only the required node(s) with `get_design_context`.
3. Run `get_screenshot` for the same node or variant before implementation.
4. Only after both design context and screenshot are available, download or reference any required Figma assets.
5. Treat the Figma MCP output as design intent, not final code style. Convert React/Tailwind examples into this project's static HTML, CSS, and vanilla JavaScript conventions.
6. Validate the implemented UI against the Figma screenshot for visual parity, responsive behavior, and interaction states before marking complete.

### Component and Markup Rules

- Reuse existing semantic sections, forms, buttons, and the `#productTemplate` pattern in `index.html` before adding new structures.
- Place repeated item markup in a `<template>` when it is rendered from JavaScript.
- Use semantic HTML first: `header`, `nav`, `main`, `section`, `article`, `form`, `button`, `label`, `input`, and `textarea`.
- Preserve Korean user-facing copy unless the design explicitly changes it.
- Keep accessibility attributes aligned with current patterns: `aria-label`, `aria-labelledby`, `title` for icon-only buttons, proper `label for` and input `id` pairs, and meaningful image `alt` text.
- Do not use placeholder UI when the Figma payload includes real text, imagery, or a localhost asset URL.

### Styling Rules

- Use plain CSS in `styles.css`; do not add Tailwind, CSS-in-JS, Sass, CSS Modules, or inline style attributes.
- Design tokens are CSS custom properties in `:root` in `styles.css`.
- IMPORTANT: Reuse existing CSS variables before adding raw values: `--bg`, `--surface`, `--paper`, `--ink`, `--muted`, `--line`, `--brand`, `--brand-dark`, `--green`, `--blue`, `--heart`, and `--shadow`.
- IMPORTANT: Add new color, shadow, or recurring spacing tokens to `:root` when they are part of the design system; avoid scattering repeated hardcoded values through selectors.
- Keep the mobile-first app shell pattern: `width: min(100%, 430px)`, `min-width: 320px`, centered shell on larger viewports, and responsive changes inside media queries.
- Preserve the existing compact 8px-radius control and card language unless a Figma design clearly establishes a different system.
- Use stable dimensions for fixed-format UI such as tab buttons, icon buttons, product cards, image tiles, and form controls so dynamic text and hover/focus states do not shift layout.
- Keep `letter-spacing: 0` unless a Figma text style explicitly requires otherwise.
- Ensure text wraps safely with existing `overflow-wrap: anywhere` behavior where needed, especially for Korean and user-generated product content.

### JavaScript Rules

- Use vanilla JavaScript in `app.js`; do not add dependencies.
- Keep app state centralized in the `state` object loaded by `loadState()` and persisted through `saveState()`.
- Use `localStorage` under the existing `STORAGE_KEY` pattern for client-side persistence.
- Render UI through explicit render functions such as `renderSession()`, `renderNotice()`, `renderProducts()`, and `render()`.
- Escape user-generated HTML with `escapeHtml()` before assigning to `innerHTML`; prefer `textContent` for dynamic text when possible.
- Attach event listeners in `app.js`, not inline in HTML.
- Keep feature-specific helpers small and named by behavior, following existing camelCase function naming.

### Asset Handling

- The Figma MCP server can provide image and SVG assets through localhost URLs.
- IMPORTANT: If Figma MCP returns a localhost source for an image or SVG, use that source directly or download it into the project only when persistence is required.
- IMPORTANT: Do not install or import icon packages. Use assets from Figma or the existing simple text/icon-button pattern.
- If persistent assets are needed, create a root-level `assets/` directory and reference assets with relative paths from `index.html` or `styles.css`.
- Do not create generic placeholder images when the Figma payload provides a real asset.

### Quality Checks

- After Figma-driven UI changes, run the app as a static page or with `python3 -m http.server` and inspect the affected viewport widths.
- Verify the main mobile width around 320px to 430px and a wider desktop viewport.
- Check that controls remain keyboard accessible, focus states are visible, product/user-generated text does not overflow, and all form labels remain associated with their inputs.
- Because there is no test framework in this project, document manual verification steps in the final response when code changes are made.
