# Katex Playground

Write LaTeX-style documents entirely in your browser, typeset live with [KaTeX](https://katex.org).

- **Live preview**: the LaTeX source sits on the left and the typeset document on the right, updating as you type.
- **Nothing to install, no server**: everything runs in the browser. Documents are saved automatically to `localStorage`, so your work is still there when you come back.
- **Export**: download a **PDF** (via the browser's print dialog → "Save as PDF") or the raw **`.tex`** source. You can also open existing `.tex` files.
- **Editing help**: syntax highlighting, line numbers, auto-closing brackets, smart Enter (closes `\begin{…}` and continues `\item` lists), command completion after `\`, comment toggling, and moving or duplicating lines.
- **Symbols at hand**: a toolbar of common actions and symbols (quantifiers, `\implies`, `\in`, ℝ, …), plus a searchable palette of about 130 symbols and structures.
- **Lazy-math suggestions**: type `For all a in Z, a is even` or `x > y => x - y > 0` and pause, and the app offers `\(\forall a \in \mathbb{Z}, a \text{ is even}\)`. This is a small rule-based engine; no AI is involved.
- **Light and dark themes**: follows your OS setting by default, and can be overridden in Preferences (⚙).

Supported LaTeX includes sections, lists, theorem/proof environments, numbered `equation`/`align` with `\label`/`\ref`, footnotes, links, basic `tabular`, and `\newcommand` macros. Everything inside math mode is handled by KaTeX. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full list and for how the app works.

## Requirements

- Node.js 22.12 or newer (required by Vite 8 and Vitest 5)
- npm

## Getting started

```bash
npm ci
```

`.npmrc` sets `ignore-scripts=true` (no install scripts run) and `save-exact=true` (dependencies are pinned).

### Run the development server

```bash
npm run dev
```

Then open the printed URL (default http://localhost:5173).

### Run the tests

```bash
npm test
```

Use `npm run test:watch` for watch mode. `npm run typecheck` runs the TypeScript compiler without emitting.

### Build for production

```bash
npm run build
```

This type-checks, then writes a static site to `dist/`. Because the app has no backend, `dist/` can be hosted anywhere that serves static files (GitHub Pages, Netlify, an S3 bucket, `python3 -m http.server`, …). Asset paths are relative, so it also works from a sub-directory.

To preview the production build locally:

```bash
npm run preview
```

## Keyboard shortcuts

| Shortcut (Ctrl on Windows/Linux, ⌘ on macOS) | Action |
| --- | --- |
| Mod+B / Mod+I | Bold / italic |
| Mod+M / Mod+Shift+M | Inline `\( \)` / display `\[ \]` math |
| Mod+/ | Toggle `%` comment |
| Tab / Shift+Tab | Indent / outdent |
| Alt+↑ / Alt+↓ | Move line up / down |
| Shift+Alt+↓ | Duplicate line |
| Alt+Enter / Esc | Accept / dismiss a lazy-math suggestion |
| Mod+P | Export PDF |
| Mod+S | Save now (it also autosaves) |

## Privacy

Your documents never leave your browser. Clearing this site's data in the browser deletes them, so export anything important.
