/**
 * "Lazy math" suggestions.
 *
 * People often type mathematics in plain English or ASCII — `For all a in Z,
 * a is even` or `x > y => x - y > 0` — and only later (or never) convert it to
 * proper LaTeX. This module spots such fragments near the cursor and proposes
 * a LaTeX rewrite, e.g. `\(\forall a \in \mathbb{Z}, a \text{ is even}\)`.
 *
 * It is a deliberately small, deterministic, rule-based system (no AI):
 *
 *   text ──tokenize──▶ raw tokens ──classify──▶ items ──gate/trim──▶ LaTeX
 *
 *  • tokenize: split into words, numbers, ASCII operators and punctuation,
 *    remembering where whitespace was.
 *  • classify: match multi-word phrases ("for all", "less than or equal to"),
 *    operators ("=>", "<="), Greek letter names, function names, set letters
 *    (Z after "in" ⇒ \mathbb{Z}), single-letter variables, and leftover
 *    English words (which become \text{…}).
 *  • gate: only suggest when the fragment actually looks like maths — it must
 *    contain at least one "strong" signal (a relation, quantifier, arrow …)
 *    and an operand, and not be mostly English.
 *  • trim: leading English ("Suppose", "Then we get") stays outside the math;
 *    trailing English stays outside too, unless the fragment is a quantified
 *    statement, where it is part of the formula.
 *
 * There is also a math-mode variant (`asciiMathToLatex`): inside existing
 * math it offers to replace ASCII like `<=`, `=>` or `alpha` with `\leq`,
 * `\implies`, `\alpha`.
 */
import { lex, mathRangeAt, type MathRange } from "./lexer";

// ───────────────────────────────────────────────────────────── dictionaries

/** Multi-word (and some single-word) English phrases with a LaTeX meaning. */
const PHRASES: ReadonlyArray<readonly [string[], string]> = (
  [
    [["for", "all"], "\\forall"],
    [["for", "every"], "\\forall"],
    [["for", "each"], "\\forall"],
    [["for", "any"], "\\forall"],
    [["there", "exists"], "\\exists"],
    [["there", "exist"], "\\exists"],
    [["there", "is", "no"], "\\nexists"],
    [["exists"], "\\exists"],
    [["is", "not", "in"], "\\notin"],
    [["not", "in"], "\\notin"],
    [["is", "in"], "\\in"],
    // Only accepted between two operands; see `classify`.
    [["in"], "\\in"],
    [["is", "an", "element", "of"], "\\in"],
    [["element", "of"], "\\in"],
    [["is", "a", "proper", "subset", "of"], "\\subset"],
    [["is", "a", "subset", "of"], "\\subseteq"],
    [["subset", "of"], "\\subseteq"],
    [["if", "and", "only", "if"], "\\iff"],
    [["iff"], "\\iff"],
    [["implies"], "\\implies"],
    [["is", "less", "than", "or", "equal", "to"], "\\leq"],
    [["less", "than", "or", "equal", "to"], "\\leq"],
    [["is", "greater", "than", "or", "equal", "to"], "\\geq"],
    [["greater", "than", "or", "equal", "to"], "\\geq"],
    [["is", "less", "than"], "<"],
    [["less", "than"], "<"],
    [["is", "greater", "than"], ">"],
    [["greater", "than"], ">"],
    [["is", "not", "equal", "to"], "\\neq"],
    [["not", "equal", "to"], "\\neq"],
    [["is", "equal", "to"], "="],
    [["equals"], "="],
    [["is", "approximately"], "\\approx"],
    [["approximately"], "\\approx"],
    [["divides"], "\\mid"],
    [["union"], "\\cup"],
    [["intersect"], "\\cap"],
    [["intersection"], "\\cap"],
    [["infinity"], "\\infty"],
  ] as Array<[string[], string]>
)
  // Longest phrases first so "is less than or equal to" beats "is less than".
  .sort((a, b) => b[0].length - a[0].length);

/** ASCII operators, longest first so `<=>` wins over `<=`. */
const OPERATORS: ReadonlyArray<readonly [string, string]> = [
  ["<==>", "\\iff"],
  ["<=>", "\\iff"],
  ["==>", "\\implies"],
  ["|->", "\\mapsto"],
  ["...", "\\ldots"],
  ["=>", "\\implies"],
  ["<=", "\\leq"],
  [">=", "\\geq"],
  ["!=", "\\neq"],
  ["/=", "\\neq"],
  ["->", "\\to"],
  ["+-", "\\pm"],
  ["~=", "\\approx"],
  ["*", "\\cdot"],
  ["=", "="],
  ["<", "<"],
  [">", ">"],
  ["+", "+"],
  ["-", "-"],
  ["/", "/"],
  ["^", "^"],
  ["_", "_"],
  ["(", "("],
  [")", ")"],
  ["[", "["],
  ["]", "]"],
  ["|", "|"],
  [",", ","],
  [":", ":"],
  [";", ";"],
  ["!", "!"],
  ["'", "'"],
];

/** Results that make a fragment look like mathematics. */
const STRONG = new Set([
  "\\forall",
  "\\exists",
  "\\nexists",
  "\\in",
  "\\notin",
  "\\subset",
  "\\subseteq",
  "\\iff",
  "\\implies",
  "\\leq",
  "\\geq",
  "\\neq",
  "\\approx",
  "\\to",
  "\\mapsto",
  "\\pm",
  "\\mid",
  "\\cup",
  "\\cap",
  "<",
  ">",
  "=",
  "^",
]);

export const GREEK_LETTERS: ReadonlySet<string> = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta",
  "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau",
  "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
]);

export const MATH_FUNCTIONS: ReadonlySet<string> = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "exp", "lim", "max", "min", "sup", "inf",
  "gcd", "det", "dim", "ker", "deg",
]);

/** Single capital letters that conventionally name number sets. */
const NUMBER_SETS = new Set(["N", "Z", "Q", "R", "C"]);
/** After these, a number-set letter becomes blackboard bold. */
const SET_CONTEXT = new Set(["\\in", "\\notin", "\\subseteq", "\\subset", "\\to", ":", "\\times", "\\cup", "\\cap"]);
/**
 * Words after which a lone `a`/`A`/`I` is still a variable rather than an
 * article/pronoun: "a is even" vs "a number".
 */
const VARIABLE_FOLLOWERS = new Set(["is", "are", "in", "divides", "equals", "implies", "iff", "and", "or", "be", "not"]);

// ─────────────────────────────────────────────────────────── tokenization

interface RawToken {
  kind: "word" | "number" | "op";
  raw: string;
  start: number;
  end: number;
  spaceBefore: boolean;
}

function tokenize(text: string): RawToken[] | null {
  const out: RawToken[] = [];
  let i = 0;
  let space = false;
  outer: while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      space = true;
      i++;
      continue;
    }
    const push = (kind: RawToken["kind"], end: number) => {
      out.push({ kind, raw: text.slice(i, end), start: i, end, spaceBefore: space });
      space = false;
      i = end;
    };
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z]/.test(text[j]!)) j++;
      push("word", j);
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      if (text[j] === "." && /[0-9]/.test(text[j + 1] ?? "")) {
        j++;
        while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      }
      push("number", j);
      continue;
    }
    for (const [op] of OPERATORS) {
      if (text.startsWith(op, i)) {
        push("op", i + op.length);
        continue outer;
      }
    }
    // Anything else (quotes, backslashes, unicode…) means we don't understand
    // this fragment well enough to rewrite it.
    return null;
  }
  return out;
}

// ─────────────────────────────────────────────────────────── classification

interface Item {
  /** "math" items are emitted as-is, "text" items are grouped into \text{}. */
  type: "math" | "text";
  tex: string;
  spaceBefore: boolean;
  /** Offsets into the original fragment. */
  start: number;
  end: number;
  strong: boolean;
  /** Variables, numbers and sets — things relations relate. */
  operand: boolean;
}

function classify(tokens: RawToken[]): Item[] {
  const items: Item[] = [];
  // The immediately preceding item, if it is math.
  const lastMath = (): Item | null => {
    const prev = items[items.length - 1];
    return prev?.type === "math" ? prev : null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const base = { spaceBefore: tok.spaceBefore, start: tok.start, end: tok.end, strong: false, operand: false };

    if (tok.kind === "number") {
      items.push({ ...base, type: "math", tex: tok.raw, operand: true });
      continue;
    }
    if (tok.kind === "op") {
      const tex = OPERATORS.find(([op]) => op === tok.raw)![1];
      items.push({ ...base, type: "math", tex, strong: STRONG.has(tex), operand: tok.raw === ")" });
      continue;
    }

    // Words: phrases first (case-insensitive).
    const phrase = matchPhrase(tokens, i);
    if (phrase) {
      const [len, tex] = phrase;
      const prev = lastMath();
      const next = tokens[i + len];
      // The lone word "in" is only membership between two operands:
      // "a in Z" yes, "x in this case" no.
      const isLoneIn = len === 1 && tokens[i]!.raw.toLowerCase() === "in";
      if (!isLoneIn || (prev?.operand && next !== undefined && isOperandWord(next))) {
        const last = tokens[i + len - 1]!;
        items.push({ ...base, end: last.end, type: "math", tex, strong: STRONG.has(tex) || len > 1 });
        i += len - 1;
        continue;
      }
    }

    const word = tok.raw;
    if (GREEK_LETTERS.has(word)) {
      items.push({ ...base, type: "math", tex: `\\${word}`, operand: true });
    } else if (MATH_FUNCTIONS.has(word)) {
      items.push({ ...base, type: "math", tex: `\\${word}` });
    } else if (word === "sqrt") {
      items.push({ ...base, type: "math", tex: "\\sqrt", strong: true });
    } else if (word.length === 1) {
      const prev = lastMath();
      if (NUMBER_SETS.has(word) && prev && SET_CONTEXT.has(prev.tex)) {
        items.push({ ...base, type: "math", tex: `\\mathbb{${word}}`, operand: true, strong: true });
      } else if (isArticle(tokens, i)) {
        items.push({ ...base, type: "text", tex: word });
      } else {
        items.push({ ...base, type: "math", tex: word, operand: true });
      }
    } else {
      items.push({ ...base, type: "text", tex: word });
    }
  }
  return items;
}

function matchPhrase(tokens: RawToken[], i: number): [number, string] | null {
  for (const [words, tex] of PHRASES) {
    if (i + words.length > tokens.length) continue;
    let ok = true;
    for (let k = 0; k < words.length; k++) {
      const t = tokens[i + k]!;
      // Phrase words must be adjacent words separated only by whitespace.
      if (t.kind !== "word" || t.raw.toLowerCase() !== words[k] || (k > 0 && !t.spaceBefore)) {
        ok = false;
        break;
      }
    }
    if (ok) return [words.length, tex];
  }
  return null;
}

function isOperandWord(t: RawToken): boolean {
  return t.kind === "number" || (t.kind === "word" && (t.raw.length === 1 || GREEK_LETTERS.has(t.raw)));
}

/** Is the single letter at `i` an English article/pronoun ("a", "A", "I")? */
function isArticle(tokens: RawToken[], i: number): boolean {
  const w = tokens[i]!.raw;
  if (w !== "a" && w !== "A" && w !== "I") return false;
  const next = tokens[i + 1];
  // "A subset of B": a math phrase follows, so this is a variable.
  if (matchPhrase(tokens, i + 1)) return false;
  return (
    next !== undefined &&
    next.kind === "word" &&
    next.raw.length > 1 &&
    !VARIABLE_FOLLOWERS.has(next.raw.toLowerCase()) &&
    !GREEK_LETTERS.has(next.raw)
  );
}

// ──────────────────────────────────────────────────────── post-processing

/** `sqrt ( … )` ⇒ `\sqrt{…}`; `^ ( … )` ⇒ `^{…}`; `^ 10` ⇒ `^{10}`. */
function collapseGroups(items: Item[]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const isScript = it.tex === "^" || it.tex === "_";
    const next = items[i + 1];
    if ((it.tex === "\\sqrt" || isScript) && next?.tex === "(") {
      const close = findClose(items, i + 1);
      if (close !== -1) {
        const inner = collapseGroups(items.slice(i + 2, close));
        const tex = `${it.tex}{${emit(inner)}}`;
        out.push({ ...it, tex, end: items[close]!.end, operand: it.tex === "\\sqrt" });
        i = close;
        continue;
      }
    }
    if (isScript && next && next.operand && next.tex.length > 1 && !next.spaceBefore) {
      out.push({ ...it, tex: `${it.tex}{${next.tex}}`, end: next.end });
      i++;
      continue;
    }
    out.push(it);
  }
  return out;
}

function findClose(items: Item[], openIdx: number): number {
  let depth = 0;
  for (let k = openIdx; k < items.length; k++) {
    if (items[k]!.tex === "(") depth++;
    else if (items[k]!.tex === ")" && --depth === 0) return k;
  }
  return -1;
}

/** Joins items into LaTeX, grouping runs of English words into \text{}. */
function emit(items: Item[]): string {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    let piece: string;
    if (it.type === "text") {
      let j = i;
      const words: string[] = [];
      while (j < items.length && items[j]!.type === "text") words.push(items[j++]!.tex);
      const lead = i > 0 ? " " : "";
      const trail = j < items.length ? " " : "";
      piece = `\\text{${lead}${words.join(" ")}${trail}}`;
      i = j - 1;
    } else {
      piece = it.tex;
    }
    // Keep the user's spacing, but a control word like \in must be separated
    // from a following letter or it would become a different command.
    const needSpace = /\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(piece);
    if (out !== "" && (it.spaceBefore || needSpace)) out += " ";
    out += piece;
  }
  return out;
}

// ───────────────────────────────────────────────────────────── public API

export interface LazyConversion {
  /** LaTeX for the math part, without delimiters. */
  math: string;
  /** The `[start, end)` slice of the input that the math replaces. */
  start: number;
  end: number;
}

/**
 * Converts a plain-text fragment to LaTeX math, or returns null when the
 * fragment doesn't look like maths. Leading (and usually trailing) English
 * is excluded from the converted span.
 */
export function lazyToLatex(text: string): LazyConversion | null {
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return null;
  let items = collapseGroups(classify(tokens));

  // Trim leading English words: "Suppose x > 0" ⇒ Suppose \(x > 0\).
  let first = items.findIndex((it) => it.type === "math");
  if (first === -1) return null;
  // Trim trailing English unless this is a quantified statement.
  const quantified = items[first]!.tex === "\\forall" || items[first]!.tex === "\\exists";
  let last = items.length - 1;
  if (!quantified) while (last > first && items[last]!.type === "text") last--;
  // Never start or end on dangling punctuation like "," or ":".
  while (first < last && /^[,;:]$/.test(items[first]!.tex)) first++;
  while (last > first && /^[,;:]$/.test(items[last]!.tex)) last--;
  items = items.slice(first, last + 1);

  // Gate: does this really look like maths?
  const strong = items.some((it) => it.strong);
  const operand = items.some((it) => it.operand);
  const textWords = items.filter((it) => it.type === "text").length;
  const mathItems = items.length - textWords;
  if (!strong || !operand || textWords > mathItems) return null;

  return { math: emit(items), start: items[0]!.start, end: items[items.length - 1]!.end };
}

/** LaTeX commands whose brace argument must not be touched in math mode. */
const VERBATIM_ARG_COMMANDS = new Set([
  "text", "textbf", "textit", "textrm", "mathrm", "mathit", "mathbf", "mathsf", "mathtt",
  "operatorname", "mbox", "begin", "end", "label", "tag", "ref", "eqref",
]);
/** ASCII operators worth replacing inside math. Longest first. */
// (Single characters like `*` are left alone: `a^*` is legitimate LaTeX.)
const MATH_OPERATORS: ReadonlyArray<readonly [string, string]> = OPERATORS.filter(
  ([op, tex]) => op.length > 1 && tex.startsWith("\\"),
);

/**
 * Inside existing math, replace ASCII shorthands (`<=`, `=>`, `->`, `alpha`,
 * `sin`) with proper commands. Returns the input unchanged if nothing applies.
 */
export function asciiMathToLatex(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch === "\\") {
      let j = i + 1;
      while (j < body.length && /[A-Za-z]/.test(body[j]!)) j++;
      if (j === i + 1) j = Math.min(i + 2, body.length); // escaped symbol like \{
      const name = body.slice(i + 1, j);
      out += body.slice(i, j);
      i = j;
      if (VERBATIM_ARG_COMMANDS.has(name)) {
        // Copy the following {…} group untouched.
        let k = i;
        while (body[k] === " ") k++;
        if (body[k] === "{") {
          let depth = 0;
          for (; k < body.length; k++) {
            if (body[k] === "\\") k++;
            else if (body[k] === "{") depth++;
            else if (body[k] === "}" && --depth === 0) break;
          }
          out += body.slice(i, k + 1);
          i = k + 1;
        }
      }
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < body.length && /[A-Za-z]/.test(body[j]!)) j++;
      const word = body.slice(i, j);
      if (GREEK_LETTERS.has(word) || MATH_FUNCTIONS.has(word)) {
        out += `\\${word}`;
        if (/[A-Za-z]/.test(body[j] ?? "")) out += " ";
      } else {
        out += word;
      }
      i = j;
      continue;
    }
    const op = MATH_OPERATORS.find(([o]) => body.startsWith(o, i));
    if (op) {
      const before = out === "" || /\s$/.test(out) ? "" : " ";
      const after = i + op[0].length >= body.length || /\s/.test(body[i + op[0].length]!) ? "" : " ";
      out += before + op[1] + after;
      i += op[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export interface Suggestion {
  /** Range of the source to replace. */
  from: number;
  to: number;
  /** The text currently in that range. */
  original: string;
  /** What to put there instead. */
  replacement: string;
  /** Math body (no delimiters), for previewing the suggestion with KaTeX. */
  math: string;
  /** Whether we are wrapping prose into math, or fixing up existing math. */
  kind: "wrap" | "math";
}

/**
 * Finds a suggestion for the text around `cursor`, or null.
 *
 * Outside math, the candidate is the "clause" around the cursor: the part of
 * the current line bounded by math regions, comments and sentence-ending
 * punctuation. Inside a closed math region, the candidate is that region's
 * content.
 */
export function suggestAt(src: string, cursor: number, mathRanges?: readonly MathRange[]): Suggestion | null {
  const ranges = mathRanges ?? lex(src).mathRanges;

  const inMath = mathRangeAt(ranges, cursor);
  if (inMath) {
    if (inMath.unterminated) return null;
    const original = src.slice(inMath.contentStart, inMath.contentEnd);
    const converted = asciiMathToLatex(original);
    if (converted === original) return null;
    return {
      from: inMath.contentStart,
      to: inMath.contentEnd,
      original,
      replacement: converted,
      math: converted,
      kind: "math",
    };
  }

  const lineStart = src.lastIndexOf("\n", cursor - 1) + 1;
  let lineEnd = src.indexOf("\n", cursor);
  if (lineEnd === -1) lineEnd = src.length;

  // Cut the line into segments at math regions, a comment, and sentence ends.
  const segments: Array<[number, number]> = [];
  let segStart = lineStart;
  let p = lineStart;
  while (p < lineEnd) {
    const ch = src[p]!;
    const range = ranges.find((r) => r.start === p);
    if (range) {
      segments.push([segStart, p]);
      p = segStart = Math.min(range.end, lineEnd);
      continue;
    }
    if (ch === "\\" && src[p + 1] === "%") {
      p += 2;
      continue;
    }
    if (ch === "%") {
      lineEnd = p; // ignore the comment
      break;
    }
    if (isSentenceEnd(src, p, lineEnd)) {
      segments.push([segStart, p]);
      segStart = p + 1;
    }
    p++;
  }
  segments.push([segStart, lineEnd]);

  // Prefer the segment containing the cursor; if that's blank (cursor just
  // after a full stop), use the segment that ends right before it.
  const nonBlank = segments.filter(([s, e]) => src.slice(s, e).trim() !== "");
  const seg =
    nonBlank.find(([s, e]) => cursor >= s && cursor <= e) ??
    nonBlank.filter(([, e]) => e <= cursor && src.slice(e, cursor).trim().length <= 1).pop();
  if (!seg) return null;

  const text = src.slice(seg[0], seg[1]);
  // Anything that already looks like LaTeX markup is left alone.
  if (/[\\{}$]/.test(text)) return null;
  const conv = lazyToLatex(text);
  if (!conv) return null;

  const from = seg[0] + conv.start;
  const to = seg[0] + conv.end;
  return {
    from,
    to,
    original: src.slice(from, to),
    replacement: `\\(${conv.math}\\)`,
    math: conv.math,
    kind: "wrap",
  };
}

/** A `.`, `?`, `!` or `;` followed by whitespace/end of line, but not `...` or `3.5`. */
function isSentenceEnd(src: string, p: number, lineEnd: number): boolean {
  const ch = src[p]!;
  if (!".?!;".includes(ch)) return false;
  const next = p + 1 < lineEnd ? src[p + 1]! : " ";
  if (!/\s/.test(next)) return false;
  if (ch === "." && (src[p - 1] === "." || src[p + 1] === ".")) return false;
  // "!" can be a factorial: "n! = 1" — only a sentence end if no operator follows.
  if (ch === "!" && /^\s*[=<>+*/-]/.test(src.slice(p + 1, lineEnd))) return false;
  return true;
}
