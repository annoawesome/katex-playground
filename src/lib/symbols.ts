/**
 * Data for the symbol palette, the quick-symbol bar and the toolbar actions.
 *
 * Snippets use `‸` (CURSOR_MARK) to mark where the cursor lands after
 * insertion; any selected text is placed there too (see insertSnippet).
 */
import { CURSOR_MARK as C } from "./editing";

export interface PaletteItem {
  /** LaTeX inserted into the document (may contain the cursor mark). */
  insert: string;
  /** LaTeX used to draw the button with KaTeX. Defaults to `insert` without the mark. */
  preview?: string;
  /** Tooltip. */
  title: string;
  /** If true, the snippet only makes sense in math mode and is wrapped in \( \) elsewhere. */
  math: boolean;
}

export interface PaletteGroup {
  name: string;
  items: PaletteItem[];
}

const m = (insert: string, title: string, preview?: string): PaletteItem => ({ insert, title, preview, math: true });

export const PALETTE: PaletteGroup[] = [
  {
    name: "Logic",
    items: [
      m("\\forall ", "For all"),
      m("\\exists ", "There exists"),
      m("\\nexists ", "There does not exist"),
      m("\\neg ", "Not"),
      m("\\land ", "And"),
      m("\\lor ", "Or"),
      m("\\implies ", "Implies"),
      m("\\impliedby ", "Is implied by"),
      m("\\iff ", "If and only if"),
      m("\\therefore ", "Therefore"),
      m("\\because ", "Because"),
      m("\\top ", "True"),
      m("\\bot ", "False / contradiction"),
      m("\\vdash ", "Proves"),
      m("\\models ", "Models"),
    ],
  },
  {
    name: "Relations",
    items: [
      m("= ", "Equals", "="),
      m("\\neq ", "Not equal"),
      m("\\leq ", "Less than or equal"),
      m("\\geq ", "Greater than or equal"),
      m("< ", "Less than", "<"),
      m("> ", "Greater than", ">"),
      m("\\approx ", "Approximately"),
      m("\\equiv ", "Equivalent / congruent"),
      m("\\sim ", "Similar"),
      m("\\cong ", "Isomorphic"),
      m("\\propto ", "Proportional to"),
      m("\\mid ", "Divides"),
      m("\\perp ", "Perpendicular"),
      m("\\parallel ", "Parallel"),
      m("\\pmod{" + C + "}", "Modulo", "\\pmod{n}"),
    ],
  },
  {
    name: "Sets",
    items: [
      m("\\in ", "Element of"),
      m("\\notin ", "Not an element of"),
      m("\\subseteq ", "Subset"),
      m("\\subset ", "Proper subset"),
      m("\\supseteq ", "Superset"),
      m("\\cup ", "Union"),
      m("\\cap ", "Intersection"),
      m("\\setminus ", "Set difference"),
      m("\\emptyset", "Empty set"),
      m("\\mathbb{N}", "Natural numbers"),
      m("\\mathbb{Z}", "Integers"),
      m("\\mathbb{Q}", "Rationals"),
      m("\\mathbb{R}", "Reals"),
      m("\\mathbb{C}", "Complex numbers"),
      m("\\{" + C + "\\}", "Set braces", "\\{x\\}"),
      m("\\{ " + C + " \\mid  \\}", "Set-builder notation", "\\{x \\mid P\\}"),
      m("\\mathcal{P}(" + C + ")", "Power set", "\\mathcal{P}(A)"),
      m("^{c}", "Complement", "A^c"),
      m("\\times ", "Cartesian product"),
    ],
  },
  {
    name: "Operators",
    items: [
      m("\\frac{" + C + "}{}", "Fraction", "\\frac{a}{b}"),
      m("\\sqrt{" + C + "}", "Square root", "\\sqrt{x}"),
      m("\\sqrt[" + C + "]{}", "n-th root", "\\sqrt[n]{x}"),
      m("^{" + C + "}", "Superscript", "x^{n}"),
      m("_{" + C + "}", "Subscript", "x_{i}"),
      m("\\sum_{" + C + "}^{}", "Sum", "\\sum_{i=1}^{n}"),
      m("\\prod_{" + C + "}^{}", "Product", "\\prod_{i=1}^{n}"),
      m("\\int_{" + C + "}^{}", "Integral", "\\int_a^b"),
      m("\\oint ", "Contour integral"),
      m("\\lim_{" + C + " \\to }", "Limit", "\\lim_{x \\to a}"),
      m("\\pm ", "Plus-minus"),
      m("\\cdot ", "Dot product"),
      m("\\times ", "Times"),
      m("\\div ", "Divide"),
      m("\\circ ", "Composition"),
      m("\\infty", "Infinity"),
      m("\\partial ", "Partial derivative"),
      m("\\nabla ", "Nabla / gradient"),
      m("\\binom{" + C + "}{}", "Binomial", "\\binom{n}{k}"),
      m("\\left|" + C + "\\right|", "Absolute value", "|x|"),
      m("\\lfloor " + C + " \\rfloor", "Floor", "\\lfloor x \\rfloor"),
      m("\\lceil " + C + " \\rceil", "Ceiling", "\\lceil x \\rceil"),
      m("\\ldots", "Dots"),
    ],
  },
  {
    name: "Arrows",
    items: [
      m("\\to ", "To"),
      m("\\mapsto ", "Maps to"),
      m("\\leftarrow ", "Left arrow"),
      m("\\leftrightarrow ", "Left-right arrow"),
      m("\\Rightarrow ", "Double right arrow"),
      m("\\Leftarrow ", "Double left arrow"),
      m("\\Leftrightarrow ", "Double left-right arrow"),
      m("\\hookrightarrow ", "Injection"),
      m("\\twoheadrightarrow ", "Surjection"),
      m("\\uparrow ", "Up arrow"),
      m("\\downarrow ", "Down arrow"),
    ],
  },
  {
    name: "Greek",
    items: [
      "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "lambda",
      "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "phi", "varphi", "chi", "psi", "omega",
      "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega",
    ].map((g) => m(`\\${g} `, g)),
  },
  {
    name: "Accents & fonts",
    items: [
      m("\\hat{" + C + "}", "Hat", "\\hat{x}"),
      m("\\bar{" + C + "}", "Bar", "\\bar{x}"),
      m("\\overline{" + C + "}", "Overline", "\\overline{AB}"),
      m("\\vec{" + C + "}", "Vector", "\\vec{v}"),
      m("\\dot{" + C + "}", "Dot", "\\dot{x}"),
      m("\\tilde{" + C + "}", "Tilde", "\\tilde{x}"),
      m("\\mathbf{" + C + "}", "Bold", "\\mathbf{v}"),
      m("\\mathcal{" + C + "}", "Calligraphic", "\\mathcal{F}"),
      m("\\mathbb{" + C + "}", "Blackboard bold", "\\mathbb{K}"),
      m("\\mathrm{" + C + "}", "Roman", "\\mathrm{d}"),
      m("\\text{" + C + "}", "Text inside math", "\\text{abc}"),
    ],
  },
  {
    name: "Structures",
    items: [
      m(
        "\\begin{pmatrix}\n  " + C + " &  \\\\\n   & \n\\end{pmatrix}",
        "Matrix",
        "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
      ),
      m(
        "\\begin{cases}\n  " + C + " & \\text{if }  \\\\\n   & \\text{otherwise}\n\\end{cases}",
        "Cases",
        "\\begin{cases} a & x \\\\ b & y \\end{cases}",
      ),
      m("\\overbrace{" + C + "}^{}", "Overbrace", "\\overbrace{abc}^{n}"),
      m("\\underbrace{" + C + "}_{}", "Underbrace", "\\underbrace{abc}_{n}"),
    ],
  },
];

/** The always-visible row of the most common symbols. */
export const QUICK_SYMBOLS: PaletteItem[] = [
  "\\forall ", "\\exists ", "\\neg ", "\\land ", "\\lor ", "\\implies ", "\\iff ",
  "\\in ", "\\notin ", "\\subseteq ", "\\cup ", "\\cap ", "\\emptyset",
  "\\leq ", "\\geq ", "\\neq ", "\\approx ",
  "\\mathbb{N}", "\\mathbb{Z}", "\\mathbb{Q}", "\\mathbb{R}",
  "\\infty", "\\to ", "\\frac{" + C + "}{}", "\\sqrt{" + C + "}", "\\sum_{" + C + "}^{}",
].map((insert) => PALETTE.flatMap((g) => g.items).find((it) => it.insert === insert)!);

/** Toolbar actions: wrap the selection, or insert a block. */
export interface Action {
  id: string;
  label: string;
  title: string;
  /** Keyboard shortcut shown in the tooltip (handled by the editor). */
  shortcut?: string;
  kind: "wrap" | "snippet";
  before?: string;
  after?: string;
  snippet?: string;
}

export const ACTIONS: Action[] = [
  { id: "inline-math", label: "\\(x\\)", title: "Inline math", shortcut: "Mod+M", kind: "wrap", before: "\\(", after: "\\)" },
  { id: "display-math", label: "\\[x\\]", title: "Display math", shortcut: "Mod+Shift+M", kind: "wrap", before: "\\[ ", after: " \\]" },
  { id: "equation", label: "eq", title: "Numbered equation", kind: "snippet", snippet: `\\begin{equation}\n  ${C}\n\\end{equation}` },
  { id: "align", label: "align", title: "Aligned equations", kind: "snippet", snippet: `\\begin{align}\n  ${C} &=  \\\\\n   &= \n\\end{align}` },
  { id: "bold", label: "B", title: "Bold", shortcut: "Mod+B", kind: "wrap", before: "\\textbf{", after: "}" },
  { id: "italic", label: "I", title: "Italic", shortcut: "Mod+I", kind: "wrap", before: "\\textit{", after: "}" },
  { id: "section", label: "§", title: "Section", kind: "wrap", before: "\\section{", after: "}" },
  { id: "itemize", label: "•", title: "Bulleted list", kind: "snippet", snippet: `\\begin{itemize}\n  \\item ${C}\n\\end{itemize}` },
  { id: "enumerate", label: "1.", title: "Numbered list", kind: "snippet", snippet: `\\begin{enumerate}\n  \\item ${C}\n\\end{enumerate}` },
  { id: "theorem", label: "Thm", title: "Theorem", kind: "snippet", snippet: `\\begin{theorem}\n  ${C}\n\\end{theorem}` },
  { id: "proof", label: "Proof", title: "Proof", kind: "snippet", snippet: `\\begin{proof}\n  ${C}\n\\end{proof}` },
];
