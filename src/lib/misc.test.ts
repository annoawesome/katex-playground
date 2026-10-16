/** Tests for the small helper modules: completions, theme, exporting, symbols. */
import { describe, expect, it } from "vitest";
import { COMPLETIONS, completionContext, filterCompletions } from "./completions";
import { resolveTheme } from "./theme";
import { sanitizeFilename, withExtension } from "./exporting";
import { ACTIONS, PALETTE, QUICK_SYMBOLS } from "./symbols";
import katex from "katex";
import { CURSOR_MARK } from "./editing";

describe("completionContext", () => {
  it("finds a command being typed", () => {
    expect(completionContext("x \\fra", 6)).toEqual({ from: 2, prefix: "fra" });
  });

  it("ignores a bare backslash, escaped backslashes and plain words", () => {
    expect(completionContext("x \\", 3)).toBeNull();
    expect(completionContext("\\\\fra", 5)).toBeNull();
    expect(completionContext("fra", 3)).toBeNull();
  });
});

describe("filterCompletions", () => {
  it("ranks prefix matches by length", () => {
    const labels = filterCompletions("sub").map((c) => c.label);
    expect(labels[0]).toBe("\\subset");
    expect(labels).toContain("\\subsection");
  });

  it("prefers case-sensitive matches", () => {
    expect(filterCompletions("Delta")[0]!.label).toBe("\\Delta");
    expect(filterCompletions("delta")[0]!.label).toBe("\\delta");
  });

  it("matches environments by name", () => {
    expect(filterCompletions("itemize").map((c) => c.label)).toContain("\\begin{itemize}");
  });

  it("respects the limit", () => {
    expect(filterCompletions("a", 3)).toHaveLength(3);
  });
});

describe("resolveTheme", () => {
  it("follows the system only when asked to", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("file names", () => {
  it("removes characters that are illegal in file names", () => {
    expect(sanitizeFilename('My: "Notes"/v2?')).toBe("My Notesv2");
    expect(sanitizeFilename("Café")).toBe("Cafe");
    expect(sanitizeFilename("  ...  ")).toBe("document");
  });

  it("adds an extension once", () => {
    expect(withExtension("Notes", "tex")).toBe("Notes.tex");
    expect(withExtension("notes.TEX", "tex")).toBe("notes.TEX");
  });
});

describe("symbol data", () => {
  const allItems = PALETTE.flatMap((g) => g.items);

  it("every palette preview is valid KaTeX", () => {
    for (const item of allItems) {
      const tex = item.preview ?? item.insert.replaceAll(CURSOR_MARK, "");
      expect(() => katex.renderToString(tex, { throwOnError: true }), tex).not.toThrow();
    }
  });

  it("every palette insert is valid KaTeX once the cursor mark is filled in", () => {
    for (const item of allItems) {
      const tex = item.insert.replaceAll(CURSOR_MARK, "x").replace(/\{\}/g, "{y}");
      expect(() => katex.renderToString(tex, { throwOnError: true }), tex).not.toThrow();
    }
  });

  it("quick symbols all exist in the palette", () => {
    expect(QUICK_SYMBOLS.every(Boolean)).toBe(true);
  });

  it("actions are well-formed", () => {
    for (const a of ACTIONS) {
      if (a.kind === "wrap") expect(a.before && a.after).toBeTruthy();
      else expect(a.snippet).toContain(CURSOR_MARK);
    }
  });

  it("completion labels start with a backslash", () => {
    expect(COMPLETIONS.every((c) => c.label.startsWith("\\"))).toBe(true);
  });
});
