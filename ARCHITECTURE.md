# Architecture

Katex Playground is a static, frontend-only React app. There is no server: parsing, rendering, storage and export all happen in the browser. This document explains how the pieces fit together and why they are built the way they are.

## Contents

1. [Overview](#overview)
2. [Directory layout](#directory-layout)
3. [Data flow](#data-flow)
4. [The lexer](#the-lexer-srcliblexerts)
5. [The editor](#the-editor-srccomponentseditortsx)
6. [The document renderer](#the-document-renderer-srclibrenderts)
7. [Lazy-math suggestions](#lazy-math-suggestions-srclibsuggestts)
8. [Persistence](#persistence-srclibstoragets)
9. [Theming](#theming)
10. [Export](#export-srclibexportingts)
11. [Testing](#testing)
12. [Dependencies and supply-chain posture](#dependencies-and-supply-chain-posture)
13. [Known limitations](#known-limitations)

## Overview

```
                ┌────────────────────────────── App.tsx (state) ──────────────────────────────┐
                │                                                                              │
 keystrokes ──▶ │  Editor ──onChange──▶ workspace (documents, activeId) ──debounce──▶ localStorage
                │    ▲                         │                                               │
                │    │ insert/wrap/replace     │ useDeferredValue                              │
                │    │                         ▼                                               │
                │  Toolbar / Palette     renderDocument() ──▶ { html, diagnostics } ──▶ Preview │
                │  SuggestionBar ◀── suggestAt(text, cursor) ◀── cursor position              │
                └──────────────────────────────────────────────────────────────────────────────┘
```

The code is split into two layers:

- **`src/lib/`** holds pure TypeScript with no React or DOM dependencies, apart from the small `exporting.ts` and `theme.ts` helpers. All the logic lives here: lexing, rendering, suggestions, edit operations and storage. Everything in it is unit-tested.
- **`src/components/`** plus **`App.tsx`** hold the React UI. They are thin wrappers that hold state, wire events and call into `lib/`.

## Directory layout

```
index.html                 HTML shell; loads src/main.tsx
vite.config.ts             Vite + Vitest config (Oxc JSX transform, no plugins)
public/favicon.svg
src/
  main.tsx                 Entry: applies theme early, mounts <App/>
  App.tsx                  Application shell and all top-level state
  styles.css               All styles; theme tokens as CSS variables; print stylesheet
  components/
    Editor.tsx             Source editor (textarea-over-highlight overlay)
    Toolbar.tsx            Action buttons + quick-symbol bar (+ shared SymbolButton)
    Palette.tsx            Searchable full symbol palette
    SuggestionBar.tsx      Lazy-math suggestion strip
    PreferencesDialog.tsx  Preferences in a native <dialog>
    Menu.tsx               Small accessible dropdown menu
  lib/
    lexer.ts               Forgiving LaTeX tokenizer + math-region detection
    highlight.ts           Tokens → per-line highlighted HTML
    render.ts              LaTeX-subset → HTML document renderer (uses KaTeX for math)
    suggest.ts             Rule-based "lazy math" suggestion engine
    editing.ts             Pure editor operations (indent, auto-close, smart Enter, …)
    completions.ts         Command-completion vocabulary and ranking
    symbols.ts             Palette, quick symbols and toolbar actions (data)
    storage.ts             localStorage persistence for documents and preferences
    theme.ts               Light/dark resolution
    exporting.ts           .tex download, print-to-PDF, file-name sanitising
    welcome.ts             The first-run sample document
    *.test.ts              Vitest suites
```

## Data flow

`App.tsx` owns all state:

| State | Meaning |
| --- | --- |
| `workspace` | `{ documents, activeId }`, the persisted documents |
| `prefs` | user preferences (persisted separately) |
| `cursor` | selection start/end reported by the editor |
| `suggestion`, `dismissed` | current lazy-math suggestion; suggestions the user dismissed |
| UI flags | palette, preferences, issues popover, mobile Source/Preview view |

On each keystroke:

1. The `<textarea>` fires `onChange`. `App` stores the new text in the active document (`updateDocumentContent`, which is immutable).
2. A debounced effect (300 ms) writes the workspace to `localStorage`. Pending saves are flushed on `pagehide` and `visibilitychange`, so closing the tab right after typing doesn't lose anything.
3. The preview renders from `useDeferredValue(content)`. React treats this as low-priority work, so typing stays responsive even on long documents. `renderDocument` is memoised on the text.
4. Once the cursor has rested for 450 ms, `suggestAt` looks for a lazy-math suggestion.

Programmatic edits (toolbar, palette, completions, accepting a suggestion) don't change `App` state directly. They call the editor's imperative handle (`EditorHandle.insert/wrap/replaceRange`), which edits the textarea in a way that stays on the browser's undo stack. The resulting `input` event then flows through step 1 like any other keystroke.

## The lexer (`src/lib/lexer.ts`)

`lex(src)` produces a flat list of tokens (`command`, `comment`, `math-delim`, `brace`, `env-name`, `text`, …), each with offsets and a `math` flag. It also produces a list of **math ranges**: regions delimited by `$…$`, `$$…$$`, `\(…\)`, `\[…\]` or a math environment (`equation`, `align*`, …).

It is intentionally not a TeX implementation. It never throws, and it handles half-typed input gracefully: an unterminated `$` simply extends math to the end of the input, with the range marked `unterminated`. Three consumers share it:

- **highlighting**: token types become CSS classes;
- **the editor**: palette symbols that need math mode are wrapped in `\( \)` when the cursor is in text mode;
- **suggestions**: never rewrite text that is already math, and offer symbol fixes inside it.

## The editor (`src/components/Editor.tsx`)

The user asked for syntax highlighting and coding conveniences with no editor package, so the editor is built from scratch on a well-known technique:

```
┌ .editor-scroll (overflow: auto) ───────────────────┐
│ ┌ .editor-inner (position: relative) ────────────┐ │
│ │ <pre class="editor-highlight">  ← coloured, aria-hidden, pointer-events: none
│ │   <div class="ln">…</div>       one div per logical line
│ │ <textarea class="editor-input"> ← transparent text, visible caret, absolutely
│ │                                   positioned to cover exactly the <pre>
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

- **The textarea is the source of truth for input.** Selection, IME composition, spell-check, accessibility, clipboard and native undo/redo all come for free. Its text is `color: transparent`, and only its caret and selection highlight are visible.
- **The `<pre>` is purely visual.** It renders the same text with highlighting spans. Both layers share every layout-affecting CSS property (font, size, line-height, padding, `white-space: pre-wrap`, `overflow-wrap`), so characters line up exactly, including on soft-wrapped lines.
- **Neither layer scrolls itself.** The textarea is sized to the `<pre>`'s height and the wrapper scrolls, so the layers can never drift apart. This is the most common failure of overlay editors.
- **One `<div>` per logical line** gives us line numbers via CSS counters (`::before`, positioned in the left padding), which stay aligned with wrapped lines automatically. It also lets us tint the active line.
- **Caret geometry** (for scrolling the caret into view and placing the completion popup) is measured on the `<pre>`. We find the line's `<div>`, walk its text nodes to the caret column, and call `Range.getClientRects()`. This is exact and avoids the usual hidden "mirror div".

### Undoable programmatic edits

`applyEdit(next)` diffs the current and desired text down to the changed middle section, selects that range and calls `document.execCommand("insertText", …)`. `execCommand` is deprecated, but it is still the only way to modify a textarea while keeping the browser's undo history intact, and every current browser supports it for this. If it fails, the code falls back to assigning `.value` and dispatching an `input` event; undo history is lost in that case, but the edit is not.

### Editing features

All the logic lives in pure functions in `lib/editing.ts` (`(text, selection) → (text, selection) | null`). The component only maps keys to them:

| Key | Function |
| --- | --- |
| Tab / Shift+Tab | `indent` / `outdent` (multi-line aware) |
| Enter | `smartNewline`: keeps indentation; after `\begin{env}` inserts the `\end{env}` (plus `\item` for lists) if it's missing; continues `\item` lines; an empty `\item` ends the list; `{|}` opens an indented block |
| `{ [ ( $` and closers | `autoClose`: pairs, step-over, selection wrapping, `\(`→`\)` |
| Backspace | `backspacePair` deletes an empty pair |
| Mod+/ | `toggleComment` |
| Alt+↑/↓, Shift+Alt+↓ | `moveLines`, `duplicateLines` |
| Mod+B/I/M | `wrapSelection` with `\textbf{}`, `\textit{}`, `\( \)` |

Bracket matching (`matchBracket`) feeds a set of offsets to the highlighter, which outlines the pair. Key handling is skipped while an IME composition is active.

### Completions

After `\` plus at least one letter, `completionContext` finds the partial command. `filterCompletions` ranks the vocabulary in `completions.ts`: exact match first, then case-sensitive prefix, case-insensitive prefix and substring, with shorter names first within each group. Accepting inserts a snippet in which `‸` (U+2038) marks the cursor position, e.g. `\frac{‸}{}`. Environment completions expand to full `\begin…\end` blocks.

## The document renderer (`src/lib/render.ts`)

KaTeX only typesets math, so a "LaTeX-like document" needs its own document layer. `renderDocument(src)` is a small recursive-descent interpreter over a practical subset of LaTeX. It returns `{ html, diagnostics, title }`.

### Structure

- **Preamble**: if the source contains `\begin{document}`, everything before it is run for its side effects only: `\title`, `\author`, `\date`, `\newcommand`, `\renewcommand`, `\DeclareMathOperator` and `\def` are recorded, while `\documentclass` and `\usepackage` are ignored. Only the body is shown. Without `\begin{document}`, the whole input is the body, which suits quick notes.
- **Flow parsing**: `flow(start, end, inline)` scans a range of the original source and emits paragraphs (blank-line separated) and blocks. In `inline` mode, used for command arguments such as `\textbf{…}`, it emits no `<p>` wrappers. A small `Sink` interface (`text`, `block`, `space`, `par`) keeps paragraph assembly in one place.
- **Offsets, not substrings**: every function works on `[start, end)` ranges of the original string, so every diagnostic carries an exact source offset. The status bar uses this to jump the editor to the problem.
- **Two-pass references**: `\ref`/`\eqref` emit placeholders that are resolved after the whole document is rendered, so forward references work.

### What is supported

| Area | Support |
| --- | --- |
| Math | `$…$`, `\(…\)`, `$$…$$`, `\[…\]`; `equation`, `align`, `gather`, `multline`, `flalign`, `alignat`, `eqnarray` (+ starred); `math`, `displaymath` |
| Numbering | equations (per row in `align`, honouring `\nonumber`/`\notag`/`\tag`), sections (1, 1.1, 1.1.1), theorem-like environments (one shared counter), footnotes |
| References | `\label`, `\ref`, `\eqref`, `\pageref` (shows the number); undefined references warn and render `??` |
| Structure | `\section`/`\subsection`/`\subsubsection` (+ starred), `\paragraph`, `\maketitle`, `abstract`, `itemize`/`enumerate`/`description` (nested, `\item[label]`), `quote`, `quotation`, `center`, `flushleft`/`flushright`, `verbatim`, `lstlisting`, `figure`/`table` with `\caption`, `minipage`, basic `tabular` (alignment, `\hline`) |
| Theorems | `theorem`, `lemma`, `proposition`, `corollary`, `conjecture`, `claim`, `definition`, `example`, `exercise`, `remark`, `note` (+ starred, optional `[title]`), `proof` with ∎ |
| Text | `\textbf`, `\textit`, `\emph`, `\underline`, `\texttt`, `\textsc`, …, accents (`\'e`, `\"{o}`, …), `--`/`---`, ``` ``…'' ``` quotes, `~`, `\\`, escapes, `\LaTeX`, `\today`, `\ldots`, `\footnote`, `\href`, `\url` |
| Pages | `\newpage`/`\clearpage`/`\pagebreak` become page breaks in PDF export and a dashed rule on screen |
| Macros | `\newcommand{\x}[n]{…}`, `\renewcommand`, `\def`, `\DeclareMathOperator`; these become KaTeX macros, and argument-less ones also work in text mode |

### Math

Math content is passed to `katex.renderToString` with `throwOnError: true`, so errors can be turned into diagnostics with source offsets (KaTeX reports a position within the formula). `trust` is `false`, which stops math from creating links or arbitrary HTML. `\label` is stripped from math (KaTeX doesn't support it) and recorded against the current equation number. Numbered environments are rewritten to their starred form with an explicit `\tag{n}`, so numbering is continuous across the document and `\ref` can resolve it.

### Performance

KaTeX output is memoised in a module-level `Map`, keyed by display mode, macro set and TeX source, and capped at 4,000 entries. Re-rendering on every keystroke is cheap because typically only the formula being edited misses the cache.

### Safety

The preview is injected with `innerHTML`, so the renderer has to be safe against hostile source text (for example, a `.tex` file someone sends you):

- all user text goes through `escapeHtml`;
- the only raw HTML comes from fixed templates in `render.ts` or from KaTeX with `trust: false`;
- `\href`/`\url` only produce links for `http:`, `https:`, `mailto:` and `#…` URLs, and links get `rel="noopener noreferrer"`.

### Diagnostics

Errors (bad math, unclosed delimiters, unbalanced braces or environments) and warnings (unknown commands or environments, `^`/`_` outside math, undefined references, math commands used in text) are collected, never thrown. They are rendered inline in the preview (red math, highlighted unknown commands) and listed in the status bar.

## Lazy-math suggestions (`src/lib/suggest.ts`)

This is a deterministic, rule-based engine (no AI) that turns "lazy" plain-text maths into LaTeX:

```
"For all a in Z, a is even"
   │ tokenize   words · numbers · ASCII operators (longest match: <=> before <=)
   ▼
[For][all][a][in][Z][,][a][is][even]
   │ classify   phrases ("for all", "is less than or equal to", …), operators,
   │            Greek names, function names, number-set letters after ∈/→/:,
   │            single letters as variables (with an article heuristic for a/A/I),
   │            everything else as English
   ▼
[\forall][a][\in][\mathbb{Z}][,][a][text:is][text:even]
   │ trim       leading English stays outside ("Suppose x > 0" ⇒ Suppose \(x > 0\));
   │            trailing English stays outside unless the statement is quantified
   │ gate       needs ≥1 strong signal (relation, quantifier, arrow, ∈, ^, √) and ≥1
   │            operand, and no more English words than math items
   │ emit       English runs ⇒ \text{ … } with spacing; original spacing kept;
   │            sqrt(…) ⇒ \sqrt{…}, x^(…) ⇒ x^{…}, x^10 ⇒ x^{10}
   ▼
\forall a \in \mathbb{Z}, a \text{ is even}
```

`suggestAt(src, cursor)` picks the candidate text:

- **Cursor in text mode**: the "clause" around the cursor, meaning the current line split at math regions, `%` comments and sentence-ending punctuation (`.` `?` `!` `;` followed by a space, but not `...` or `3.5`). If the cursor is just past a full stop, the clause before it is used. Clauses containing `\`, `{`, `}` or `$` are left alone, since they're already LaTeX.
- **Cursor inside closed math**: `asciiMathToLatex` replaces ASCII shorthands (`<=`, `=>`, `->`, `!=`, `+-`, …) and bare Greek or function names (`alpha`, `sin`) with commands. It leaves the arguments of `\text{}`, `\mathrm{}`, `\label{}` etc. untouched.

The UI shows the suggestion after the cursor has rested for 450 ms, with a KaTeX preview of the result. Alt+Enter applies it (as an undoable edit, re-validated against the current text first). Esc dismisses it, and a dismissed suggestion isn't offered again for the same text.

## Persistence (`src/lib/storage.ts`)

Two `localStorage` keys:

| Key | Contents |
| --- | --- |
| `katex-playground:workspace` | `{ version: 1, documents: [{ id, name, content, createdAt, updatedAt }], activeId }` |
| `katex-playground:preferences` | theme, font size, line numbers, auto-close, completions, suggestions, quick symbols, split ratio |

- **Defensive loading**: `parseWorkspace` and `parsePreferences` validate everything. Malformed documents are dropped, a dangling `activeId` is repaired, numbers are clamped, and corrupt JSON falls back to defaults. Storage that is missing or throws (private modes, sandboxed iframes) yields an in-memory session instead of a crash.
- **Saving**: debounced, flushed on `pagehide` and `visibilitychange`, and on Mod+S. Quota errors are reported in the status bar.
- **Multiple tabs**: a `storage` event listener adopts documents saved by another tab, keeping this tab's open document. A flag prevents echoing the change back, which would otherwise ping-pong between tabs. The last writer wins; there is no merging of concurrent edits to the same document.
- All storage functions take a `StorageLike`, so tests use an in-memory implementation.

## Theming

- `prefs.theme` is `system`, `light` or `dark`. `resolveTheme` combines it with `matchMedia("(prefers-color-scheme: dark)")`. App listens for changes to that media query, so "system" follows the OS live.
- The resolved theme is written to `<html data-theme="…">`, together with `color-scheme`, so native scrollbars and form controls match. `main.tsx` applies it before React's first render to avoid a flash of the wrong theme.
- Every colour in `styles.css` is a CSS variable defined per theme, including the syntax-highlighting palette. A `prefers-color-scheme` media query provides a fallback before JavaScript runs.

## Export (`src/lib/exporting.ts`)

- **`.tex`**: a `Blob` download of the source, named after the document (`sanitizeFilename` removes characters that are illegal on common file systems).
- **PDF**: `window.print()`. The `@media print` block in `styles.css` hides everything except the rendered paper, removes on-screen chrome, forces black-on-white, honours `\newpage` via `break-after: page`, and avoids breaking inside theorems, display math and tables. The page title is temporarily set to the document name so browsers suggest it as the PDF file name. This gives a vector PDF with selectable text and embedded KaTeX fonts, without a PDF library (which would have meant a large dependency and usually rasterised output).
- **Open file**: reads a local `.tex` file with `File.text()` into a new document.

## Testing

`npm test` runs Vitest in a Node environment; no DOM emulation is needed because everything worth unit-testing lives in pure modules:

| Suite | Covers |
| --- | --- |
| `lexer.test.ts` | token types, full coverage of input, comments/escapes, math ranges for all delimiters and environments, unterminated math |
| `highlight.test.ts` | line splitting, escaping, math/match classes |
| `render.test.ts` | paragraphs, escaping/XSS, ligatures, styling, accents, link-scheme filtering, all math delimiters, KaTeX error offsets, macros, equation/align numbering and refs, sections, lists, theorems, proofs, footnotes, verbatim, tabular, diagnostics, garbage input never throws |
| `suggest.test.ts` | both examples from the spec, many operator/phrase conversions, trimming rules, article heuristic, prose that must *not* trigger, math-mode fixes, clause selection around the cursor |
| `editing.test.ts` | every editing operation, written as readable `"before|" → "after|"` cursor strings |
| `storage.test.ts` | defaults, round-trips, corrupt data, quota errors, workspace operations, preference validation |
| `misc.test.ts` | completion context and ranking, theme resolution, file names, and a check that every palette item is valid KaTeX |

The React components were verified manually in a browser: overlay alignment on wrapped lines, undo after programmatic edits, completions, suggestions, palette insertion, themes and the mobile layout.

## Dependencies and supply-chain posture

Runtime dependencies are only `react`, `react-dom` and `katex`. Dev dependencies are `typescript`, `vite`, `vitest`, `@types/react` and `@types/react-dom`.

- The editor, highlighter, completions and suggestion engine are hand-written, so no editor framework (CodeMirror/Monaco) is pulled in.
- `@vitejs/plugin-react` is deliberately not used. Vite 8's built-in Oxc transform compiles TSX with React's automatic runtime (`oxc.jsx.runtime` in `vite.config.ts`). The only cost is the lack of React Fast Refresh: edits trigger a full page reload in dev, which is harmless because documents are persisted.
- `@types/react` / `@types/react-dom` (and their dependency `csstype`) were the only additions. They are type-only, never shipped to the browser, and were checked on socket.dev before installing; all scored 100 for supply-chain security with no alerts.
- `.npmrc` enforces `save-exact=true` (pinned versions) and `ignore-scripts=true` (no install scripts).

## Known limitations

- This is a LaTeX-*like* environment, not TeX. There are no packages, no custom environments (`\newenvironment`), no bibliography (`\cite` renders `[key]`), no images (`\includegraphics` shows a placeholder, since there is no file system), and `tabular` support is basic.
- TeX's space-swallowing after control words is emulated (`\LaTeX is` → "LaTeXis"; write `\LaTeX{}` or `\LaTeX\ `), as in real LaTeX.
- PDF output depends on the browser's print engine; page size and margins come from the print dialog (2 cm margins by default).
- `localStorage` is limited to roughly 5 MB per site, which is plenty for text but not unlimited. Export important work.
