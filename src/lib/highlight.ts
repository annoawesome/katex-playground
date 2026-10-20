/**
 * Syntax highlighting for the source editor.
 *
 * The editor is a transparent <textarea> layered on top of a <pre> that shows
 * the coloured text (see `components/Editor.tsx`). This module produces the
 * HTML for that <pre>: one string per *logical* line, so the editor can wrap
 * each line in its own element (which is how line numbers and the active-line
 * highlight stay aligned with soft-wrapped lines).
 */
import type { Token, TokenType } from "./lexer";

/** CSS class used for each token type. Plain text gets no span. */
const CLASS_FOR: Record<TokenType, string | null> = {
  text: null,
  comment: "t-comment",
  command: "t-cmd",
  escape: "t-esc",
  "math-delim": "t-delim",
  brace: "t-brace",
  bracket: "t-bracket",
  "env-name": "t-env",
  special: "t-special",
  number: "t-num",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

export interface HighlightOptions {
  /**
   * Offsets of single-character brace/bracket tokens to emphasise, used for
   * matching-bracket highlighting around the cursor.
   */
  marks?: ReadonlySet<number>;
}

/**
 * Converts tokens into an array of HTML strings, one per source line.
 * The number of entries always equals `src.split("\n").length`.
 */
export function highlightLines(
  src: string,
  tokens: readonly Token[],
  options: HighlightOptions = {},
): string[] {
  const lines: string[] = [];
  let current = "";

  for (const tok of tokens) {
    let cls = CLASS_FOR[tok.type];
    if (tok.math) cls = cls ? `${cls} m` : "m";
    if (options.marks?.has(tok.start) && (tok.type === "brace" || tok.type === "bracket")) {
      cls = cls ? `${cls} t-match` : "t-match";
    }

    // Tokens (text runs, mostly) may contain newlines: split them so that
    // every line's markup is self-contained.
    const parts = src.slice(tok.start, tok.end).split("\n");
    parts.forEach((part, idx) => {
      if (idx > 0) {
        lines.push(current);
        current = "";
      }
      if (part === "") return;
      const text = escapeHtml(part);
      current += cls ? `<span class="${cls}">${text}</span>` : text;
    });
  }
  lines.push(current);
  return lines;
}
