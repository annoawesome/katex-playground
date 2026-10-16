/**
 * Application shell: owns all state and wires the pieces together.
 *
 *   ┌ header ─ name · documents ▾ ─────────────── export ▾ · ⚙ ┐
 *   ├ toolbar ─ actions · quick symbols ─────────────────────────┤
 *   │ [palette] │ editor (+ suggestion card) ┃ preview          │
 *   └ status ─ Ln/Col · words · issues ───────────── saved ─────┘
 *
 * State lives here and flows down; the editor is controlled (its text is the
 * active document's content) but exposes an imperative handle for inserting
 * snippets so that those edits stay on the browser's undo stack.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Editor, type EditorHandle } from "./components/Editor";
import { Toolbar, formatShortcut } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { SuggestionBar } from "./components/SuggestionBar";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { Menu, type MenuEntry } from "./components/Menu";
import { lex, mathRangeAt } from "./lib/lexer";
import { renderDocument } from "./lib/render";
import { suggestAt, type Suggestion } from "./lib/suggest";
import { lineColAt } from "./lib/editing";
import { applyTheme, DARK_QUERY, resolveTheme, systemPrefersDark } from "./lib/theme";
import { downloadText, printToPdf, withExtension } from "./lib/exporting";
import type { Action, PaletteItem } from "./lib/symbols";
import {
  addDocument,
  browserStorage,
  createDocument,
  deleteDocument,
  loadPreferences,
  loadWorkspace,
  parseWorkspace,
  renameDocument,
  savePreferences,
  saveWorkspace,
  uniqueName,
  updateDocumentContent,
  WORKSPACE_KEY,
  type Preferences,
  type Workspace,
} from "./lib/storage";

const storage = browserStorage();
/** How long the cursor must rest before a lazy-math suggestion appears. */
const SUGGEST_DELAY_MS = 450;
/** Debounce for writing to localStorage while typing. */
const SAVE_DELAY_MS = 300;

type SaveStatus = { kind: "saved" } | { kind: "pending" } | { kind: "error"; message: string };

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace(storage));
  const [prefs, setPrefs] = useState<Preferences>(() => loadPreferences(storage));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [cursor, setCursor] = useState({ start: 0, end: 0 });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "saved" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"source" | "preview">("source");

  const editorRef = useRef<EditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const active = workspace.documents.find((d) => d.id === workspace.activeId) ?? workspace.documents[0]!;
  const content = active.content;

  // ── Theme: follow the OS live when the preference is "system".
  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY);
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const theme = resolveTheme(prefs.theme, systemDark);
  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => savePreferences(storage, prefs), [prefs]);

  // ── Persistence: debounced save, flushed when the page is hidden/closed.
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;
  // Set when a change came from another tab, so we don't echo it back.
  const skipNextSave = useRef(false);

  const flushSave = useCallback(() => {
    const result = saveWorkspace(storage, latestWorkspace.current);
    setSaveStatus(result.ok ? { kind: "saved" } : { kind: "error", message: result.error });
  }, []);

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    setSaveStatus({ kind: "pending" });
    const t = setTimeout(flushSave, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [workspace, flushSave]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushSave]);

  // Another tab saved: adopt its documents but keep our open document.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== WORKSPACE_KEY || !e.newValue) return;
      try {
        const incoming = parseWorkspace(JSON.parse(e.newValue));
        if (!incoming) return;
        skipNextSave.current = true;
        setWorkspace((prev) => ({
          ...incoming,
          activeId: incoming.documents.some((d) => d.id === prev.activeId) ? prev.activeId : incoming.activeId,
        }));
      } catch {
        // Ignore malformed data from elsewhere.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Rendering. useDeferredValue keeps typing responsive on big documents:
  // React renders the preview at lower priority than the keystroke.
  const deferredContent = useDeferredValue(content);
  const rendered = useMemo(() => renderDocument(deferredContent), [deferredContent]);
  const mathRanges = useMemo(() => lex(content).mathRanges, [content]);
  const isMathAt = useCallback((pos: number) => mathRangeAt(mathRanges, pos) !== null, [mathRanges]);

  // ── Lazy-math suggestions, computed once the cursor rests.
  useEffect(() => {
    setSuggestion(null);
    if (!prefs.suggestions || cursor.start !== cursor.end) return;
    const t = setTimeout(() => {
      const s = suggestAt(content, cursor.start, mathRanges);
      if (s && !dismissed.has(`${s.original}\u0000${s.replacement}`)) setSuggestion(s);
    }, SUGGEST_DELAY_MS);
    return () => clearTimeout(t);
  }, [content, cursor.start, cursor.end, mathRanges, prefs.suggestions, dismissed]);

  const applySuggestion = useCallback((): boolean => {
    if (!suggestion) return false;
    // Guard against a stale suggestion whose text has since changed.
    if (content.slice(suggestion.from, suggestion.to) !== suggestion.original) {
      setSuggestion(null);
      return false;
    }
    editorRef.current?.replaceRange(suggestion.from, suggestion.to, suggestion.replacement);
    setSuggestion(null);
    return true;
  }, [suggestion, content]);

  const dismissSuggestion = useCallback((): boolean => {
    if (!suggestion) return false;
    setDismissed((d) => new Set(d).add(`${suggestion.original}\u0000${suggestion.replacement}`));
    setSuggestion(null);
    return true;
  }, [suggestion]);

  // ── Document operations.
  const setContent = useCallback(
    (text: string) => setWorkspace((ws) => updateDocumentContent(ws, ws.activeId, text)),
    [],
  );
  const onCursorChange = useCallback((start: number, end: number) => setCursor({ start, end }), []);

  const newDocument = () => {
    setWorkspace((ws) => addDocument(ws, createDocument(uniqueName(ws, "Untitled"), NEW_DOCUMENT_TEMPLATE)));
  };
  const duplicateDocument = () => {
    setWorkspace((ws) => addDocument(ws, createDocument(uniqueName(ws, `${active.name} copy`), active.content)));
  };
  const removeDocument = () => {
    if (window.confirm(`Delete “${active.name}”? This cannot be undone.`)) {
      setWorkspace((ws) => deleteDocument(ws, ws.activeId));
    }
  };
  const openFile = async (file: File) => {
    const text = await file.text();
    const name = file.name.replace(/\.(tex|txt|latex)$/i, "") || "Imported";
    setWorkspace((ws) => addDocument(ws, createDocument(uniqueName(ws, name), text)));
  };
  const exportTex = () => downloadText(withExtension(active.name, "tex"), content);
  const exportPdf = () => {
    // Make sure the preview reflects the latest text before printing.
    flushSave();
    printToPdf(active.name);
  };

  // ── Toolbar / palette insertion.
  const onAction = (a: Action) => {
    if (a.kind === "wrap") editorRef.current?.wrap(a.before!, a.after!);
    else editorRef.current?.insert(a.snippet!);
  };
  const onInsert = (item: PaletteItem) => editorRef.current?.insert(item.insert, { math: item.math });

  // ── Global shortcuts: Mod+S (we autosave; just confirm) and Mod+P (print).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        flushSave();
      } else if (key === "p") {
        e.preventDefault();
        printToPdf(latestWorkspace.current.documents.find((d) => d.id === latestWorkspace.current.activeId)?.name ?? "document");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushSave]);

  // ── Resizable split between editor and preview.
  const startResize = (e: React.PointerEvent) => {
    const main = mainRef.current;
    if (!main) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const panes = main.querySelector<HTMLElement>(".panes")!;
    const move = (ev: PointerEvent) => {
      const r = panes.getBoundingClientRect();
      const ratio = Math.min(0.8, Math.max(0.2, (ev.clientX - r.left) / r.width));
      setPrefs((p) => ({ ...p, splitRatio: ratio }));
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };
  const onDividerKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
    if (!step) return;
    e.preventDefault();
    setPrefs((p) => ({ ...p, splitRatio: Math.min(0.8, Math.max(0.2, p.splitRatio + step)) }));
  };

  // ── Derived status-bar info.
  const { line, col } = lineColAt(content, cursor.start);
  const words = useMemo(
    () => deferredContent.replace(/%[^\n]*|\\[A-Za-z]+\*?|[{}[\]$\\&^_]/g, " ").split(/\s+/).filter(Boolean).length,
    [deferredContent],
  );
  const errors = rendered.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = rendered.diagnostics.length - errors;
  const storageBytes = useMemo(() => JSON.stringify(workspace).length * 2, [workspace]);

  const documentsMenu: MenuEntry[] = [
    { heading: "Documents" },
    ...[...workspace.documents]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((d) => ({
        label: d.name,
        hint: relativeTime(d.updatedAt),
        checked: d.id === workspace.activeId,
        onSelect: () => setWorkspace((ws) => ({ ...ws, activeId: d.id })),
      })),
    "separator",
    { label: "New document", onSelect: newDocument },
    { label: "Open .tex file…", onSelect: () => fileInputRef.current?.click() },
    { label: "Duplicate", onSelect: duplicateDocument },
    { label: "Delete…", onSelect: removeDocument, danger: true },
  ];

  const exportMenu: MenuEntry[] = [
    { label: "PDF…", hint: formatShortcut("Mod+P"), onSelect: exportPdf },
    { label: "LaTeX source (.tex)", onSelect: exportTex },
    { label: "Copy source", onSelect: () => void navigator.clipboard?.writeText(content) },
  ];

  const editorWidth = `${(prefs.splitRatio * 100).toFixed(2)}%`;

  return (
    <div className={`app view-${mobileView}`}>
      <header className="app-header">
        <div className="brand" aria-label="Katex Playground">
          <span className="logo" aria-hidden="true">
            ∑
          </span>
          <span className="brand-name">Katex Playground</span>
        </div>
        <input
          className="doc-name"
          value={active.name}
          onChange={(e) => setWorkspace((ws) => renameDocument(ws, ws.activeId, e.target.value, Date.now(), false))}
          onBlur={(e) => setWorkspace((ws) => renameDocument(ws, ws.activeId, e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") editorRef.current?.focus();
          }}
          aria-label="Document name"
          spellCheck={false}
        />
        <Menu label="Documents ▾" title="Switch, create, open or delete documents" items={documentsMenu} />
        <div className="header-spacer" />
        <div className="view-switch segmented" role="tablist" aria-label="View">
          {(["source", "preview"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={mobileView === v} className={mobileView === v ? "on" : ""} onClick={() => setMobileView(v)}>
              {v === "source" ? "Source" : "Preview"}
            </button>
          ))}
        </div>
        <Menu label="Export ▾" title="Export as PDF or LaTeX" items={exportMenu} align="right" />
        <button type="button" className="icon-btn" title="Preferences" aria-label="Preferences" onClick={() => setPrefsOpen(true)}>
          ⚙
        </button>
      </header>

      <Toolbar
        onAction={onAction}
        onInsert={onInsert}
        showQuickSymbols={prefs.quickSymbols}
        paletteOpen={paletteOpen}
        onTogglePalette={() => setPaletteOpen((o) => !o)}
      />

      <div className="main" ref={mainRef}>
        {paletteOpen && <Palette onInsert={onInsert} onClose={() => setPaletteOpen(false)} />}
        <div className="panes">
          <section className="pane source-pane" style={{ flexBasis: editorWidth }} aria-label="Source">
            <Editor
              key={active.id}
              ref={editorRef}
              value={content}
              onChange={setContent}
              onCursorChange={onCursorChange}
              prefs={prefs}
              onAcceptSuggestion={applySuggestion}
              onDismissSuggestion={dismissSuggestion}
              isMathAt={isMathAt}
            />
            {suggestion && <SuggestionBar suggestion={suggestion} onApply={applySuggestion} onDismiss={dismissSuggestion} />}
          </section>
          <div
            className="divider"
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(prefs.splitRatio * 100)}
            aria-valuemin={20}
            aria-valuemax={80}
            aria-label="Resize editor and preview"
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={onDividerKey}
            onDoubleClick={() => setPrefs((p) => ({ ...p, splitRatio: 0.5 }))}
          />
          <section className="pane preview-pane" aria-label="Preview">
            <article className="paper" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          </section>
        </div>
      </div>

      <footer className="status-bar">
        <span>
          Ln {line}, Col {col}
        </span>
        <span>{words.toLocaleString()} words</span>
        <div className="issues">
          <button
            type="button"
            className={`issues-btn${errors ? " has-errors" : warnings ? " has-warnings" : ""}`}
            onClick={() => setIssuesOpen((o) => !o)}
            disabled={rendered.diagnostics.length === 0}
            aria-expanded={issuesOpen}
          >
            {rendered.diagnostics.length === 0
              ? "✓ No issues"
              : `${errors ? `${errors} error${errors > 1 ? "s" : ""}` : ""}${errors && warnings ? ", " : ""}${warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : ""}`}
          </button>
          {issuesOpen && rendered.diagnostics.length > 0 && (
            <ul className="issues-list">
              {rendered.diagnostics.map((d, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={d.severity}
                    onClick={() => {
                      setIssuesOpen(false);
                      setMobileView("source");
                      editorRef.current?.jumpTo(d.offset);
                    }}
                  >
                    <span className="issue-loc">Ln {lineColAt(deferredContent, d.offset).line}</span>
                    {d.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="header-spacer" />
        <span className={`save-status ${saveStatus.kind}`} title="Documents are saved in this browser">
          {saveStatus.kind === "saved" ? "Saved locally" : saveStatus.kind === "pending" ? "Saving…" : saveStatus.message}
        </span>
      </footer>

      <PreferencesDialog open={prefsOpen} prefs={prefs} onChange={setPrefs} onClose={() => setPrefsOpen(false)} storageBytes={storageBytes} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".tex,.latex,.txt,text/plain,application/x-tex"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const NEW_DOCUMENT_TEMPLATE = String.raw`\documentclass{article}
\title{Untitled}
\author{}

\begin{document}
\maketitle

\section{Introduction}


\end{document}
`;

/** "just now", "5 min ago", "3 h ago", or a date. */
function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
