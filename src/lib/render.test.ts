import { describe, expect, it } from "vitest";
import { parseColumnSpec, renderDocument } from "./render";

const today = new Date(2026, 0, 2);
const render = (src: string) => renderDocument(src, { today });
const html = (src: string) => render(src).html;
/** Rendered HTML with each KaTeX output collapsed to `[K:tex]`, for readable assertions. */
function shape(src: string): string {
  const out = html(src);
  let result = "";
  let i = 0;
  for (;;) {
    const start = out.indexOf('<span class="katex', i);
    if (start === -1) return result + out.slice(i);
    // Walk to the matching </span> by counting nested spans.
    let depth = 0;
    let j = start;
    do {
      const open = out.indexOf("<span", j);
      const close = out.indexOf("</span>", j);
      if (open !== -1 && open < close) {
        depth++;
        j = open + 5;
      } else {
        depth--;
        j = close + 7;
      }
    } while (depth > 0);
    const tex = /<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/.exec(out.slice(start, j))![1]!;
    result += out.slice(i, start) + `[K:${tex.trim()}]`;
    i = j;
  }
}

describe("text", () => {
  it("wraps paragraphs separated by blank lines", () => {
    expect(html("one\ntwo\n\nthree")).toBe("<p>one two</p><p>three</p>");
  });

  it("escapes HTML in the source", () => {
    expect(html("<img src=x onerror=alert(1)>")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });

  it("strips comments, including the newline", () => {
    expect(html("a% comment\nb")).toBe("<p>ab</p>");
    expect(html("50\\% off")).toBe("<p>50% off</p>");
  });

  it("converts TeX ligatures and quotes", () => {
    expect(html("a--b---c ``q'' `s'")).toBe("<p>a–b—c “q” ‘s’</p>");
  });

  it("handles ties, line breaks and escapes", () => {
    expect(html("a~b\\\\c \\& \\{\\}")).toBe("<p>a&nbsp;b<br>c &amp; {}</p>");
  });

  it("applies text styling commands", () => {
    expect(html("\\textbf{b} \\textit{i} \\emph{e} \\texttt{t}")).toBe(
      '<p><strong>b</strong> <em>i</em> <em class="emph">e</em> <code>t</code></p>',
    );
  });

  it("swallows spaces after zero-argument commands, like TeX", () => {
    expect(html("\\LaTeX\\ is \\ldots fun")).toContain("</span> is …fun");
  });

  it("supports accents", () => {
    expect(html("caf\\'e na\\\"{i}ve")).toBe("<p>café naïve</p>");
  });

  it("only links safe URL schemes", () => {
    expect(html("\\href{https://a.b}{x}")).toBe(
      '<p><a href="https://a.b" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    expect(html("\\href{javascript:alert(1)}{x}")).toBe("<p>x</p>");
  });
});

describe("math", () => {
  it("renders all inline and display delimiters with KaTeX", () => {
    expect(shape("$a$ \\(b\\) $$c$$ \\[d\\]")).toBe("<p>[K:a] [K:b] [K:c] [K:d]</p>");
  });

  it("reports KaTeX errors with an offset into the source", () => {
    const r = render("ok $x^$");
    expect(r.diagnostics).toEqual([{ severity: "error", message: "Expected group after '^'", offset: 5 }]);
    expect(r.html).toContain('class="math-error"');
  });

  it("reports unclosed math without swallowing the rest of the document", () => {
    const r = render("a $b\n\nnext paragraph");
    expect(r.diagnostics[0]).toMatchObject({ severity: "error", offset: 2 });
    expect(r.html).toContain("<p>next paragraph</p>");
  });

  it("supports \\newcommand macros inside math", () => {
    const r = render("\\newcommand{\\R}{\\mathbb{R}}\n$x \\in \\R$");
    expect(r.diagnostics).toEqual([]);
    expect(r.html).toContain("mathbb");
  });

  it("supports macros with arguments and \\DeclareMathOperator", () => {
    const r = render("\\newcommand{\\sq}[1]{#1^2}\\DeclareMathOperator{\\rank}{rank}\n$\\sq{x} + \\rank A$");
    expect(r.diagnostics).toEqual([]);
  });

  it("numbers equations and resolves references", () => {
    const out = shape("\\begin{equation}a\\label{e:a}\\end{equation}\\begin{equation*}b\\end{equation*}See \\eqref{e:a}.");
    expect(out).toContain("[K:a\\tag{1}]");
    expect(out).toContain("[K:b]");
    expect(out).toContain('See (<span class="ref">1</span>).');
  });

  it("numbers align rows individually, honouring \\nonumber", () => {
    const out = shape("\\begin{align}a&=b\\\\c&=d\\nonumber\\\\e&=f\\label{x}\\end{align} \\ref{x}");
    expect(out).toContain("\\begin{align*}a&amp;=b \\tag{1}\\\\c&amp;=d\\\\e&amp;=f \\tag{2}\\end{align*}");
    expect(out).toContain('<span class="ref">2</span>');
  });

  it("warns about math commands used outside math", () => {
    const r = render("\\forall x");
    expect(r.diagnostics[0]!.message).toContain("math command");
    expect(r.html).toContain("implicit-math");
  });

  it("warns about superscripts outside math", () => {
    expect(render("x^2").diagnostics[0]!.message).toContain("math mode");
  });
});

describe("document structure", () => {
  it("renders only the document body and uses preamble metadata", () => {
    const src = [
      "\\documentclass{article}",
      "\\usepackage{amsmath}",
      "\\title{T}\\author{A \\and B}",
      "ignored preamble text",
      "\\begin{document}",
      "\\maketitle",
      "Body",
      "\\end{document}",
      "after end",
    ].join("\n");
    const r = render(src);
    expect(r.title).toBe("T");
    expect(r.html).toBe(
      '<header class="doc-title"><h1>T</h1><div class="doc-author">A <span class="author-sep"></span>B</div>' +
        '<div class="doc-date">January 2, 2026</div></header><p>Body</p>',
    );
  });

  it("hides the date when \\date{} is empty", () => {
    expect(html("\\date{}\\maketitle")).not.toContain("doc-date");
  });

  it("numbers sections hierarchically and skips starred ones", () => {
    const out = html("\\section{A}\\subsection{B}\\subsection*{C}\\section{D}\\subsection{E}");
    expect(out).toBe(
      '<h2 class="section"><span class="secnum">1</span>A</h2>' +
        '<h3 class="subsection"><span class="secnum">1.1</span>B</h3>' +
        '<h3 class="subsection">C</h3>' +
        '<h2 class="section"><span class="secnum">2</span>D</h2>' +
        '<h3 class="subsection"><span class="secnum">2.1</span>E</h3>',
    );
  });

  it("renders lists, including nested lists and custom labels", () => {
    expect(html("\\begin{itemize}\\item a \\item[*] b\\end{itemize}")).toBe(
      '<ul><li><p>a</p></li><li class="custom-label"><span class="item-label">*</span><p>b</p></li></ul>',
    );
    expect(html("\\begin{enumerate}\\item x\\begin{enumerate}\\item y\\end{enumerate}\\end{enumerate}")).toBe(
      "<ol><li><p>x</p><ol><li><p>y</p></li></ol></li></ol>",
    );
    expect(html("\\begin{description}\\item[Term] def\\end{description}")).toBe("<dl><dt>Term</dt><dd><p>def</p></dd></dl>");
  });

  it("numbers theorem-like environments with a shared counter", () => {
    const out = html("\\begin{theorem}[Name]\\label{t}A\\end{theorem}\\begin{lemma}B\\end{lemma}\\ref{t}");
    expect(out).toContain('<span class="thm-head">Theorem 1 <span class="thm-note">(Name)</span>.</span> A');
    expect(out).toContain('<span class="thm-head">Lemma 2.</span> B');
    expect(out).toContain('<span class="ref">1</span>');
  });

  it("ends proofs with a QED mark", () => {
    expect(html("\\begin{proof}Done.\\end{proof}")).toBe(
      '<div class="proof"><p><em class="proof-head">Proof.</em> Done.<span class="qed" aria-label="end of proof">∎</span></p></div>',
    );
  });

  it("collects footnotes at the end", () => {
    const out = html("Hi\\footnote{note}.");
    expect(out).toContain('<sup class="fn-ref"><a href="#fn-1">1</a></sup>');
    expect(out).toContain('<section class="footnotes"><ol><li id="fn-1">note</li></ol></section>');
  });

  it("renders verbatim text raw", () => {
    expect(html("\\begin{verbatim}\n$x$ \\foo <b>\n\\end{verbatim}")).toBe(
      '<pre class="verbatim">$x$ \\foo &lt;b&gt;</pre>',
    );
  });

  it("renders a basic tabular", () => {
    expect(html("\\begin{tabular}{lr}\\hline a & b \\\\ c & d \\\\ \\hline\\end{tabular}")).toBe(
      '<table class="tabular"><tbody><tr class="rule-top"><td class="align-l">a</td><td class="align-r">b</td></tr>' +
        '<tr class="rule-bottom"><td class="align-l">c</td><td class="align-r">d</td></tr></tbody></table>',
    );
  });

  it("emits page breaks for \\newpage", () => {
    expect(html("a\\newpage b")).toBe('<p>a</p><div class="page-break" aria-hidden="true"></div><p>b</p>');
  });
});

describe("diagnostics", () => {
  it("flags unknown commands and environments", () => {
    const r = render("\\frobnicate \\begin{weird}x\\end{weird}");
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      "Unknown command \\frobnicate",
      'Unknown environment "weird" — rendering its contents as plain text',
    ]);
  });

  it("flags undefined references", () => {
    const r = render("see \\ref{nope}");
    expect(r.diagnostics).toEqual([{ severity: "warning", message: 'Undefined reference "nope"', offset: 4 }]);
    expect(r.html).toContain("??");
  });

  it("flags unbalanced environments and braces", () => {
    expect(render("\\begin{itemize}\\item x").diagnostics[0]!.message).toBe("\\begin{itemize} is never closed");
    expect(render("\\end{quote}").diagnostics[0]!.message).toContain("without a matching");
    expect(render("a}").diagnostics[0]!.message).toBe("Unmatched }");
  });

  it("never throws on garbage input", () => {
    for (const src of ["\\", "{", "$", "\\begin{", "\\begin{align}", "\\item", "\\section", "}}}{{{", "\\\\\\\\", "$$$"]) {
      expect(() => render(src)).not.toThrow();
    }
  });

  it("sorts diagnostics by position", () => {
    const offsets = render("\\b $x^$ \\a").diagnostics.map((d) => d.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});

describe("parseColumnSpec", () => {
  it("extracts alignments and ignores rules and modifiers", () => {
    expect(parseColumnSpec("|l|c|r|")).toEqual(["l", "c", "r"]);
    expect(parseColumnSpec("p{3cm}@{}c")).toEqual(["l", "c"]);
  });
});
