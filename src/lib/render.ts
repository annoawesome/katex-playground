/**
 * Renders a LaTeX-like document to HTML.
 *
 * KaTeX only typesets *math*; it knows nothing about \section, itemize,
 * theorems, footnotes and so on. This module is the "document layer": a
 * small recursive-descent interpreter for a practical subset of LaTeX that
 * produces HTML, delegating every math fragment to KaTeX.
 *
 * Design notes
 * ────────────
 *  • It works directly on offsets into the original source (no substring
 *    copies), so every diagnostic can point at the exact place in the editor.
 *  • It never throws. Problems are collected as `Diagnostic`s and rendered
 *    inline (red math, highlighted unknown commands), because the input is
 *    usually mid-edit.
 *  • All text is HTML-escaped; the only raw HTML that reaches the output is
 *    produced by this module or by KaTeX (with `trust: false`), so rendering
 *    user documents with `innerHTML` is safe.
 *  • KaTeX output is memoised (see `katexCache`), which makes re-rendering on
 *    every keystroke cheap: typically only the formula being edited changes.
 *
 * Supported: preamble (\documentclass, \usepackage ignored; \title, \author,
 * \date, \newcommand, \renewcommand, \DeclareMathOperator, \def), \maketitle,
 * sections with numbering, paragraphs, inline/display math in all four
 * delimiter styles, numbered equation/align/gather environments, \label/\ref,
 * itemize/enumerate/description, theorem-like environments and proof,
 * quote/center/abstract/verbatim, basic tabular, footnotes, links, text
 * styling, accents, dashes and quotes, \newpage (honoured when printing).
 */
import katex from "katex";
import { escapeHtml } from "./highlight";

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  /** Offset into the source the problem refers to. */
  offset: number;
}

export interface RenderResult {
  html: string;
  diagnostics: Diagnostic[];
  /** Plain-text \title, if the document sets one. */
  title: string | null;
}

export interface RenderOptions {
  /** Date used for \today and the default \maketitle date. */
  today?: Date;
}

interface Range {
  start: number;
  end: number;
}

/** Output sink used while rendering a run of "flow" content. */
interface Sink {
  /** Inline HTML, part of the current paragraph. */
  text(html: string): void;
  /** Block-level HTML; ends the current paragraph. */
  block(html: string): void;
  /** A collapsible inter-word space. */
  space(): void;
  /** Explicit paragraph break. */
  par(): void;
}

// ──────────────────────────────────────────────────────────── vocabulary

const THEOREMS: Record<string, { title: string; upright: boolean }> = {
  theorem: { title: "Theorem", upright: false },
  lemma: { title: "Lemma", upright: false },
  proposition: { title: "Proposition", upright: false },
  corollary: { title: "Corollary", upright: false },
  conjecture: { title: "Conjecture", upright: false },
  claim: { title: "Claim", upright: false },
  definition: { title: "Definition", upright: true },
  example: { title: "Example", upright: true },
  exercise: { title: "Exercise", upright: true },
  remark: { title: "Remark", upright: true },
  note: { title: "Note", upright: true },
};

/** Environments rendered by KaTeX in display mode, row-numbered unless starred. */
const ROW_MATH_ENVS = new Set(["align", "gather", "flalign", "alignat", "eqnarray"]);
/** Environments rendered by KaTeX with a single equation number. */
const SINGLE_MATH_ENVS = new Set(["equation", "multline"]);

/** Simple text-styling commands: \textbf{x} ⇒ <strong>x</strong>. */
const STYLE_COMMANDS: Record<string, [string, string]> = {
  textbf: ["<strong>", "</strong>"],
  textit: ["<em>", "</em>"],
  textsl: ["<em>", "</em>"],
  emph: ['<em class="emph">', "</em>"],
  underline: ['<span class="underline">', "</span>"],
  texttt: ["<code>", "</code>"],
  textsc: ['<span class="smallcaps">', "</span>"],
  textsf: ['<span class="sans">', "</span>"],
  textrm: ["<span>", "</span>"],
  textup: ['<span class="upright">', "</span>"],
  textmd: ['<span class="upright">', "</span>"],
  textnormal: ["<span>", "</span>"],
  text: ["<span>", "</span>"],
  mbox: ['<span class="nowrap">', "</span>"],
};

/** Zero-argument commands that just produce a string of HTML. */
const SYMBOL_COMMANDS: Record<string, string> = {
  LaTeX: '<span class="latex-logo">L<sup>a</sup>T<sub>e</sub>X</span>',
  TeX: '<span class="latex-logo">T<sub>e</sub>X</span>',
  ldots: "…",
  dots: "…",
  textellipsis: "…",
  S: "§",
  P: "¶",
  copyright: "©",
  textregistered: "®",
  texttrademark: "™",
  dag: "†",
  ddag: "‡",
  textbackslash: "\\",
  textasciitilde: "~",
  textasciicircum: "^",
  textbar: "|",
  textless: "&lt;",
  textgreater: "&gt;",
  textendash: "–",
  textemdash: "—",
  textbullet: "•",
  quad: " ",
  qquad: "  ",
  enspace: " ",
  thinspace: " ",
  and: '<span class="author-sep"></span>',
};

/** Commands with no visible effect in this renderer (layout/font switches). */
const IGNORED_COMMANDS = new Set([
  "noindent", "indent", "centering", "raggedright", "raggedleft", "small", "footnotesize",
  "scriptsize", "tiny", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "bfseries",
  "itshape", "mdseries", "upshape", "rmfamily", "sffamily", "ttfamily", "normalfont",
  "protect", "relax", "tableofcontents", "listoffigures", "listoftables", "nopagebreak",
  "frenchspacing", "sloppy", "fussy", "null", "hfill", "vfill", "displaystyle",
]);

/** Commands whose arguments are consumed and discarded: name ⇒ [optional args, required args]. */
const DISCARD_COMMANDS: Record<string, [number, number]> = {
  documentclass: [1, 1],
  usepackage: [1, 1],
  RequirePackage: [1, 1],
  pagestyle: [0, 1],
  thispagestyle: [0, 1],
  pagenumbering: [0, 1],
  setlength: [0, 2],
  addtolength: [0, 2],
  setcounter: [0, 2],
  addtocounter: [0, 2],
  geometry: [0, 1],
  hypersetup: [0, 1],
  newtheorem: [1, 2],
  theoremstyle: [0, 1],
  bibliographystyle: [0, 1],
  bibliography: [0, 1],
  graphicspath: [0, 1],
  vspace: [0, 1],
  addcontentsline: [0, 3],
  index: [0, 1],
  phantom: [0, 1],
};

const ACCENTS: Record<string, string> = {
  "'": "́",
  "`": "̀",
  '"': "̈",
  "^": "̂",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  c: "̧",
  v: "̌",
  u: "̆",
  H: "̋",
};

const isLetter = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z]/.test(ch);

// ──────────────────────────────────────────────────────────── KaTeX cache

type KatexResult = { ok: true; html: string } | { ok: false; message: string; position: number };
const katexCache = new Map<string, KatexResult>();
const KATEX_CACHE_LIMIT = 4000;

function renderKatex(tex: string, display: boolean, macros: Record<string, string>, macrosKey: string): KatexResult {
  const key = `${display ? "D" : "I"}\u0001${macrosKey}\u0001${tex}`;
  const hit = katexCache.get(key);
  if (hit) return hit;
  let result: KatexResult;
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      // KaTeX may mutate the macro table (\gdef); give it a private copy.
      macros: { ...macros },
      trust: false,
      strict: "ignore",
      output: "htmlAndMathml",
    });
    result = { ok: true, html };
  } catch (err) {
    const e = err as { message?: string; position?: number };
    // "KaTeX parse error: Expected group after '^' at position 2: x^̲" ⇒ "Expected group after '^'"
    const message = (e.message ?? String(err))
      .replace(/^KaTeX parse error:\s*/, "")
      .replace(/ at (?:position|end of input)\b[\s\S]*$/, "");
    result = { ok: false, message, position: e.position ?? 0 };
  }
  if (katexCache.size >= KATEX_CACHE_LIMIT) katexCache.clear();
  katexCache.set(key, result);
  return result;
}

// ──────────────────────────────────────────────────────────── renderer

class Renderer {
  readonly diagnostics: Diagnostic[] = [];
  private macros: Record<string, string> = {};
  private macrosKey = "";
  private meta: { title: Range | null; author: Range | null; date: Range | null } = {
    title: null,
    author: null,
    date: null,
  };
  private counters = { section: 0, subsection: 0, subsubsection: 0, theorem: 0, equation: 0, footnote: 0 };
  /** \label key ⇒ the number it refers to. */
  private labels = new Map<string, string>();
  /** \ref occurrences, resolved after the whole document is rendered. */
  private refs: Array<{ key: string; offset: number }> = [];
  /** The number a \label written "now" would refer to. */
  private currentLabel = "";
  private footnotes: string[] = [];

  constructor(
    private readonly src: string,
    private readonly today: Date,
  ) {}

  render(): RenderResult {
    const { src } = this;
    const begin = this.findOutsideComment(/\\begin\s*\{document\}/g, 0);
    let body: Range = { start: 0, end: src.length };
    if (begin) {
      // Everything before \begin{document} is preamble: run it for its side
      // effects (\title, \newcommand …) and discard any output.
      this.flow(0, begin.index, false);
      const end = this.findOutsideComment(/\\end\s*\{document\}/g, begin.end);
      body = { start: begin.end, end: end ? end.index : src.length };
    }

    let html = this.flow(body.start, body.end, false);

    if (this.footnotes.length > 0) {
      html +=
        '<section class="footnotes"><ol>' +
        this.footnotes.map((fn, i) => `<li id="fn-${i + 1}">${fn}</li>`).join("") +
        "</ol></section>";
    }

    // Resolve \ref placeholders now that every \label has been seen.
    let refIdx = 0;
    html = html.replace(/\u0000REF\u0000/g, () => {
      const ref = this.refs[refIdx++]!;
      const value = this.labels.get(ref.key);
      if (value === undefined) {
        this.warn(`Undefined reference "${ref.key}"`, ref.offset);
        return '<span class="ref-missing">??</span>';
      }
      return `<span class="ref">${escapeHtml(value)}</span>`;
    });

    const title = this.meta.title ? this.plainText(this.meta.title) : null;
    this.diagnostics.sort((a, b) => a.offset - b.offset);
    return { html, diagnostics: this.diagnostics, title };
  }

  // ── diagnostics ────────────────────────────────────────────────────────

  private error(message: string, offset: number) {
    this.diagnostics.push({ severity: "error", message, offset });
  }
  private warn(message: string, offset: number) {
    this.diagnostics.push({ severity: "warning", message, offset });
  }

  // ── flow: paragraphs, text and commands ───────────────────────────────

  /**
   * Renders `[start, end)` as a sequence of paragraphs and blocks. In
   * `inline` mode (command arguments such as \textbf{…}) no <p> wrappers are
   * produced and paragraph breaks become spaces.
   */
  private flow(start: number, end: number, inline: boolean): string {
    const { src } = this;
    const out: string[] = [];
    let para = "";
    const flush = () => {
      const t = para.trim();
      if (t !== "") out.push(`<p>${t}</p>`);
      para = "";
    };
    const sink: Sink = {
      text: (html) => {
        para += html;
      },
      block: (html) => {
        if (inline) {
          para += html;
        } else {
          flush();
          out.push(html);
        }
      },
      space: () => {
        if (para !== "" && !para.endsWith(" ")) para += " ";
      },
      par: () => {
        if (inline) sink.space();
        else flush();
      },
    };

    let i = start;
    while (i < end) {
      const ch = src[i]!;
      switch (ch) {
        case "%": {
          // A comment also swallows the newline and the next line's indentation.
          while (i < end && src[i] !== "\n") i++;
          i++;
          while (i < end && (src[i] === " " || src[i] === "\t")) i++;
          break;
        }
        case "\n": {
          let j = i + 1;
          while (j < end && (src[j] === " " || src[j] === "\t" || src[j] === "\r")) j++;
          if (j < end && src[j] === "\n") {
            sink.par();
            while (j < end && /\s/.test(src[j]!)) j++;
          } else {
            sink.space();
          }
          i = j;
          break;
        }
        case " ":
        case "\t":
        case "\r":
          sink.space();
          i++;
          break;
        case "$":
          i = this.dollarMath(i, end, sink);
          break;
        case "\\":
          i = this.command(i, end, sink);
          break;
        case "{": {
          const close = this.matchBrace(i, end);
          if (close === -1) {
            this.error("Unmatched {", i);
            i++;
          } else {
            sink.text(this.flow(i + 1, close, true));
            i = close + 1;
          }
          break;
        }
        case "}":
          this.error("Unmatched }", i);
          i++;
          break;
        case "~":
          sink.text("&nbsp;");
          i++;
          break;
        case "-":
          if (src.startsWith("---", i) && i + 2 < end) {
            sink.text("—");
            i += 3;
          } else if (src.startsWith("--", i) && i + 1 < end) {
            sink.text("–");
            i += 2;
          } else {
            sink.text("-");
            i++;
          }
          break;
        case "`":
          if (src[i + 1] === "`" && i + 1 < end) {
            sink.text("“");
            i += 2;
          } else {
            sink.text("‘");
            i++;
          }
          break;
        case "'":
          if (src[i + 1] === "'" && i + 1 < end) {
            sink.text("”");
            i += 2;
          } else {
            sink.text("’");
            i++;
          }
          break;
        case "^":
        case "_":
          this.warn(`"${ch}" is only allowed in math mode — wrap the formula in \\( … \\)`, i);
          sink.text(ch);
          i++;
          break;
        case "&":
          this.warn('Stray "&" outside a table or alignment (write \\& for an ampersand)', i);
          sink.text("&amp;");
          i++;
          break;
        default: {
          // A run of ordinary characters.
          let j = i + 1;
          while (j < end && !"%\n \t\r$\\{}~-`'^_&".includes(src[j]!)) j++;
          sink.text(escapeHtml(src.slice(i, j)));
          i = j;
        }
      }
    }

    if (inline) return para;
    flush();
    return out.join("");
  }

  // ── math ──────────────────────────────────────────────────────────────

  private dollarMath(i: number, end: number, sink: Sink): number {
    const display = this.src[i + 1] === "$";
    const delim = display ? "$$" : "$";
    const contentStart = i + delim.length;
    const close = this.findMathClose(contentStart, end, delim);
    if (close === -1) {
      this.error(`Unclosed ${delim} — math mode was never closed`, i);
      sink.text(delim);
      return contentStart;
    }
    sink.text(this.math(contentStart, close, display));
    return close + delim.length;
  }

  /**
   * Finds the closing math delimiter, skipping escaped characters. Returns
   * -1 if a blank line (which TeX forbids inside math) or `end` comes first.
   */
  private findMathClose(from: number, end: number, delim: "$" | "$$" | "\\)" | "\\]"): number {
    const { src } = this;
    for (let i = from; i < end; i++) {
      const ch = src[i];
      if (ch === "\\") {
        if ((delim === "\\)" && src[i + 1] === ")") || (delim === "\\]" && src[i + 1] === "]")) return i;
        i++;
      } else if (ch === "$") {
        if (delim === "$") return i;
        if (delim === "$$" && src[i + 1] === "$") return i;
      } else if (ch === "%") {
        while (i < end && src[i] !== "\n") i++;
      } else if (ch === "\n" && /^\n[ \t\r]*\n/.test(src.slice(i, i + 64))) {
        return -1;
      }
    }
    return -1;
  }

  /** Typesets `[start, end)` with KaTeX. */
  private math(start: number, end: number, display: boolean): string {
    return this.mathTex(this.stripMathComments(start, end), display, start);
  }

  private mathTex(tex: string, display: boolean, offset: number): string {
    // KaTeX doesn't know \label; record it against the current number.
    tex = tex.replace(/\\label\s*\{([^}]*)\}/g, (_, key: string) => {
      this.labels.set(key.trim(), this.currentLabel);
      return "";
    });
    const result = renderKatex(tex, display, this.macros, this.macrosKey);
    if (result.ok) return result.html;
    this.error(result.message, offset + result.position);
    const tag = display ? "div" : "span";
    return `<${tag} class="math-error" title="${escapeHtml(result.message)}">${escapeHtml(tex)}</${tag}>`;
  }

  /** Removes `%` comments from a math source slice (TeX ignores them). */
  private stripMathComments(start: number, end: number): string {
    return this.src.slice(start, end).replace(/(^|[^\\])%[^\n]*/g, "$1");
  }

  /** Numbered (or starred) math environments. */
  private mathEnvironment(name: string, body: Range, beginOffset: number): string {
    const star = name.endsWith("*");
    const base = star ? name.slice(0, -1) : name;
    const tex = this.stripMathComments(body.start, body.end);

    if (base === "math") return this.mathTex(tex, false, body.start);
    if (base === "displaymath") return this.mathTex(tex, true, body.start);

    if (SINGLE_MATH_ENVS.has(base)) {
      if (star) {
        return this.mathTex(base === "equation" ? tex : `\\begin{${name}}${tex}\\end{${name}}`, true, body.start);
      }
      const n = String(++this.counters.equation);
      this.currentLabel = n;
      const tagged = /\\(tag|notag|nonumber)\b/.test(tex) ? tex.replace(/\\(notag|nonumber)\b/g, "") : `${tex}\\tag{${n}}`;
      return this.mathTex(base === "equation" ? tagged : `\\begin{multline*}${tagged}\\end{multline*}`, true, body.start);
    }

    // Row environments: number each row ourselves with \tag so numbering is
    // continuous across the document and \ref works.
    const envName = base === "eqnarray" ? "align" : base;
    if (star) return this.mathTex(`\\begin{${envName}*}${tex}\\end{${envName}*}`, true, beginOffset);
    const rows = this.splitTopLevel(body.start, body.end, "row").map((r) => {
      let row = this.stripMathComments(r.start, r.end);
      if (row.trim() === "") return row;
      if (/\\(notag|nonumber)\b/.test(row)) return row.replace(/\\(notag|nonumber)\b/g, "");
      if (/\\tag\b/.test(row)) return row;
      const n = String(++this.counters.equation);
      row = row.replace(/\\label\s*\{([^}]*)\}/g, (_, key: string) => {
        this.labels.set(key.trim(), n);
        return "";
      });
      return `${row} \\tag{${n}}`;
    });
    // Drop a trailing empty row produced by a final `\\`.
    if (rows.length > 1 && rows[rows.length - 1]!.trim() === "") rows.pop();
    return this.mathTex(`\\begin{${envName}*}${rows.join("\\\\")}\\end{${envName}*}`, true, beginOffset);
  }

  // ── commands ──────────────────────────────────────────────────────────

  /** Handles a backslash at `i`. Returns the position after the command. */
  private command(i: number, end: number, sink: Sink): number {
    const { src } = this;
    const next = src[i + 1];

    if (next === undefined || i + 1 >= end) {
      sink.text("\\");
      return i + 1;
    }

    // ── Non-letter control symbols.
    if (!isLetter(next)) {
      switch (next) {
        case "(":
        case "[": {
          const delim = next === "(" ? "\\)" : "\\]";
          const close = this.findMathClose(i + 2, end, delim);
          if (close === -1) {
            this.error(`Unclosed \\${next} — expected ${delim}`, i);
            sink.text(escapeHtml(`\\${next}`));
            return i + 2;
          }
          sink.text(this.math(i + 2, close, next === "["));
          return close + 2;
        }
        case ")":
        case "]":
          this.error(`\\${next} without a matching opening delimiter`, i);
          return i + 2;
        case "\\": {
          // Line break, with optional * and [length].
          let p = i + 2;
          if (src[p] === "*") p++;
          const opt = this.readOptional(p, end);
          if (opt) p = opt.next;
          sink.text("<br>");
          return p;
        }
        case "%":
        case "$":
        case "&":
        case "#":
        case "_":
        case "{":
        case "}":
          sink.text(escapeHtml(next));
          return i + 2;
        case " ":
        case "\n":
          sink.text(" ");
          return i + 2;
        case ",":
          sink.text(" ");
          return i + 2;
        case ";":
        case ":":
          sink.text(" ");
          return i + 2;
        case "!":
        case "-":
        case "/":
        case "@":
          return i + 2;
        default: {
          const mark = ACCENTS[next];
          if (mark) return this.accent(i + 2, end, mark, sink);
          sink.text(escapeHtml(next));
          return i + 2;
        }
      }
    }

    // ── Control words.
    let j = i + 1;
    while (j < end && isLetter(src[j])) j++;
    const name = src.slice(i + 1, j);
    let p = j;
    const starred = src[p] === "*";
    // Zero-argument commands swallow following spaces, as in TeX.
    const skipSpaces = (q: number) => {
      while (q < end && (src[q] === " " || src[q] === "\t")) q++;
      return q;
    };

    if (name in STYLE_COMMANDS) {
      const arg = this.readArg(p, end, name, i);
      if (!arg) return p;
      const [open, close] = STYLE_COMMANDS[name]!;
      sink.text(open + this.flow(arg.range.start, arg.range.end, true) + close);
      return arg.next;
    }
    if (name in SYMBOL_COMMANDS) {
      sink.text(SYMBOL_COMMANDS[name]!);
      return skipSpaces(p);
    }
    if (IGNORED_COMMANDS.has(name)) return skipSpaces(p);
    if (name in DISCARD_COMMANDS) {
      const [opts, args] = DISCARD_COMMANDS[name]!;
      if (src[p] === "*") p++;
      for (let k = 0; k < opts; k++) p = this.readOptional(p, end)?.next ?? p;
      for (let k = 0; k < args; k++) p = this.readArg(p, end, name, i)?.next ?? p;
      if (name === "vspace") sink.block('<div class="vspace"></div>');
      return p;
    }
    if (name in ACCENTS && name.length === 1) return this.accent(p, end, ACCENTS[name]!, sink);

    switch (name) {
      case "par":
        sink.par();
        return skipSpaces(p);
      case "begin":
        return this.environment(i, p, end, sink);
      case "end": {
        const arg = this.readArg(p, end, name, i);
        const env = arg ? src.slice(arg.range.start, arg.range.end) : "";
        this.error(`\\end{${env}} without a matching \\begin{${env}}`, i);
        return arg?.next ?? p;
      }

      case "section":
      case "subsection":
      case "subsubsection":
        return this.section(name, i, starred ? p + 1 : p, end, starred, sink);
      case "paragraph":
      case "subparagraph": {
        if (starred) p++;
        const arg = this.readArg(p, end, name, i);
        if (!arg) return p;
        sink.par();
        sink.text(`<strong class="run-in">${this.flow(arg.range.start, arg.range.end, true)}</strong> `);
        return arg.next;
      }

      case "title":
      case "author":
      case "date": {
        const arg = this.readArg(p, end, name, i);
        if (arg) this.meta[name] = arg.range;
        return arg?.next ?? p;
      }
      case "maketitle":
        sink.block(this.titleBlock());
        return skipSpaces(p);
      case "today":
        sink.text(escapeHtml(this.formatDate()));
        return skipSpaces(p);

      case "newcommand":
      case "renewcommand":
      case "providecommand":
        return this.newCommand(i, starred ? p + 1 : p, end);
      case "DeclareMathOperator":
        return this.declareOperator(i, starred ? p + 1 : p, end, starred);
      case "def":
        return this.def(i, p, end);

      case "newline":
      case "linebreak":
        sink.text("<br>");
        return skipSpaces(p);
      case "newpage":
      case "clearpage":
      case "cleardoublepage":
      case "pagebreak":
        sink.block('<div class="page-break" aria-hidden="true"></div>');
        return skipSpaces(p);
      case "hrule":
      case "rule": {
        if (name === "rule") {
          p = this.readOptional(p, end)?.next ?? p;
          p = this.readArg(p, end, name, i)?.next ?? p;
          p = this.readArg(p, end, name, i)?.next ?? p;
        }
        sink.block("<hr>");
        return skipSpaces(p);
      }
      case "smallskip":
      case "medskip":
      case "bigskip":
        sink.block(`<div class="vspace ${name}"></div>`);
        return skipSpaces(p);
      case "hspace": {
        if (starred) p++;
        sink.text(" ");
        return this.readArg(p, end, name, i)?.next ?? p;
      }

      case "footnote": {
        const arg = this.readArg(p, end, name, i);
        if (!arg) return p;
        const n = ++this.counters.footnote;
        this.footnotes.push(this.flow(arg.range.start, arg.range.end, true));
        sink.text(`<sup class="fn-ref"><a href="#fn-${n}">${n}</a></sup>`);
        return arg.next;
      }
      case "label": {
        const arg = this.readArg(p, end, name, i);
        if (arg) this.labels.set(src.slice(arg.range.start, arg.range.end).trim(), this.currentLabel);
        return arg?.next ?? p;
      }
      case "ref":
      case "eqref":
      case "pageref":
      case "autoref":
      case "cref": {
        const arg = this.readArg(p, end, name, i);
        if (!arg) return p;
        this.refs.push({ key: src.slice(arg.range.start, arg.range.end).trim(), offset: i });
        sink.text(name === "eqref" ? "(\u0000REF\u0000)" : "\u0000REF\u0000");
        return arg.next;
      }
      case "cite": {
        p = this.readOptional(p, end)?.next ?? p;
        const arg = this.readArg(p, end, name, i);
        if (!arg) return p;
        sink.text(`<span class="cite">[${escapeHtml(src.slice(arg.range.start, arg.range.end))}]</span>`);
        return arg.next;
      }

      case "href": {
        const url = this.readArg(p, end, name, i);
        if (!url) return p;
        const label = this.readArg(url.next, end, name, i);
        if (!label) return url.next;
        sink.text(this.link(src.slice(url.range.start, url.range.end), this.flow(label.range.start, label.range.end, true)));
        return label.next;
      }
      case "url": {
        const url = this.readArg(p, end, name, i);
        if (!url) return p;
        const raw = src.slice(url.range.start, url.range.end);
        sink.text(this.link(raw, `<code>${escapeHtml(raw)}</code>`));
        return url.next;
      }

      case "caption": {
        p = this.readOptional(p, end)?.next ?? p;
        const arg = this.readArg(p, end, name, i);
        if (!arg) return p;
        sink.block(`<figcaption>${this.flow(arg.range.start, arg.range.end, true)}</figcaption>`);
        return arg.next;
      }
      case "includegraphics": {
        p = this.readOptional(p, end)?.next ?? p;
        const arg = this.readArg(p, end, name, i);
        if (!arg) return p;
        this.warn("Images can't be embedded in the browser-only playground", i);
        sink.text(`<span class="image-placeholder">[image: ${escapeHtml(src.slice(arg.range.start, arg.range.end))}]</span>`);
        return arg.next;
      }
      case "item":
        this.error("\\item outside of a list environment", i);
        sink.text("• ");
        return skipSpaces(p);
    }

    // ── A user macro from \newcommand used in text mode: typeset it as math
    // if it renders, which covers the common `\newcommand{\R}{\mathbb{R}}`.
    // Otherwise, an unknown command. If KaTeX knows it, it is a math command
    // used outside math mode — say so, and typeset it anyway.
    const asMath = renderKatex(`\\${name}`, false, this.macros, this.macrosKey);
    if (asMath.ok) {
      if (!(`\\${name}` in this.macros)) {
        this.warn(`\\${name} is a math command — wrap it in \\( … \\)`, i);
        sink.text(`<span class="implicit-math" title="Math command outside math mode">${asMath.html}</span>`);
      } else {
        sink.text(asMath.html);
      }
      return skipSpaces(p);
    }
    this.warn(`Unknown command \\${name}`, i);
    sink.text(`<span class="unknown-cmd" title="Unknown command">${escapeHtml(`\\${name}`)}</span>`);
    return p;
  }

  private accent(p: number, end: number, mark: string, sink: Sink): number {
    const { src } = this;
    let base: string;
    let next: number;
    if (src[p] === "{") {
      const close = this.matchBrace(p, end);
      if (close === -1) return p;
      base = src.slice(p + 1, close);
      next = close + 1;
    } else {
      base = src[p] ?? "";
      next = p + 1;
    }
    // \i and \j are dotless letters used under accents.
    base = base.replace(/^\\i$/, "ı").replace(/^\\j$/, "ȷ");
    sink.text(escapeHtml((base + mark).normalize("NFC")));
    return next;
  }

  private link(rawUrl: string, labelHtml: string): string {
    const url = rawUrl.trim().replace(/\\([#%&_~])/g, "$1");
    // Only allow schemes that can't run script.
    if (!/^(https?:|mailto:|#)/i.test(url)) return labelHtml;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
  }

  private section(name: string, at: number, p: number, end: number, starred: boolean, sink: Sink): number {
    p = this.readOptional(p, end)?.next ?? p;
    const arg = this.readArg(p, end, name, at);
    if (!arg) return p;
    const c = this.counters;
    let num = "";
    if (!starred) {
      if (name === "section") {
        c.section++;
        c.subsection = c.subsubsection = 0;
        num = `${c.section}`;
      } else if (name === "subsection") {
        c.subsection++;
        c.subsubsection = 0;
        num = `${c.section}.${c.subsection}`;
      } else {
        c.subsubsection++;
        num = `${c.section}.${c.subsection}.${c.subsubsection}`;
      }
      this.currentLabel = num;
    }
    const tag = name === "section" ? "h2" : name === "subsection" ? "h3" : "h4";
    const numHtml = num ? `<span class="secnum">${num}</span>` : "";
    sink.block(`<${tag} class="${name}">${numHtml}${this.flow(arg.range.start, arg.range.end, true)}</${tag}>`);
    return arg.next;
  }

  private titleBlock(): string {
    const { title, author, date } = this.meta;
    let html = '<header class="doc-title">';
    if (title) html += `<h1>${this.flow(title.start, title.end, true)}</h1>`;
    if (author) html += `<div class="doc-author">${this.flow(author.start, author.end, true)}</div>`;
    // Like LaTeX, the date defaults to \today; \date{} hides it.
    if (!date) html += `<div class="doc-date">${escapeHtml(this.formatDate())}</div>`;
    else if (date.end > date.start) html += `<div class="doc-date">${this.flow(date.start, date.end, true)}</div>`;
    return html + "</header>";
  }

  private formatDate(): string {
    return this.today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  /** \newcommand{\name}[n][default]{body} — becomes a KaTeX macro. */
  private newCommand(at: number, p: number, end: number): number {
    const nameArg = this.readArg(p, end, "newcommand", at);
    if (!nameArg) return p;
    const macroName = this.src.slice(nameArg.range.start, nameArg.range.end).trim();
    p = nameArg.next;
    p = this.readOptional(p, end)?.next ?? p; // number of args
    p = this.readOptional(p, end)?.next ?? p; // default for #1
    const body = this.readArg(p, end, "newcommand", at);
    if (!body) return p;
    if (!/^\\[A-Za-z]+$/.test(macroName)) {
      this.error(`Invalid macro name "${macroName}"`, at);
    } else {
      this.setMacro(macroName, this.src.slice(body.range.start, body.range.end));
    }
    return body.next;
  }

  private declareOperator(at: number, p: number, end: number, starred: boolean): number {
    const nameArg = this.readArg(p, end, "DeclareMathOperator", at);
    if (!nameArg) return p;
    const body = this.readArg(nameArg.next, end, "DeclareMathOperator", at);
    if (!body) return nameArg.next;
    const macroName = this.src.slice(nameArg.range.start, nameArg.range.end).trim();
    const text = this.src.slice(body.range.start, body.range.end);
    this.setMacro(macroName, `\\operatorname${starred ? "*" : ""}{${text}}`);
    return body.next;
  }

  /** \def\name#1#2{body} */
  private def(at: number, p: number, end: number): number {
    const { src } = this;
    const m = /^\s*(\\[A-Za-z]+)[^{]*/.exec(src.slice(p, Math.min(end, p + 200)));
    if (!m) {
      this.error("Malformed \\def", at);
      return p;
    }
    const body = this.readArg(p + m[0].length, end, "def", at);
    if (!body) return p + m[0].length;
    this.setMacro(m[1]!, src.slice(body.range.start, body.range.end));
    return body.next;
  }

  private setMacro(name: string, body: string) {
    this.macros[name] = body;
    this.macrosKey = JSON.stringify(this.macros);
  }

  // ── environments ──────────────────────────────────────────────────────

  private environment(at: number, p: number, end: number, sink: Sink): number {
    const { src } = this;
    const arg = this.readArg(p, end, "begin", at);
    if (!arg) return p;
    const name = src.slice(arg.range.start, arg.range.end).trim();

    // Verbatim bodies are raw text, so find the end by plain search.
    if (name === "verbatim" || name === "lstlisting" || name === "verbatim*") {
      const endTag = `\\end{${name}}`;
      const close = src.indexOf(endTag, arg.next);
      const bodyEnd = close === -1 || close > end ? end : close;
      if (close === -1) this.error(`\\begin{${name}} is never closed`, at);
      let bodyStart = arg.next;
      if (name === "lstlisting") bodyStart = this.readOptional(bodyStart, bodyEnd)?.next ?? bodyStart;
      const text = src.slice(bodyStart, bodyEnd).replace(/^[ \t]*\n/, "").replace(/\n[ \t]*$/, "");
      sink.block(`<pre class="verbatim">${escapeHtml(text)}</pre>`);
      return Math.min(end, bodyEnd + endTag.length);
    }

    const close = this.findEnvironmentEnd(arg.next, end, name);
    if (!close) this.error(`\\begin{${name}} is never closed`, at);
    const body: Range = { start: arg.next, end: close ? close.bodyEnd : end };
    const next = close ? close.next : end;

    const base = name.replace(/\*$/, "");
    if (SINGLE_MATH_ENVS.has(base) || ROW_MATH_ENVS.has(base) || base === "math" || base === "displaymath") {
      // Display math stays part of the surrounding paragraph, as in TeX.
      sink.text(this.mathEnvironment(name, body, at));
      return next;
    }

    if (base in THEOREMS) {
      sink.block(this.theorem(base, name.endsWith("*"), body));
      return next;
    }

    switch (name) {
      case "document":
        sink.block(this.flow(body.start, body.end, false));
        break;
      case "itemize":
      case "enumerate":
      case "description":
        sink.block(this.list(name, body, at));
        break;
      case "proof": {
        const opt = this.readOptional(body.start, body.end);
        const label = opt ? this.flow(opt.range.start, opt.range.end, true) : "Proof";
        let inner = this.flow(opt ? opt.next : body.start, body.end, false);
        inner = injectIntoFirstParagraph(inner, `<em class="proof-head">${label}.</em> `);
        const qed = '<span class="qed" aria-label="end of proof">∎</span>';
        inner = inner.endsWith("</p>") ? `${inner.slice(0, -4)}${qed}</p>` : inner + `<p>${qed}</p>`;
        sink.block(`<div class="proof">${inner}</div>`);
        break;
      }
      case "abstract":
        sink.block(`<div class="abstract"><div class="abstract-title">Abstract</div>${this.flow(body.start, body.end, false)}</div>`);
        break;
      case "quote":
      case "quotation":
        sink.block(`<blockquote>${this.flow(body.start, body.end, false)}</blockquote>`);
        break;
      case "center":
      case "flushleft":
      case "flushright":
        sink.block(`<div class="${name}">${this.flow(body.start, body.end, false)}</div>`);
        break;
      case "figure":
      case "table":
      case "figure*":
      case "table*": {
        const opt = this.readOptional(body.start, body.end); // placement [htbp]
        sink.block(`<figure class="float">${this.flow(opt ? opt.next : body.start, body.end, false)}</figure>`);
        break;
      }
      case "minipage": {
        let p2 = this.readOptional(body.start, body.end)?.next ?? body.start;
        p2 = this.readArg(p2, body.end, name, at)?.next ?? p2;
        sink.block(`<div class="minipage">${this.flow(p2, body.end, false)}</div>`);
        break;
      }
      case "tabular":
      case "tabular*":
      case "array":
        sink.block(this.tabular(name, body, at));
        break;
      default:
        this.warn(`Unknown environment "${name}" — rendering its contents as plain text`, at);
        sink.block(`<div class="env-unknown">${this.flow(body.start, body.end, false)}</div>`);
    }
    return next;
  }

  private theorem(base: string, starred: boolean, body: Range): string {
    const info = THEOREMS[base]!;
    let num = "";
    if (!starred) {
      num = String(++this.counters.theorem);
      this.currentLabel = num;
    }
    const opt = this.readOptional(body.start, body.end);
    const note = opt ? ` <span class="thm-note">(${this.flow(opt.range.start, opt.range.end, true)})</span>` : "";
    const head = `<span class="thm-head">${info.title}${num ? ` ${num}` : ""}${note}.</span> `;
    const inner = this.flow(opt ? opt.next : body.start, body.end, false);
    const cls = `thm thm-${base} ${info.upright ? "thm-upright" : "thm-italic"}`;
    return `<div class="${cls}">${injectIntoFirstParagraph(inner, head)}</div>`;
  }

  private list(name: string, body: Range, at: number): string {
    const { src } = this;
    const pieces = this.splitTopLevel(body.start, body.end, "item");
    const before = pieces.shift()!;
    if (src.slice(before.start, before.end).replace(/%[^\n]*/g, "").trim() !== "") {
      this.warn(`Text before the first \\item in ${name} is ignored`, before.start);
    }
    if (pieces.length === 0) this.warn(`Empty ${name} environment (add \\item)`, at);

    const items = pieces.map((piece) => {
      const opt = this.readOptional(piece.start, piece.end);
      const label = opt ? this.flow(opt.range.start, opt.range.end, true) : null;
      const content = this.flow(opt ? opt.next : piece.start, piece.end, false);
      if (name === "description") return `<dt>${label ?? ""}</dt><dd>${content}</dd>`;
      if (label !== null) return `<li class="custom-label"><span class="item-label">${label}</span>${content}</li>`;
      return `<li>${content}</li>`;
    });
    if (name === "description") return `<dl>${items.join("")}</dl>`;
    const tag = name === "enumerate" ? "ol" : "ul";
    return `<${tag}>${items.join("")}</${tag}>`;
  }

  private tabular(name: string, body: Range, at: number): string {
    const { src } = this;
    let p = body.start;
    if (name === "tabular*") p = this.readArg(p, body.end, name, at)?.next ?? p; // width
    p = this.readOptional(p, body.end)?.next ?? p; // vertical position
    const spec = this.readArg(p, body.end, name, at);
    if (!spec) return "";
    const aligns = parseColumnSpec(src.slice(spec.range.start, spec.range.end));

    const rows: Array<{ cells: string[]; top: boolean; bottom: boolean }> = [];
    for (const r of this.splitTopLevel(spec.next, body.end, "row")) {
      let start = r.start;
      let top = false;
      for (;;) {
        const m = /^\s*\\(hline|toprule|midrule|bottomrule|cline\s*\{[^}]*\})/.exec(src.slice(start, r.end));
        if (!m) break;
        top = true;
        start += m[0].length;
      }
      if (src.slice(start, r.end).trim() === "") {
        if (top && rows.length > 0) rows[rows.length - 1]!.bottom = true;
        continue;
      }
      const cells = this.splitTopLevel(start, r.end, "cell").map((c) => this.flow(c.start, c.end, true).trim());
      rows.push({ cells, top, bottom: false });
    }

    const trs = rows.map((row) => {
      const cls = [row.top ? "rule-top" : "", row.bottom ? "rule-bottom" : ""].filter(Boolean).join(" ");
      const tds = row.cells.map((c, idx) => `<td class="align-${aligns[idx] ?? "l"}">${c}</td>`).join("");
      return `<tr${cls ? ` class="${cls}"` : ""}>${tds}</tr>`;
    });
    const table = `<table class="tabular"><tbody>${trs.join("")}</tbody></table>`;
    // `array` is a math environment in real LaTeX; typesetting it as a table is
    // a reasonable approximation outside of math mode.
    return table;
  }

  // ── scanning helpers ──────────────────────────────────────────────────

  /**
   * Reads a mandatory argument at `p` (after optional whitespace): a brace
   * group, a single control sequence, or a single character.
   */
  private readArg(p: number, end: number, cmd: string, at: number): { range: Range; next: number } | null {
    const { src } = this;
    let q = p;
    while (q < end && /[ \t\r\n]/.test(src[q]!) && !(src[q] === "\n" && /^\n[ \t\r]*\n/.test(src.slice(q, q + 64)))) q++;
    if (q >= end || src[q] === "}") {
      this.error(`\\${cmd} is missing an argument`, at);
      return null;
    }
    if (src[q] === "{") {
      const close = this.matchBrace(q, end);
      if (close === -1) {
        this.error(`Unclosed { in argument of \\${cmd}`, q);
        return { range: { start: q + 1, end }, next: end };
      }
      return { range: { start: q + 1, end: close }, next: close + 1 };
    }
    if (src[q] === "\\") {
      let r = q + 1;
      if (isLetter(src[r])) while (r < end && isLetter(src[r])) r++;
      else r++;
      return { range: { start: q, end: r }, next: r };
    }
    return { range: { start: q, end: q + 1 }, next: q + 1 };
  }

  /** Reads an optional `[…]` argument at `p` (after optional spaces). */
  private readOptional(p: number, end: number): { range: Range; next: number } | null {
    const { src } = this;
    let q = p;
    while (q < end && (src[q] === " " || src[q] === "\t")) q++;
    if (src[q] !== "[") return null;
    let depth = 0;
    for (let r = q + 1; r < end; r++) {
      const ch = src[r];
      if (ch === "\\") r++;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === "]" && depth === 0) return { range: { start: q + 1, end: r }, next: r + 1 };
    }
    return null;
  }

  /** Index of the `}` matching the `{` at `open`, or -1. Skips escapes and comments. */
  private matchBrace(open: number, end: number): number {
    const { src } = this;
    let depth = 0;
    for (let i = open; i < end; i++) {
      const ch = src[i];
      if (ch === "\\") i++;
      else if (ch === "%") while (i < end && src[i] !== "\n") i++;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return i;
    }
    return -1;
  }

  /** Finds the `\end{name}` that closes an environment opened before `from`. */
  private findEnvironmentEnd(from: number, end: number, name: string): { bodyEnd: number; next: number } | null {
    const { src } = this;
    const re = /\\(begin|end)\s*\{([^}\n]*)\}|%[^\n]*|\\./g;
    re.lastIndex = from;
    let depth = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null && m.index < end) {
      if (!m[1] || m[2]!.trim() !== name) continue;
      if (m[1] === "begin") depth++;
      else if (depth === 0) return { bodyEnd: m.index, next: m.index + m[0].length };
      else depth--;
    }
    return null;
  }

  /**
   * Splits `[start, end)` at top-level separators (not inside braces or
   * nested environments): `\\` for rows, `&` for cells, `\item` for items.
   * Returns the pieces between separators (the first piece is whatever
   * precedes the first separator).
   */
  private splitTopLevel(start: number, end: number, kind: "row" | "cell" | "item"): Range[] {
    const { src } = this;
    const pieces: Range[] = [];
    let pieceStart = start;
    let braces = 0;
    let envs = 0;
    for (let i = start; i < end; i++) {
      const ch = src[i];
      if (ch === "%") {
        while (i < end && src[i] !== "\n") i++;
      } else if (ch === "{") {
        braces++;
      } else if (ch === "}") {
        braces--;
      } else if (ch === "&" && kind === "cell" && braces === 0 && envs === 0) {
        pieces.push({ start: pieceStart, end: i });
        pieceStart = i + 1;
      } else if (ch === "\\") {
        if (isLetter(src[i + 1])) {
          let j = i + 1;
          while (j < end && isLetter(src[j])) j++;
          const name = src.slice(i + 1, j);
          if (name === "begin") envs++;
          else if (name === "end") envs--;
          else if (name === "item" && kind === "item" && braces === 0 && envs === 0) {
            pieces.push({ start: pieceStart, end: i });
            pieceStart = j;
          }
          i = j - 1;
        } else if (src[i + 1] === "\\" && kind === "row" && braces === 0 && envs === 0) {
          pieces.push({ start: pieceStart, end: i });
          let j = i + 2;
          if (src[j] === "*") j++;
          const opt = this.readOptional(j, end);
          if (opt) j = opt.next;
          pieceStart = j;
          i = j - 1;
        } else {
          i++;
        }
      }
    }
    pieces.push({ start: pieceStart, end });
    return pieces;
  }

  /** Finds a regex match whose start is not inside a `%` comment. */
  private findOutsideComment(re: RegExp, from: number): { index: number; end: number } | null {
    re.lastIndex = from;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.src)) !== null) {
      const lineStart = this.src.lastIndexOf("\n", m.index - 1) + 1;
      if (!/(^|[^\\])%/.test(this.src.slice(lineStart, m.index))) return { index: m.index, end: m.index + m[0].length };
    }
    return null;
  }

  /** Rough plain-text version of a source range (for the document title). */
  private plainText(r: Range): string {
    return this.src
      .slice(r.start, r.end)
      .replace(/\\\\/g, " ")
      .replace(/\\[A-Za-z]+\*?/g, "")
      .replace(/[{}$~]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

/** Puts `head` at the start of the first <p> of `html`, run-in style. */
function injectIntoFirstParagraph(html: string, head: string): string {
  return html.startsWith("<p>") ? `<p>${head}${html.slice(3)}` : `<p>${head}</p>${html}`;
}

/** `|l|c|r|p{3cm}` ⇒ ["l", "c", "r", "l"]. */
export function parseColumnSpec(spec: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i]!;
    if (ch === "l" || ch === "c" || ch === "r") out.push(ch);
    else if (ch === "p" || ch === "m" || ch === "b" || ch === "X") {
      out.push("l");
      if (spec[i + 1] === "{") i = spec.indexOf("}", i);
    } else if (ch === "@" || ch === "!" || ch === ">" || ch === "<") {
      // Skip the {…} argument of these column modifiers.
      if (spec[i + 1] === "{") i = spec.indexOf("}", i);
    }
    if (i === -1) break;
  }
  return out;
}

/** Renders a document. Never throws. */
export function renderDocument(src: string, options: RenderOptions = {}): RenderResult {
  return new Renderer(src, options.today ?? new Date()).render();
}
