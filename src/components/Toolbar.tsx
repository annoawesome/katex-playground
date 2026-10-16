/**
 * The action row under the header: formatting actions on the left, then the
 * quick-symbol bar. Also exports `SymbolButton` and `texToHtml`, which the
 * full palette reuses.
 */
import katex from "katex";
import { ACTIONS, QUICK_SYMBOLS, type Action, type PaletteItem } from "../lib/symbols";
import { CURSOR_MARK } from "../lib/editing";

const previewCache = new Map<string, string>();

/** Renders a small piece of TeX for a button face (memoised, never throws). */
export function texToHtml(tex: string): string {
  let html = previewCache.get(tex);
  if (html === undefined) {
    html = katex.renderToString(tex, { throwOnError: false, output: "html" });
    previewCache.set(tex, html);
  }
  return html;
}

export function itemPreviewTex(item: PaletteItem): string {
  return item.preview ?? item.insert.replaceAll(CURSOR_MARK, "").trim();
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** "Mod+Shift+M" ⇒ "⌘⇧M" on macOS, "Ctrl+Shift+M" elsewhere. */
export const formatShortcut = (s: string) =>
  isMac
    ? s.replace(/Mod/g, "⌘").replace(/Shift/g, "⇧").replace(/Alt/g, "⌥").replace(/\+(?=\S)/g, "")
    : s.replace(/Mod/g, "Ctrl");

export function SymbolButton({ item, onInsert }: { item: PaletteItem; onInsert(item: PaletteItem): void }) {
  return (
    <button
      type="button"
      className="symbol-btn"
      title={`${item.title}  ${itemPreviewTex(item)}`}
      aria-label={item.title}
      // Don't steal focus from the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onInsert(item)}
      dangerouslySetInnerHTML={{ __html: texToHtml(itemPreviewTex(item)) }}
    />
  );
}

interface ToolbarProps {
  onAction(action: Action): void;
  onInsert(item: PaletteItem): void;
  showQuickSymbols: boolean;
  paletteOpen: boolean;
  onTogglePalette(): void;
}

export function Toolbar({ onAction, onInsert, showQuickSymbols, paletteOpen, onTogglePalette }: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <button
        type="button"
        className={`tool-btn palette-toggle${paletteOpen ? " on" : ""}`}
        aria-pressed={paletteOpen}
        title="Show all symbols"
        onClick={onTogglePalette}
      >
        Σ Symbols
      </button>
      <span className="toolbar-sep" />
      {ACTIONS.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`tool-btn action-${a.id}`}
          title={a.shortcut ? `${a.title} (${formatShortcut(a.shortcut)})` : a.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAction(a)}
        >
          {a.label}
        </button>
      ))}
      {showQuickSymbols && (
        <>
          <span className="toolbar-sep" />
          <div className="quick-symbols">
            {QUICK_SYMBOLS.map((item) => (
              <SymbolButton key={item.insert} item={item} onInsert={onInsert} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
