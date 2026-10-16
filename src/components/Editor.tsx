/**
 * The source editor: a dependency-free code editor for LaTeX.
 *
 * How it works
 * ────────────
 * A transparent <textarea> sits exactly on top of a <pre> that renders the
 * same text with syntax-highlighting spans. The textarea owns all input,
 * selection, IME, spell-check, accessibility and — importantly — the native
 * undo/redo stack; the <pre> is purely visual. Both use identical font,
 * padding and wrapping rules so every character lines up.
 *
 * The <pre> draws one <div> per logical line. That lets CSS counters draw
 * line numbers in a gutter that stays aligned with soft-wrapped lines, and
 * lets us tint the line containing the cursor.
 *
 * The textarea has no scrollbar of its own: it is sized to the <pre>'s
 * height and the *wrapper* scrolls, so the two layers can never drift apart.
 *
 * Programmatic edits (auto-closing brackets, snippets, accepting a
 * suggestion…) go through `applyEdit`, which uses `execCommand("insertText")`
 * so that they are undoable with Ctrl/Cmd+Z like normal typing.
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { lex } from "../lib/lexer";
import { highlightLines } from "../lib/highlight";
import {
  autoClose,
  backspacePair,
  CURSOR_MARK,
  duplicateLines,
  indent,
  insertSnippet,
  matchBracket,
  moveLines,
  outdent,
  smartNewline,
  toggleComment,
  wrapSelection,
  type EditState,
} from "../lib/editing";
import { completionContext, filterCompletions, type Completion } from "../lib/completions";
import type { Preferences } from "../lib/storage";

export interface EditorHandle {
  focus(): void;
  /** Inserts a snippet (with optional cursor mark) at the selection. */
  insert(snippet: string, opts?: { math?: boolean }): void;
  /** Wraps the selection in `before` … `after`. */
  wrap(before: string, after: string): void;
  /** Replaces `[from, to)` with `text` (undoable). */
  replaceRange(from: number, to: number, text: string): void;
  /** Moves the cursor to `offset` and scrolls it into view. */
  jumpTo(offset: number): void;
}

interface EditorProps {
  value: string;
  onChange(value: string): void;
  /** Reports the cursor (selection start) whenever it moves. */
  onCursorChange(pos: number, selectionEnd: number): void;
  prefs: Preferences;
  /** Called on Alt+Enter; return true if a suggestion was applied. */
  onAcceptSuggestion(): boolean;
  /** Called on Escape when no popup is open; return true if handled. */
  onDismissSuggestion(): boolean;
  /** Whether the cursor is in math mode (used to wrap math-only inserts). */
  isMathAt(pos: number): boolean;
  ref?: Ref<EditorHandle>;
}

interface CompletionState {
  from: number;
  items: Completion[];
  index: number;
  /** Popup position relative to the editor's scroll content. */
  top: number;
  left: number;
}

export function Editor({ value, onChange, onCursorChange, prefs, onAcceptSuggestion, onDismissSuggestion, isMathAt, ref }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  // Set when an edit wants the caret scrolled into view after the next render.
  const revealCaret = useRef(false);

  // ── Highlighting. Lexing is memoised on the text; the per-line HTML is
  // rebuilt when brackets to emphasise change (cheap).
  const tokens = useMemo(() => lex(value).tokens, [value]);
  const marks = useMemo(() => {
    if (selection.start !== selection.end) return undefined;
    const pair = matchBracket(value, selection.start);
    return pair ? new Set(pair) : undefined;
  }, [value, selection.start, selection.end]);
  const lines = useMemo(() => highlightLines(value, tokens, { marks }), [value, tokens, marks]);
  const activeLine = useMemo(() => {
    let n = 0;
    for (let i = 0; i < selection.start; i++) if (value.charCodeAt(i) === 10) n++;
    return n;
  }, [value, selection.start]);
  const html = useMemo(
    () =>
      lines
        // An empty line still needs content to have height.
        .map((l, i) => `<div class="ln${i === activeLine ? " active" : ""}">${l || " "}</div>`)
        .join(""),
    [lines, activeLine],
  );

  // ── Applying programmatic edits in an undoable way.
  const applyEdit = useCallback((next: EditState) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const prev = ta.value;
    if (next.text !== prev) {
      // Replace only the changed middle part, so undo restores precisely.
      let start = 0;
      while (start < prev.length && start < next.text.length && prev[start] === next.text[start]) start++;
      let endPrev = prev.length;
      let endNext = next.text.length;
      while (endPrev > start && endNext > start && prev[endPrev - 1] === next.text[endNext - 1]) {
        endPrev--;
        endNext--;
      }
      const inserted = next.text.slice(start, endNext);
      ta.focus();
      ta.setSelectionRange(start, endPrev);
      // execCommand is deprecated but remains the only way to edit a textarea
      // while preserving the browser's undo stack. Fall back if unsupported.
      const ok = inserted === "" ? document.execCommand("delete") : document.execCommand("insertText", false, inserted);
      if (!ok || ta.value !== next.text) {
        ta.value = next.text;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    ta.setSelectionRange(next.selStart, next.selEnd);
    setSelection({ start: next.selStart, end: next.selEnd });
    revealCaret.current = true;
  }, []);

  const currentState = (): EditState => {
    const ta = textareaRef.current!;
    return { text: ta.value, selStart: ta.selectionStart, selEnd: ta.selectionEnd };
  };

  // Clicking/keyboard-navigating changes the selection.
  const syncSelection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    setSelection((s) => (s.start === ta.selectionStart && s.end === ta.selectionEnd ? s : { start: ta.selectionStart, end: ta.selectionEnd }));
  }, []);

  useEffect(() => {
    onCursorChange(selection.start, selection.end);
  }, [selection.start, selection.end, onCursorChange]);

  // ── Caret geometry, measured on the highlighted <pre> (same layout as the
  // textarea), via a DOM Range on the right text node.
  const caretRect = useCallback((pos: number): { top: number; bottom: number; left: number } | null => {
    const pre = preRef.current;
    const scroller = scrollRef.current;
    if (!pre || !scroller) return null;
    const text = textareaRef.current?.value ?? "";
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    let line = 0;
    for (let i = 0; i < lineStart; i++) if (text.charCodeAt(i) === 10) line++;
    const div = pre.children[line] as HTMLElement | undefined;
    if (!div) return null;
    const base = scroller.getBoundingClientRect();
    const toLocal = (r: DOMRect) => ({
      top: r.top - base.top + scroller.scrollTop,
      bottom: r.bottom - base.top + scroller.scrollTop,
      left: r.left - base.left + scroller.scrollLeft,
    });

    let col = pos - lineStart;
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const len = node.textContent?.length ?? 0;
      if (col <= len) {
        const range = document.createRange();
        range.setStart(node, col);
        range.setEnd(node, col);
        const rects = range.getClientRects();
        const r = rects[rects.length - 1] ?? range.getBoundingClientRect();
        if (r.height > 0) return toLocal(r);
        break;
      }
      col -= len;
    }
    const r = div.getBoundingClientRect();
    const padLeft = parseFloat(getComputedStyle(div).paddingLeft) || 0;
    return { ...toLocal(r), left: toLocal(r).left + padLeft, bottom: toLocal(r).top + parseFloat(getComputedStyle(div).lineHeight || "20") };
  }, []);

  /** Scrolls the editor so the caret (selection end) is visible. */
  const ensureCaretVisible = useCallback(() => {
    const scroller = scrollRef.current;
    const ta = textareaRef.current;
    if (!scroller || !ta) return;
    const rect = caretRect(ta.selectionEnd);
    if (!rect) return;
    const margin = 24;
    if (rect.top < scroller.scrollTop + margin) scroller.scrollTop = Math.max(0, rect.top - margin);
    else if (rect.bottom > scroller.scrollTop + scroller.clientHeight - margin)
      scroller.scrollTop = rect.bottom - scroller.clientHeight + margin;
  }, [caretRect]);

  // After any render caused by an edit, keep the caret on screen.
  useLayoutEffect(() => {
    if (!revealCaret.current) return;
    revealCaret.current = false;
    ensureCaretVisible();
  });

  // When the editor gets shorter (e.g. the suggestion strip appears below
  // it, or the window is resized) don't let the caret end up hidden.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    let lastHeight = scroller.clientHeight;
    const ro = new ResizeObserver(() => {
      if (scroller.clientHeight < lastHeight && document.activeElement === textareaRef.current) ensureCaretVisible();
      lastHeight = scroller.clientHeight;
    });
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [ensureCaretVisible]);

  // ── Completions. The popup's position is measured in a layout effect,
  // after React has rendered the new text into the highlight layer.
  const updateCompletions = useCallback(
    (text: string, caret: number) => {
      if (!prefs.completions) return setCompletion(null);
      const ctx = completionContext(text, caret);
      const items = ctx ? filterCompletions(ctx.prefix) : [];
      // Nothing to offer, or the only match is exactly what was typed.
      if (!ctx || items.length === 0 || (items.length === 1 && items[0]!.insert === `\\${ctx.prefix}`)) {
        return setCompletion(null);
      }
      setCompletion((prev) => ({
        from: ctx.from,
        items,
        index: prev && prev.from === ctx.from ? Math.min(prev.index, items.length - 1) : 0,
        top: prev?.top ?? 0,
        left: prev?.left ?? 0,
      }));
    },
    [prefs.completions],
  );

  useLayoutEffect(() => {
    if (!completion) return;
    const r = caretRect(completion.from);
    if (r && (r.bottom + 2 !== completion.top || r.left !== completion.left)) {
      setCompletion({ ...completion, top: r.bottom + 2, left: r.left });
    }
  }, [completion, caretRect]);

  const acceptCompletion = useCallback(
    (c: Completion) => {
      // Remove the typed `\prefix`, then insert the snippet where it was.
      // (Passing the prefix as a "selection" would put it inside the snippet.)
      const st = currentState();
      const from = completion!.from;
      const withoutPrefix = st.text.slice(0, from) + st.text.slice(st.selStart);
      applyEdit(insertSnippet({ text: withoutPrefix, selStart: from, selEnd: from }, c.insert));
      setCompletion(null);
    },
    [applyEdit, completion],
  );

  // ── Imperative API used by the toolbar, palette and suggestion bar.
  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus(),
      insert(snippet, opts) {
        const st = currentState();
        if (opts?.math && !isMathAt(st.selStart)) {
          // A math symbol typed in text mode: wrap it in \( … \) and leave the
          // cursor inside, so the user can keep writing the formula.
          const body = snippet.includes(CURSOR_MARK) ? snippet : snippet + CURSOR_MARK;
          snippet = `\\(${body}\\)`;
        }
        applyEdit(insertSnippet(st, snippet));
      },
      wrap(before, after) {
        applyEdit(wrapSelection(currentState(), before, after));
      },
      replaceRange(from, to, text) {
        const st = currentState();
        const pos = from + text.length;
        applyEdit({ text: st.text.slice(0, from) + text + st.text.slice(to), selStart: pos, selEnd: pos });
      },
      jumpTo(offset) {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(offset, offset);
        setSelection({ start: offset, end: offset });
        revealCaret.current = true;
      },
    }),
    [applyEdit, isMathAt],
  );

  // ── Keyboard handling.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // never interfere with IME input
    const mod = e.metaKey || e.ctrlKey;
    const run = (next: EditState | null) => {
      if (!next) return false;
      e.preventDefault();
      applyEdit(next);
      return true;
    };

    if (completion) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const n = completion.items.length;
        setCompletion({ ...completion, index: (completion.index + delta + n) % n });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptCompletion(completion.items[completion.index]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCompletion(null);
        return;
      }
    }

    if (e.key === "Enter" && e.altKey) {
      if (onAcceptSuggestion()) e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      if (onDismissSuggestion()) e.preventDefault();
      return;
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      run(e.shiftKey ? outdent(currentState()) : indent(currentState()));
      return;
    }
    if (e.key === "Enter" && !mod && !e.shiftKey) {
      run(smartNewline(currentState()));
      return;
    }
    if (e.key === "Backspace" && !mod && !e.altKey && prefs.autoClose) {
      run(backspacePair(currentState()));
      return;
    }
    if (e.altKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const st = currentState();
      if (e.shiftKey) run(duplicateLines(st));
      else run(moveLines(st, e.key === "ArrowUp" ? -1 : 1));
      if (!e.defaultPrevented) e.preventDefault();
      return;
    }
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "/") return void run(toggleComment(currentState()));
      if (key === "b" && !e.shiftKey) return void run(wrapSelection(currentState(), "\\textbf{", "}"));
      if (key === "i" && !e.shiftKey) return void run(wrapSelection(currentState(), "\\textit{", "}"));
      if (key === "m") {
        return void run(e.shiftKey ? wrapSelection(currentState(), "\\[ ", " \\]") : wrapSelection(currentState(), "\\(", "\\)"));
      }
      return;
    }
    if (prefs.autoClose && e.key.length === 1 && "{[($}])".includes(e.key) && !mod) {
      run(autoClose(currentState(), e.key));
    }
  };

  const onChangeText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    onChange(ta.value);
    setSelection({ start: ta.selectionStart, end: ta.selectionEnd });
    revealCaret.current = true;
    updateCompletions(ta.value, ta.selectionStart);
  };

  // Close completions when the caret leaves the command being typed.
  useEffect(() => {
    if (!completion) return;
    const ctx = completionContext(value, selection.start);
    if (!ctx || ctx.from !== completion.from || selection.start !== selection.end) setCompletion(null);
  }, [completion, value, selection.start, selection.end]);

  const style = {
    "--editor-font-size": `${prefs.fontSize}px`,
  } as React.CSSProperties;

  return (
    <div className={`editor${prefs.lineNumbers ? " with-gutter" : ""}`} style={style}>
      <div className="editor-scroll" ref={scrollRef}>
        <div className="editor-inner">
          <pre className="editor-highlight" ref={preRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
          <textarea
            ref={textareaRef}
            className="editor-input"
            value={value}
            onChange={onChangeText}
            onKeyDown={onKeyDown}
            onSelect={syncSelection}
            onBlur={() => setCompletion(null)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label="LaTeX source"
            aria-autocomplete="list"
            aria-expanded={completion !== null}
            aria-controls="completion-list"
          />
          {completion && (
            <ul
              id="completion-list"
              className="completions"
              role="listbox"
              style={{ top: completion.top, left: completion.left }}
              // Keep focus in the textarea when clicking an item.
              onMouseDown={(e) => e.preventDefault()}
            >
              {completion.items.map((c, i) => (
                <li
                  key={`${c.label}-${c.insert}`}
                  role="option"
                  aria-selected={i === completion.index}
                  className={i === completion.index ? "selected" : ""}
                  onMouseEnter={() => setCompletion({ ...completion, index: i })}
                  onClick={() => acceptCompletion(c)}
                >
                  <code>{c.label}</code>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
