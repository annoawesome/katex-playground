import { describe, expect, it } from "vitest";
import { asciiMathToLatex, lazyToLatex, suggestAt } from "./suggest";

const math = (s: string) => lazyToLatex(s)?.math ?? null;

describe("lazyToLatex", () => {
  it("converts the quantified-statement example from the spec", () => {
    expect(math("For all a in Z, a is even")).toBe("\\forall a \\in \\mathbb{Z}, a \\text{ is even}");
  });

  it("converts the implication example from the spec", () => {
    expect(math("x > y => x - y > 0")).toBe("x > y \\implies x - y > 0");
  });

  it.each([
    ["x <= y", "x \\leq y"],
    ["x >= y", "x \\geq y"],
    ["a != b", "a \\neq b"],
    ["p <=> q", "p \\iff q"],
    ["f: R -> R", "f: \\mathbb{R} \\to \\mathbb{R}"],
    ["x |-> x^2", "x \\mapsto x^2"],
    ["a +- b = c", "a \\pm b = c"],
    ["2 * 3 = 6", "2 \\cdot 3 = 6"],
    ["alpha + beta = pi", "\\alpha + \\beta = \\pi"],
    ["sin x <= 1", "\\sin x \\leq 1"],
    ["x not in A", "x \\notin A"],
    ["A subset of B", "A \\subseteq B"],
    ["x is less than or equal to y", "x \\leq y"],
    ["There exists n in N such that n > 5", "\\exists n \\in \\mathbb{N} \\text{ such that } n > 5"],
  ])("%s ⇒ %s", (input, expected) => {
    expect(math(input)).toBe(expected);
  });

  it("turns sqrt(…) and grouped exponents into braces", () => {
    expect(math("sqrt(x^2 + 1) >= x")).toBe("\\sqrt{x^2 + 1} \\geq x");
    expect(math("x^(n+1) > x^10")).toBe("x^{n+1} > x^{10}");
  });

  it("keeps leading English outside the math", () => {
    const r = lazyToLatex("Suppose x > 0");
    expect(r).toEqual({ math: "x > 0", start: 8, end: 13 });
  });

  it("keeps trailing English outside unless the statement is quantified", () => {
    expect(lazyToLatex("Let x >= 0 be given")).toMatchObject({ math: "x \\geq 0", start: 4, end: 10 });
    expect(math("For all x in R, x^2 is non negative")).toBe(
      "\\forall x \\in \\mathbb{R}, x^2 \\text{ is non negative}",
    );
  });

  it("treats a lone 'a' as an article before a noun, but a variable before 'is'", () => {
    expect(math("a is even and a > 2")).toBe("a \\text{ is even and } a > 2");
    expect(math("a number x > 2")).toBe("x > 2");
  });

  it("only reads 'in' as membership between operands", () => {
    expect(math("x in A")).toBe("x \\in A");
    expect(lazyToLatex("we did x in this case")).toBeNull();
  });

  it.each([
    "Hello world",
    "I think this is fine",
    "For each student, we count",
    "The meeting is at 5",
    "a number is even",
    "well-known results",
    "",
  ])("leaves ordinary prose alone: %j", (input) => {
    expect(lazyToLatex(input)).toBeNull();
  });

  it("refuses fragments with characters it doesn't understand", () => {
    expect(lazyToLatex('x > "y"')).toBeNull();
  });
});

describe("asciiMathToLatex", () => {
  it("replaces ASCII operators and names inside math", () => {
    expect(asciiMathToLatex("x <= y => alpha")).toBe("x \\leq y \\implies \\alpha");
    expect(asciiMathToLatex("x->0")).toBe("x \\to 0");
  });

  it("does not touch commands or text arguments", () => {
    expect(asciiMathToLatex("\\text{alpha => beta} + \\beta")).toBe("\\text{alpha => beta} + \\beta");
    expect(asciiMathToLatex("\\alpha \\leq \\pi")).toBe("\\alpha \\leq \\pi");
  });

  it("separates a converted name from a following letter", () => {
    expect(asciiMathToLatex("pix")).toBe("pix"); // not a Greek name as a whole word
    expect(asciiMathToLatex("sin x")).toBe("\\sin x");
  });

  it("returns the input unchanged when nothing applies", () => {
    expect(asciiMathToLatex("a^2 + b^2 = c^2")).toBe("a^2 + b^2 = c^2");
  });
});

describe("suggestAt", () => {
  it("suggests wrapping the clause around the cursor", () => {
    const src = "Intro. For all a in Z, a is even. More text.";
    const s = suggestAt(src, 20)!;
    expect(s.kind).toBe("wrap");
    expect(s.original).toBe("For all a in Z, a is even");
    expect(src.slice(s.from, s.to)).toBe(s.original);
    expect(s.replacement).toBe("\\(\\forall a \\in \\mathbb{Z}, a \\text{ is even}\\)");
  });

  it("still suggests right after the full stop that ends the clause", () => {
    const src = "Thus x >= 1.";
    expect(suggestAt(src, src.length)?.original).toBe("x >= 1");
  });

  it("only looks at the cursor's line", () => {
    const src = "x > y => z\n\nPlain words here";
    expect(suggestAt(src, src.length)).toBeNull();
    expect(suggestAt(src, 3)?.math).toBe("x > y \\implies z");
  });

  it("ignores text that already contains LaTeX", () => {
    expect(suggestAt("\\textbf{x > y}", 10)).toBeNull();
  });

  it("ignores comments", () => {
    expect(suggestAt("% x > y => z", 8)).toBeNull();
    expect(suggestAt("Fine. % x > y", 12)).toBeNull();
  });

  it("does not re-wrap existing math, but offers symbol fixes inside it", () => {
    const src = "We have $x <= y$ here";
    const s = suggestAt(src, 10)!;
    expect(s.kind).toBe("math");
    expect(src.slice(s.from, s.to)).toBe("x <= y");
    expect(s.replacement).toBe("x \\leq y");
  });

  it("splits clauses at math so it can suggest next to existing formulas", () => {
    const src = "Since $a$ holds, x >= 0 follows";
    const s = suggestAt(src, 20)!;
    expect(s.original).toBe("x >= 0");
  });

  it("returns null inside unterminated math", () => {
    expect(suggestAt("$x <= ", 5)).toBeNull();
  });
});
