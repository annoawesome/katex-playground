import { describe, expect, it } from "vitest";
import {
  autoClose,
  backspacePair,
  CURSOR_MARK,
  duplicateLines,
  indent,
  insertSnippet,
  lineColAt,
  matchBracket,
  moveLines,
  outdent,
  smartNewline,
  toggleComment,
  wrapSelection,
  type EditState,
} from "./editing";

/**
 * Tests describe editor states as strings: `|` is the cursor, `[` … `]` a
 * selection. (Neither character appears in the test texts otherwise.)
 */
function parse(s: string): EditState {
  const sel = s.indexOf("[");
  if (sel !== -1) {
    const end = s.indexOf("]");
    return { text: s.slice(0, sel) + s.slice(sel + 1, end) + s.slice(end + 1), selStart: sel, selEnd: end - 1 };
  }
  const cur = s.indexOf("|");
  return { text: s.slice(0, cur) + s.slice(cur + 1), selStart: cur, selEnd: cur };
}

function show(st: EditState | null): string | null {
  if (!st) return null;
  const { text, selStart, selEnd } = st;
  if (selStart === selEnd) return text.slice(0, selStart) + "|" + text.slice(selStart);
  return text.slice(0, selStart) + "[" + text.slice(selStart, selEnd) + "]" + text.slice(selEnd);
}

describe("lineColAt", () => {
  it("is 1-based", () => {
    expect(lineColAt("ab\ncd", 0)).toEqual({ line: 1, col: 1 });
    expect(lineColAt("ab\ncd", 4)).toEqual({ line: 2, col: 2 });
  });
});

describe("indent / outdent", () => {
  it("inserts two spaces at the cursor", () => {
    expect(show(indent(parse("a|b")))).toBe("a  |b");
  });

  it("indents every selected line and keeps the selection", () => {
    expect(show(indent(parse("[a\nb]\nc")))).toBe("  [a\n  b]\nc");
  });

  it("does not indent a line the selection only touches at column 0", () => {
    expect(show(indent(parse("[a\n]b")))).toBe("  [a\n]b");
  });

  it("outdents by up to one level", () => {
    expect(show(outdent(parse("    [a\n b]")))).toBe("  [a\nb]");
    expect(show(outdent(parse("x|")))).toBe("x|");
  });
});

describe("toggleComment", () => {
  it("comments and uncomments a line", () => {
    const once = toggleComment(parse("  a|"));
    expect(show(once)).toBe("  % a|");
    expect(show(toggleComment(once))).toBe("  a|");
  });

  it("comments a block at its minimum indentation", () => {
    // The selection started at column 0, so it grows to cover the new "% ".
    expect(show(toggleComment(parse("[  a\n    b]")))).toBe("  [% a\n  %   b]");
  });

  it("uncomments only when every non-blank line is commented", () => {
    expect(show(toggleComment(parse("[% a\nb]")))).toBe("% [% a\n% b]");
  });
});

describe("wrapSelection / insertSnippet", () => {
  it("wraps a selection", () => {
    expect(show(wrapSelection(parse("x [bold] y"), "\\textbf{", "}"))).toBe("x \\textbf{[bold]} y");
  });

  it("inserts an empty pair at the cursor", () => {
    expect(show(wrapSelection(parse("x|"), "\\(", "\\)"))).toBe("x\\(|\\)");
  });

  it("places the cursor at the snippet marker and the selection inside it", () => {
    expect(show(insertSnippet(parse("|"), `\\frac{${CURSOR_MARK}}{}`))).toBe("\\frac{|}{}");
    expect(show(insertSnippet(parse("[a]"), `\\frac{${CURSOR_MARK}}{}`))).toBe("\\frac{a|}{}");
  });

  it("re-indents multi-line snippets", () => {
    expect(show(insertSnippet(parse("  |"), `\\begin{x}\n  ${CURSOR_MARK}\n\\end{x}`))).toBe(
      "  \\begin{x}\n    |\n  \\end{x}",
    );
  });
});

describe("autoClose", () => {
  it.each([
    ["|", "{", "{|}"],
    ["|", "[", "[|]"],
    ["|", "(", "(|)"],
    ["a |", "$", "a $|$"],
    ["\\|", "(", "\\(|\\)"],
    ["\\|", "[", "\\[|\\]"],
    ["\\|", "{", "\\{|\\}"],
  ])("%j + %s ⇒ %j", (before, ch, after) => {
    expect(show(autoClose(parse(before), ch))).toBe(after);
  });

  it("steps over a closer that is already there", () => {
    expect(show(autoClose(parse("{a|}"), "}"))).toBe("{a}|");
    expect(show(autoClose(parse("$x|$"), "$"))).toBe("$x$|");
  });

  it("wraps a selection", () => {
    expect(show(autoClose(parse("[x]"), "{"))).toBe("{[x]}");
    expect(show(autoClose(parse("\\[x]"), "("))).toBe("\\([x]\\)");
  });

  it("stays out of the way before a word, after \\$, and after a letter for $", () => {
    expect(autoClose(parse("|word"), "{")).toBeNull();
    expect(autoClose(parse("\\|"), "$")).toBeNull();
    expect(autoClose(parse("x|"), "$")).toBeNull();
    expect(autoClose(parse("|"), "a")).toBeNull();
  });
});

describe("backspacePair", () => {
  it("deletes both halves of an empty pair", () => {
    expect(show(backspacePair(parse("{|}")))).toBe("|");
    expect(show(backspacePair(parse("x\\(|\\)")))).toBe("x|");
    expect(show(backspacePair(parse("$|$")))).toBe("|");
  });

  it("does nothing otherwise", () => {
    expect(backspacePair(parse("{a|}"))).toBeNull();
    expect(backspacePair(parse("\\{|}"))).toBeNull();
    expect(backspacePair(parse("|"))).toBeNull();
  });
});

describe("smartNewline", () => {
  it("keeps indentation", () => {
    expect(show(smartNewline(parse("  abc|")))).toBe("  abc\n  |");
  });

  it("closes an environment and adds \\item for lists", () => {
    expect(show(smartNewline(parse("\\begin{proof}|")))).toBe("\\begin{proof}\n  |\n\\end{proof}");
    expect(show(smartNewline(parse("  \\begin{itemize}|")))).toBe("  \\begin{itemize}\n    \\item |\n  \\end{itemize}");
  });

  it("does not add a second \\end when one exists", () => {
    expect(show(smartNewline(parse("\\begin{proof}|\n\\end{proof}")))).toBe("\\begin{proof}\n  |\n\\end{proof}");
  });

  it("continues and ends \\item lists", () => {
    expect(show(smartNewline(parse("  \\item one|")))).toBe("  \\item one\n  \\item |");
    expect(show(smartNewline(parse("a\n  \\item |\nb")))).toBe("a\n|\nb");
  });

  it("opens an indented block between braces", () => {
    expect(show(smartNewline(parse("\\f{|}")))).toBe("\\f{\n  |\n}");
  });
});

describe("matchBracket", () => {
  it("matches braces in either direction", () => {
    expect(matchBracket("a{b{c}d}", 2)).toEqual([1, 7]);
    expect(matchBracket("a{b{c}d}", 8)).toEqual([1, 7]);
    expect(matchBracket("[x]", 0)).toEqual([0, 2]);
  });

  it("ignores escaped braces and unmatched ones", () => {
    expect(matchBracket("{\\}}", 1)).toEqual([0, 3]);
    expect(matchBracket("{abc", 1)).toBeNull();
    expect(matchBracket("abc", 1)).toBeNull();
  });
});

describe("moveLines / duplicateLines", () => {
  it("moves the current line up and down", () => {
    expect(show(moveLines(parse("a\nb|\nc"), -1))).toBe("b|\na\nc");
    expect(show(moveLines(parse("a\nb|\nc"), 1))).toBe("a\nc\nb|");
    expect(moveLines(parse("a|\nb"), -1)).toBeNull();
    expect(moveLines(parse("a\nb|"), 1)).toBeNull();
  });

  it("duplicates the selected lines", () => {
    expect(show(duplicateLines(parse("x|y\nz")))).toBe("xy\nx|y\nz");
  });
});
