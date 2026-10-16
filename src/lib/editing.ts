/**
 * Pure text-editing operations for the source editor.
 *
 * Every function takes the current text + selection and returns the new
 * text + selection (or null for "not applicable, let the browser handle the
 * key"). Keeping them pure makes them trivially testable; the Editor
 * component is responsible for applying the result to the <textarea> in a
 * way that keeps the browser's native undo stack working (see
 * `applyEdit` in components/Editor.tsx).
 */

export interface EditState {
  text: string;
  selStart: number;
  selEnd: number;
}

/** One indentation level. Two spaces is the common LaTeX convention. */
export const INDENT = "  ";

const LIST_ENVIRONMENTS = new Set(["itemize", "enumerate", "description"]);

export function lineStartAt(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

export function lineEndAt(text: string, pos: number): number {
  const i = text.indexOf("\n", pos);
  return i === -1 ? text.length : i;
}

/** 1-based line and column of an offset. */
export function lineColAt(text: string, pos: number): { line: number; col: number } {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) if (text[i] === "\n") line++;
  return { line, col: pos - lineStartAt(text, pos) + 1 };
}

/**
 * The `[start, end)` span of whole lines touched by the selection. A
 * selection ending at column 0 doesn't include that last line (this matches
 * how every code editor treats "select lines by dragging down").
 */
function selectedLines(s: EditState): [number, number] {
  const start = lineStartAt(s.text, s.selStart);
  let endPos = s.selEnd;
  if (s.selEnd > s.selStart && s.text[s.selEnd - 1] === "\n") endPos = s.selEnd - 1;
  return [start, lineEndAt(s.text, endPos)];
}

/** Applies `fn` to each line in the selected block and adjusts the selection. */
function mapSelectedLines(s: EditState, fn: (line: string, index: number) => string): EditState {
  const [start, end] = selectedLines(s);
  const lines = s.text.slice(start, end).split("\n");
  const mapped = lines.map(fn);
  const block = mapped.join("\n");
  const text = s.text.slice(0, start) + block + s.text.slice(end);

  // Shift the selection by the change on the first line (for selStart) and
  // the total change (for selEnd), clamped so it never escapes the block.
  const firstDelta = mapped[0]!.length - lines[0]!.length;
  const totalDelta = block.length - (end - start);
  const selStart = Math.max(start, s.selStart + firstDelta);
  const selEnd = s.selEnd === s.selStart ? selStart : Math.max(selStart, s.selEnd + totalDelta);
  return { text, selStart, selEnd };
}

/** Tab: insert an indent, or indent every selected line. */
export function indent(s: EditState): EditState {
  if (s.selStart === s.selEnd || !s.text.slice(s.selStart, s.selEnd).includes("\n")) {
    const text = s.text.slice(0, s.selStart) + INDENT + s.text.slice(s.selEnd);
    const pos = s.selStart + INDENT.length;
    return { text, selStart: pos, selEnd: pos };
  }
  return mapSelectedLines(s, (line) => (line.trim() === "" ? line : INDENT + line));
}

/** Shift+Tab: remove one indent level from every selected line. */
export function outdent(s: EditState): EditState {
  return mapSelectedLines(s, (line) => {
    if (line.startsWith("\t")) return line.slice(1);
    let n = 0;
    while (n < INDENT.length && line[n] === " ") n++;
    return line.slice(n);
  });
}

/** Ctrl+/ : toggle `% ` line comments on the selected lines. */
export function toggleComment(s: EditState): EditState {
  const [start, end] = selectedLines(s);
  const lines = s.text.slice(start, end).split("\n");
  const nonBlank = lines.filter((l) => l.trim() !== "");
  const allCommented = nonBlank.length > 0 && nonBlank.every((l) => /^\s*%/.test(l));
  if (allCommented) {
    return mapSelectedLines(s, (line) => line.replace(/^(\s*)% ?/, "$1"));
  }
  const minIndent = Math.min(...nonBlank.map((l) => l.length - l.trimStart().length), Infinity);
  const col = Number.isFinite(minIndent) ? minIndent : 0;
  return mapSelectedLines(s, (line) =>
    line.trim() === "" && nonBlank.length > 0 ? line : `${line.slice(0, col)}% ${line.slice(col)}`,
  );
}

/**
 * Wraps the selection in `before`/`after`, e.g. `\textbf{` + `}`. With no
 * selection, inserts both and puts the cursor between them.
 */
export function wrapSelection(s: EditState, before: string, after: string): EditState {
  const selected = s.text.slice(s.selStart, s.selEnd);
  const text = s.text.slice(0, s.selStart) + before + selected + after + s.text.slice(s.selEnd);
  const selStart = s.selStart + before.length;
  return { text, selStart, selEnd: selStart + selected.length };
}

/**
 * Inserts a snippet at the selection. `‸` (U+2038) marks where the cursor
 * should end up; if the snippet has no marker the cursor goes to the end. If
 * there is a selection and the snippet has a marker, the selected text is
 * placed at the marker (so "\frac{‸}{}" around "a" gives "\frac{a}{}").
 */
export const CURSOR_MARK = "‸";

export function insertSnippet(s: EditState, snippet: string): EditState {
  const selected = s.text.slice(s.selStart, s.selEnd);
  const markAt = snippet.indexOf(CURSOR_MARK);
  let body: string;
  let cursor: number;
  if (markAt === -1) {
    body = snippet;
    cursor = body.length;
  } else {
    body = snippet.slice(0, markAt) + selected + snippet.slice(markAt + 1);
    cursor = markAt + selected.length;
  }
  // Re-indent multi-line snippets to the current line's indentation.
  const lineStart = lineStartAt(s.text, s.selStart);
  const indentStr = /^[ \t]*/.exec(s.text.slice(lineStart, s.selStart))![0];
  if (indentStr && body.includes("\n")) {
    const before = body.slice(0, cursor).replace(/\n/g, `\n${indentStr}`);
    const after = body.slice(cursor).replace(/\n/g, `\n${indentStr}`);
    body = before + after;
    cursor = before.length;
  }
  const text = s.text.slice(0, s.selStart) + body + s.text.slice(s.selEnd);
  const pos = s.selStart + cursor;
  return { text, selStart: pos, selEnd: pos };
}

const OPENERS: Record<string, string> = { "{": "}", "[": "]", "(": ")", $: "$" };
const CLOSERS = new Set(["}", "]", ")", "$"]);

/**
 * Handles typing a bracket-like character with auto-closing:
 *  • with a selection, wraps it: `{` around "x" ⇒ `{x}`
 *  • typing a closer that's already next to the cursor just steps over it
 *  • typing an opener before whitespace/end/closer inserts the pair
 *  • `\(` and `\[` get `\)` / `\]`
 * Returns null when the browser's default behaviour is fine.
 */
export function autoClose(s: EditState, ch: string): EditState | null {
  const { text, selStart, selEnd } = s;
  const prev = text[selStart - 1];
  const next = text[selEnd];
  const escaped = prev === "\\" && text[selStart - 2] !== "\\";

  if (selStart !== selEnd && ch in OPENERS) {
    if (escaped && (ch === "(" || ch === "[")) return wrapSelection(s, ch, `\\${OPENERS[ch]}`);
    return wrapSelection(s, ch, OPENERS[ch]!);
  }
  if (selStart !== selEnd) return null;

  // Step over an auto-inserted closer.
  if (CLOSERS.has(ch) && next === ch && !escaped) {
    return { text, selStart: selStart + 1, selEnd: selStart + 1 };
  }
  if (!(ch in OPENERS)) return null;
  // Only auto-close when the next char doesn't "belong" to the opener.
  if (next !== undefined && !/[\s)\]}$.,;:]/.test(next)) return null;

  if (ch === "$") {
    // \$ is a literal dollar sign; `$` right after a letter/digit is most
    // likely closing an inline formula the user typed by hand.
    if (escaped || (prev !== undefined && /[A-Za-z0-9]/.test(prev))) return null;
    return insertSnippet(s, `$${CURSOR_MARK}$`);
  }
  if (escaped) {
    // \( … \)  \[ … \]  \{ … \}
    return insertSnippet(s, `${ch}${CURSOR_MARK}\\${OPENERS[ch]}`);
  }
  return insertSnippet(s, `${ch}${CURSOR_MARK}${OPENERS[ch]}`);
}

/** Backspace between an empty pair (`{|}`, `\(|\)`, `$|$`) deletes both halves. */
export function backspacePair(s: EditState): EditState | null {
  const { text, selStart, selEnd } = s;
  if (selStart !== selEnd || selStart === 0) return null;
  const before = text.slice(0, selStart);
  const after = text.slice(selStart);
  for (const [open, close] of [
    ["\\(", "\\)"],
    ["\\[", "\\]"],
    ["\\{", "\\}"],
  ] as const) {
    if (before.endsWith(open) && after.startsWith(close)) {
      const pos = selStart - open.length;
      return { text: text.slice(0, pos) + text.slice(selStart + close.length), selStart: pos, selEnd: pos };
    }
  }
  const prev = text[selStart - 1]!;
  if (OPENERS[prev] !== undefined && text[selStart] === OPENERS[prev] && text[selStart - 2] !== "\\") {
    return { text: text.slice(0, selStart - 1) + text.slice(selStart + 1), selStart: selStart - 1, selEnd: selStart - 1 };
  }
  return null;
}

function countEnv(text: string, kind: "begin" | "end", env: string): number {
  const escaped = env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(`\\\\${kind}\\s*\\{${escaped}\\}`, "g")) ?? []).length;
}

/**
 * Enter key with LaTeX smarts:
 *  • keeps the current line's indentation
 *  • after `\begin{env}` with no matching `\end`, inserts the `\end{env}`
 *    (and an `\item` for list environments)
 *  • on a non-empty `\item` line, starts a new `\item`; on an empty one,
 *    removes it (like Markdown lists)
 *  • between `{` and `}`, opens an indented block
 */
export function smartNewline(s: EditState): EditState {
  const { text, selStart, selEnd } = s;
  const lineStart = lineStartAt(text, selStart);
  const beforeCursor = text.slice(lineStart, selStart);
  const indentStr = /^[ \t]*/.exec(beforeCursor)![0];
  const replace = (insert: string, cursorOffset = insert.length): EditState => ({
    text: text.slice(0, selStart) + insert + text.slice(selEnd),
    selStart: selStart + cursorOffset,
    selEnd: selStart + cursorOffset,
  });

  const begin = /\\begin\s*\{([^}]+)\}(\[[^\]]*\])?\s*$/.exec(beforeCursor);
  if (begin && selStart === selEnd) {
    const env = begin[1]!;
    const unbalanced = countEnv(text, "begin", env) > countEnv(text, "end", env);
    const inner = indentStr + INDENT + (LIST_ENVIRONMENTS.has(env) ? "\\item " : "");
    if (unbalanced) {
      const insert = `\n${inner}\n${indentStr}\\end{${env}}`;
      return replace(insert, 1 + inner.length);
    }
    return replace(`\n${inner}`);
  }

  const item = /^([ \t]*)\\item\b(\s*)(.*)$/.exec(beforeCursor);
  if (item && selStart === selEnd && text.slice(selStart, lineEndAt(text, selStart)).trim() === "") {
    if (item[3]!.trim() === "") {
      // Empty item: remove it and leave a plain indented line.
      const newText = text.slice(0, lineStart) + text.slice(selStart);
      return { text: newText, selStart: lineStart, selEnd: lineStart };
    }
    return replace(`\n${item[1]}\\item `);
  }

  if (text[selStart - 1] === "{" && text[selEnd] === "}" && selStart === selEnd) {
    const inner = indentStr + INDENT;
    return replace(`\n${inner}\n${indentStr}`, 1 + inner.length);
  }

  return replace(`\n${indentStr}`);
}

/**
 * Finds the bracket pair touching the cursor: the bracket just before the
 * cursor is preferred, then the one just after. Escaped brackets (`\{`) are
 * ignored. Returns the two offsets or null.
 */
export function matchBracket(text: string, cursor: number): [number, number] | null {
  const pairs: Record<string, [string, number]> = { "{": ["}", 1], "[": ["]", 1], "}": ["{", -1], "]": ["[", -1] };
  for (const pos of [cursor - 1, cursor]) {
    const ch = text[pos];
    if (ch === undefined || !(ch in pairs) || text[pos - 1] === "\\") continue;
    const [other, dir] = pairs[ch]!;
    let depth = 0;
    for (let i = pos; i >= 0 && i < text.length; i += dir) {
      if (text[i - 1] === "\\") continue;
      if (text[i] === ch) depth++;
      else if (text[i] === other && --depth === 0) return pos < i ? [pos, i] : [i, pos];
    }
    return null;
  }
  return null;
}

/** Alt+↑ / Alt+↓ : move the selected lines up or down. */
export function moveLines(s: EditState, direction: -1 | 1): EditState | null {
  const [start, end] = selectedLines(s);
  const block = s.text.slice(start, end);
  if (direction === -1) {
    if (start === 0) return null;
    const prevStart = lineStartAt(s.text, start - 1);
    const prevLine = s.text.slice(prevStart, start - 1);
    const text = s.text.slice(0, prevStart) + block + "\n" + prevLine + s.text.slice(end);
    const shift = -(prevLine.length + 1);
    return { text, selStart: s.selStart + shift, selEnd: s.selEnd + shift };
  }
  if (end >= s.text.length) return null;
  const nextEnd = lineEndAt(s.text, end + 1);
  const nextLine = s.text.slice(end + 1, nextEnd);
  const text = s.text.slice(0, start) + nextLine + "\n" + block + s.text.slice(nextEnd);
  const shift = nextLine.length + 1;
  return { text, selStart: s.selStart + shift, selEnd: s.selEnd + shift };
}

/** Shift+Alt+↓ : duplicate the selected lines below. */
export function duplicateLines(s: EditState): EditState {
  const [start, end] = selectedLines(s);
  const block = s.text.slice(start, end);
  const text = s.text.slice(0, end) + "\n" + block + s.text.slice(end);
  const shift = block.length + 1;
  return { text, selStart: s.selStart + shift, selEnd: s.selEnd + shift };
}
