import { describe, expect, it } from "vitest";
import { escapeHtml, highlightLines } from "./highlight";
import { lex } from "./lexer";

const hl = (src: string, marks?: Set<number>) => highlightLines(src, lex(src).tokens, { marks });

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("highlightLines", () => {
  it("returns one entry per source line", () => {
    for (const src of ["", "a", "a\nb", "a\n", "\n\n\n", "$x\ny$\n%c"]) {
      expect(hl(src)).toHaveLength(src.split("\n").length);
    }
  });

  it("wraps tokens in classed spans and leaves plain text bare", () => {
    expect(hl("hi \\emph{x}")).toEqual([
      'hi <span class="t-cmd">\\emph</span><span class="t-brace">{</span>x<span class="t-brace">}</span>',
    ]);
  });

  it("adds the math class inside math", () => {
    expect(hl("$x$")[0]).toBe('<span class="t-delim m">$</span><span class="m">x</span><span class="t-delim m">$</span>');
  });

  it("splits multi-line tokens so each line is self-contained", () => {
    const lines = hl("$a\nb$");
    expect(lines[0]).toBe('<span class="t-delim m">$</span><span class="m">a</span>');
    expect(lines[1]).toBe('<span class="m">b</span><span class="t-delim m">$</span>');
  });

  it("escapes user text", () => {
    expect(hl("<script>")[0]).toBe("&lt;script&gt;");
  });

  it("marks matching brackets", () => {
    expect(hl("{a}", new Set([0, 2]))[0]).toBe(
      '<span class="t-brace t-match">{</span>a<span class="t-brace t-match">}</span>',
    );
  });
});
