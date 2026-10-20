import { describe, expect, it } from "vitest";
import { isInMath, lex, mathRangeAt } from "./lexer";

/** Token types with their text, for readable assertions. */
const tokens = (src: string) => lex(src).tokens.map((t) => [t.type, src.slice(t.start, t.end), t.math] as const);

describe("lex", () => {
  it("tokenizes commands, braces and text", () => {
    expect(tokens("\\textbf{hi}")).toEqual([
      ["command", "\\textbf", false],
      ["brace", "{", false],
      ["text", "hi", false],
      ["brace", "}", false],
    ]);
  });

  it("covers the whole input with contiguous tokens", () => {
    const src = "Hello $x^2$ % note\n\\begin{align} a &= b \\\\ \\end{align} \\% done";
    const toks = lex(src).tokens;
    let pos = 0;
    for (const t of toks) {
      expect(t.start).toBe(pos);
      expect(t.end).toBeGreaterThan(t.start);
      pos = t.end;
    }
    expect(pos).toBe(src.length);
  });

  it("recognises comments but not escaped percent signs", () => {
    expect(tokens("50\\% off % comment")).toEqual([
      ["text", "50", false],
      ["escape", "\\%", false],
      ["text", " off ", false],
      ["comment", "% comment", false],
    ]);
  });

  it("marks environment names", () => {
    const t = tokens("\\begin{itemize}");
    expect(t).toContainEqual(["env-name", "itemize", false]);
  });

  it("flags tokens inside $…$ as math", () => {
    const t = tokens("a $b$ c");
    expect(t).toEqual([
      ["text", "a ", false],
      ["math-delim", "$", true],
      ["text", "b", true],
      ["math-delim", "$", true],
      ["text", " c", false],
    ]);
  });

  it("distinguishes numbers only inside math", () => {
    expect(tokens("1 \\(2\\)").filter(([type]) => type === "number")).toEqual([["number", "2", true]]);
  });
});

describe("math ranges", () => {
  it("finds all four delimiter styles", () => {
    const src = "$a$ \\(b\\) $$c$$ \\[d\\]";
    const ranges = lex(src).mathRanges.map((r) => src.slice(r.contentStart, r.contentEnd));
    expect(ranges).toEqual(["a", "b", "c", "d"]);
  });

  it("treats math environments as math", () => {
    const src = "x \\begin{align*} y \\end{align*} z";
    const [r] = lex(src).mathRanges;
    expect(src.slice(r!.start, r!.end)).toBe("\\begin{align*} y \\end{align*}");
    expect(src.slice(r!.contentStart, r!.contentEnd)).toBe(" y ");
  });

  it("does not treat non-math environments as math", () => {
    expect(lex("\\begin{itemize} x \\end{itemize}").mathRanges).toEqual([]);
  });

  it("reports unterminated math", () => {
    const [r] = lex("text $x + y").mathRanges;
    expect(r!.unterminated).toBe(true);
    expect(r!.end).toBe(11);
  });

  it("ignores an escaped dollar", () => {
    expect(lex("costs \\$5").mathRanges).toEqual([]);
  });

  it("answers point queries", () => {
    const src = "ab $cd$ ef";
    expect(isInMath(src, 1)).toBe(false);
    expect(isInMath(src, 5)).toBe(true);
    // Right after the closing $ is outside math.
    expect(isInMath(src, 7)).toBe(false);
    expect(mathRangeAt(lex(src).mathRanges, 4)?.contentStart).toBe(4);
  });
});
