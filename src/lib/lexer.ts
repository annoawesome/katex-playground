/**
 * A small, forgiving LaTeX tokenizer.
 *
 * This is *not* a TeX parser — it doesn't expand macros or understand
 * catcodes. It splits source text into coarse tokens that are good enough for
 * two jobs:
 *
 *  1. Syntax highlighting in the editor (see `highlight.ts`).
 *  2. Knowing which parts of the document are in math mode, so the editor can
 *     decide whether a palette symbol needs `\( … \)` around it and the
 *     suggestion engine can avoid rewriting text that is already math.
 *
 * The lexer never throws: unterminated math, stray braces, and so on are
 * simply tokenized as best as possible, because the source is usually
 * half-typed while the user is editing.
 */

export type TokenType =
  | "text"
  | "comment"
  | "command" // \foo
  | "escape" // \%, \{, \\ …
  | "math-delim" // $, $$, \(, \), \[, \]
  | "brace" // { }
  | "bracket" // [ ]
  | "env-name" // the `itemize` in \begin{itemize}
  | "special" // & ^ _ ~ #
  | "number"; // digits, only distinguished inside math

export interface Token {
  type: TokenType;
  /** Inclusive start offset into the source. */
  start: number;
  /** Exclusive end offset into the source. */
  end: number;
  /** Whether this token is inside (or delimits) a math region. */
  math: boolean;
}

/** A half-open `[start, end)` range of the source that is in math mode. */
export interface MathRange {
  start: number;
  end: number;
  /** Offsets of the math *content*, i.e. excluding the delimiters. */
  contentStart: number;
  contentEnd: number;
  /** True when no closing delimiter was found before the end of input. */
  unterminated: boolean;
}

export interface LexResult {
  tokens: Token[];
  mathRanges: MathRange[];
}

/** Environments whose whole body is typeset in math mode. */
export const MATH_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
  "math",
]);

const SPECIAL_CHARS = new Set(["&", "^", "_", "~", "#"]);
// Characters that end a run of plain text.
const TEXT_STOPPERS = new Set(["\\", "%", "$", "{", "}", "[", "]", "&", "^", "_", "~", "#"]);

const isLetter = (ch: string | undefined): boolean =>
  ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

/** How the current math region was opened, so we know what closes it. */
type MathOpener = { kind: "$" | "$$" | "\\(" | "\\[" } | { kind: "env"; name: string };

export function lex(src: string): LexResult {
  const tokens: Token[] = [];
  const mathRanges: MathRange[] = [];

  // (Cast so TypeScript doesn't narrow this to `null`: closures below mutate it.)
  let opener = null as MathOpener | null;
  let mathStart = 0;
  let contentStart = 0;

  const push = (type: TokenType, start: number, end: number, math = opener !== null) => {
    tokens.push({ type, start, end, math });
  };
  const openMath = (o: MathOpener, start: number, end: number) => {
    opener = o;
    mathStart = start;
    contentStart = end;
  };
  const closeMath = (contentEnd: number, end: number) => {
    mathRanges.push({ start: mathStart, end, contentStart, contentEnd, unterminated: false });
    opener = null;
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i]!;

    // ── Comments: `%` up to (not including) the newline.
    if (ch === "%") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      push("comment", i, j);
      i = j;
      continue;
    }

    // ── Backslash: commands, escapes, and \( \) \[ \] delimiters.
    if (ch === "\\") {
      const next = src[i + 1];
      if (isLetter(next)) {
        let j = i + 1;
        while (isLetter(src[j])) j++;
        const name = src.slice(i + 1, j);
        push("command", i, j);
        i = j;
        if (name === "begin" || name === "end") {
          i = lexEnvironmentName(src, i, name);
        }
        continue;
      }
      if ((next === "(" || next === "[") && opener === null) {
        openMath({ kind: next === "(" ? "\\(" : "\\[" }, i, i + 2);
        push("math-delim", i, i + 2, true);
        i += 2;
        continue;
      }
      if (
        (next === ")" && opener?.kind === "\\(") ||
        (next === "]" && opener?.kind === "\\[")
      ) {
        push("math-delim", i, i + 2, true);
        closeMath(i, i + 2);
        i += 2;
        continue;
      }
      // Any other escaped char (or a lone trailing backslash).
      const end = next === undefined ? i + 1 : i + 2;
      push("escape", i, end);
      i = end;
      continue;
    }

    // ── Dollar signs toggle inline/display math.
    if (ch === "$") {
      const isDouble = src[i + 1] === "$";
      const len = isDouble ? 2 : 1;
      if (opener === null) {
        openMath({ kind: isDouble ? "$$" : "$" }, i, i + len);
        push("math-delim", i, i + len, true);
      } else if (opener.kind === (isDouble ? "$$" : "$")) {
        push("math-delim", i, i + len, true);
        closeMath(i, i + len);
      } else {
        // e.g. a `$` inside \( … \): not a delimiter, just odd input.
        push("special", i, i + len);
      }
      i += len;
      continue;
    }

    if (ch === "{" || ch === "}") {
      push("brace", i, i + 1);
      i++;
      continue;
    }
    if (ch === "[" || ch === "]") {
      push("bracket", i, i + 1);
      i++;
      continue;
    }
    if (SPECIAL_CHARS.has(ch)) {
      push("special", i, i + 1);
      i++;
      continue;
    }

    // ── Numbers get their own colour inside math only.
    if (opener !== null && isDigit(ch)) {
      let j = i;
      while (isDigit(src[j]) || (src[j] === "." && isDigit(src[j + 1]))) j++;
      push("number", i, j);
      i = j;
      continue;
    }

    // ── Plain text run.
    let j = i + 1;
    while (j < n && !TEXT_STOPPERS.has(src[j]!) && !(opener !== null && isDigit(src[j]))) j++;
    push("text", i, j);
    i = j;
  }

  if (opener !== null) {
    mathRanges.push({ start: mathStart, end: n, contentStart, contentEnd: n, unterminated: true });
  }
  return { tokens, mathRanges };

  /**
   * After `\begin` / `\end`, tokenize `{name}` and update math state when the
   * environment is a math environment. Returns the new scan position.
   */
  function lexEnvironmentName(s: string, pos: number, which: "begin" | "end"): number {
    let p = pos;
    while (s[p] === " ") p++;
    if (s[p] !== "{") return pos;
    const close = s.indexOf("}", p);
    if (close === -1 || s.slice(p + 1, close).includes("\n")) return pos;
    const name = s.slice(p + 1, close).trim();

    if (which === "begin" && opener === null && MATH_ENVIRONMENTS.has(name)) {
      // The math region starts at the backslash of \begin, which is the
      // command token we just pushed.
      const beginToken = tokens[tokens.length - 1]!;
      beginToken.math = true;
      openMath({ kind: "env", name }, beginToken.start, close + 1);
    }
    const closesMath = which === "end" && opener?.kind === "env" && opener.name === name;

    push("brace", p, p + 1);
    push("env-name", p + 1, close);
    push("brace", close, close + 1);
    if (closesMath) {
      // contentEnd is the start of the `\end` command token.
      const endCmd = tokens[tokens.length - 4]!;
      closeMath(endCmd.start, close + 1);
    }
    return close + 1;
  }
}

/**
 * Returns the math range containing `pos`, if any. A position exactly at a
 * range boundary counts as inside only if it lies within the delimiters'
 * content (so a cursor right after a closing `$` is *outside* math).
 */
export function mathRangeAt(ranges: readonly MathRange[], pos: number): MathRange | null {
  for (const r of ranges) {
    if (pos >= r.contentStart && pos <= r.contentEnd) return r;
    if (r.start > pos) break;
  }
  return null;
}

/** Convenience wrapper: is the given offset inside math mode? */
export function isInMath(src: string, pos: number): boolean {
  return mathRangeAt(lex(src).mathRanges, pos) !== null;
}
