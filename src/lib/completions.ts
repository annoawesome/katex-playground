/**
 * Command completion: after typing `\` and a few letters, the editor shows a
 * popup of matching commands. This module holds the vocabulary and the
 * (pure) matching logic; the popup lives in components/Editor.tsx.
 */
import { CURSOR_MARK as C } from "./editing";
import { PALETTE } from "./symbols";

export interface Completion {
  /** What the user sees and what is matched against, e.g. `\frac`. */
  label: string;
  /** Snippet inserted in place of the typed `\prefix`. */
  insert: string;
  detail: string;
}

const env = (name: string, detail: string, body = `  ${C}`): Completion => ({
  label: `\\begin{${name}}`,
  insert: `\\begin{${name}}\n${body}\n\\end{${name}}`,
  detail,
});

/** Text-mode commands and environments (math symbols come from the palette). */
const TEXT_COMPLETIONS: Completion[] = [
  { label: "\\section", insert: `\\section{${C}}`, detail: "Section heading" },
  { label: "\\subsection", insert: `\\subsection{${C}}`, detail: "Subsection heading" },
  { label: "\\subsubsection", insert: `\\subsubsection{${C}}`, detail: "Subsubsection heading" },
  { label: "\\textbf", insert: `\\textbf{${C}}`, detail: "Bold text" },
  { label: "\\textit", insert: `\\textit{${C}}`, detail: "Italic text" },
  { label: "\\emph", insert: `\\emph{${C}}`, detail: "Emphasis" },
  { label: "\\underline", insert: `\\underline{${C}}`, detail: "Underline" },
  { label: "\\texttt", insert: `\\texttt{${C}}`, detail: "Monospace text" },
  { label: "\\textsc", insert: `\\textsc{${C}}`, detail: "Small caps" },
  { label: "\\footnote", insert: `\\footnote{${C}}`, detail: "Footnote" },
  { label: "\\href", insert: `\\href{${C}}{}`, detail: "Link" },
  { label: "\\url", insert: `\\url{${C}}`, detail: "URL" },
  { label: "\\label", insert: `\\label{${C}}`, detail: "Label for \\ref" },
  { label: "\\ref", insert: `\\ref{${C}}`, detail: "Reference a label" },
  { label: "\\eqref", insert: `\\eqref{${C}}`, detail: "Reference an equation" },
  { label: "\\item", insert: "\\item ", detail: "List item" },
  { label: "\\title", insert: `\\title{${C}}`, detail: "Document title" },
  { label: "\\author", insert: `\\author{${C}}`, detail: "Document author" },
  { label: "\\date", insert: `\\date{${C}}`, detail: "Document date" },
  { label: "\\maketitle", insert: "\\maketitle", detail: "Print the title block" },
  { label: "\\newcommand", insert: `\\newcommand{\\${C}}{}`, detail: "Define a macro" },
  { label: "\\newpage", insert: "\\newpage", detail: "Page break (in PDF export)" },
  { label: "\\today", insert: "\\today", detail: "Today's date" },
  { label: "\\LaTeX", insert: "\\LaTeX{}", detail: "LaTeX logo" },
  env("document", "Document body"),
  env("itemize", "Bulleted list", `  \\item ${C}`),
  env("enumerate", "Numbered list", `  \\item ${C}`),
  env("description", "Description list", `  \\item[${C}] `),
  env("equation", "Numbered equation"),
  env("equation*", "Unnumbered equation"),
  env("align", "Aligned equations", `  ${C} &=  \\\\\n   &= `),
  env("align*", "Aligned equations, unnumbered", `  ${C} &=  \\\\\n   &= `),
  env("gather", "Gathered equations"),
  env("theorem", "Theorem"),
  env("lemma", "Lemma"),
  env("proposition", "Proposition"),
  env("corollary", "Corollary"),
  env("definition", "Definition"),
  env("example", "Example"),
  env("remark", "Remark"),
  env("proof", "Proof"),
  env("abstract", "Abstract"),
  env("quote", "Block quote"),
  env("center", "Centered block"),
  env("verbatim", "Verbatim text"),
  env("tabular", "Table", `  ${C} &  \\\\\n   & `),
  env("pmatrix", "Matrix (parentheses)", `  ${C} &  \\\\\n   & `),
  env("bmatrix", "Matrix (brackets)", `  ${C} &  \\\\\n   & `),
  env("cases", "Piecewise cases", `  ${C} & \\text{if }  \\\\\n   & \\text{otherwise}`),
];

/** Palette entries that start with a single command, e.g. `\forall `. */
const MATH_COMPLETIONS: Completion[] = PALETTE.flatMap((g) =>
  g.items
    .filter((it) => /^\\[A-Za-z]+/.test(it.insert) && !it.insert.startsWith("\\begin"))
    .map((it) => ({ label: /^\\[A-Za-z]+/.exec(it.insert)![0], insert: it.insert.trimEnd(), detail: it.title })),
);

/** The complete vocabulary, de-duplicated by label (first wins). */
export const COMPLETIONS: Completion[] = (() => {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const c of [...TEXT_COMPLETIONS, ...MATH_COMPLETIONS]) {
    // \mathbb{N} and \mathbb{Z} share a label; keep each distinct insert.
    const key = `${c.label}\u0000${c.insert}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
})();

/**
 * If the cursor is right after `\letters`, returns where that command starts
 * and the letters typed so far. A preceding `\\` (line break) doesn't count.
 */
export function completionContext(text: string, cursor: number): { from: number; prefix: string } | null {
  let i = cursor;
  while (i > 0 && /[A-Za-z]/.test(text[i - 1]!)) i--;
  if (i === 0 || text[i - 1] !== "\\") return null;
  // Count backslashes: an even number means the last one is escaped.
  let slashes = 0;
  for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) slashes++;
  if (slashes % 2 === 0) return null;
  const prefix = text.slice(i, cursor);
  if (prefix.length === 0) return null;
  return { from: i - 1, prefix };
}

/**
 * Ranks completions for `prefix`: exact match, then prefix matches (shortest
 * first), then substring matches. Case-sensitive matches rank above
 * case-insensitive ones so `\Delta` and `\delta` behave sensibly.
 */
export function filterCompletions(prefix: string, limit = 8, list: readonly Completion[] = COMPLETIONS): Completion[] {
  const lower = prefix.toLowerCase();
  const scored: Array<[number, Completion]> = [];
  for (const c of list) {
    const name = c.label.slice(1);
    let score: number;
    if (name === prefix) score = 0;
    else if (name.startsWith(prefix)) score = 1;
    else if (name.toLowerCase().startsWith(lower)) score = 2;
    else if (name.toLowerCase().includes(lower)) score = 3;
    else continue;
    scored.push([score * 1000 + name.length, c]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, limit).map(([, c]) => c);
}
