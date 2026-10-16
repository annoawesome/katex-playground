/** Preferences, in a native modal <dialog>. Changes apply (and save) immediately. */
import { useEffect, useRef } from "react";
import type { Preferences, ThemePreference } from "../lib/storage";
import { formatShortcut } from "./Toolbar";

interface Props {
  open: boolean;
  prefs: Preferences;
  onChange(prefs: Preferences): void;
  onClose(): void;
  storageBytes: number;
}

const THEMES: Array<[ThemePreference, string]> = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

const TOGGLES: Array<[keyof Preferences, string, string]> = [
  ["lineNumbers", "Line numbers", "Show line numbers in the editor gutter."],
  ["autoClose", "Auto-close brackets", "Insert the closing }, ], ) or $ automatically."],
  ["completions", "Command completion", "Suggest commands after typing a backslash."],
  ["suggestions", "Lazy-math suggestions", "Offer to convert plain text like “x >= 0” into LaTeX."],
  ["quickSymbols", "Quick symbol bar", "Show common symbols in the toolbar."],
];

const SHORTCUTS: Array<[string, string]> = [
  ["Mod+B / Mod+I", "Bold / italic"],
  ["Mod+M", "Inline math \\( \\)"],
  ["Mod+Shift+M", "Display math \\[ \\]"],
  ["Mod+/", "Toggle comment"],
  ["Tab / Shift+Tab", "Indent / outdent"],
  ["Alt+↑ / Alt+↓", "Move line"],
  ["Shift+Alt+↓", "Duplicate line"],
  ["Alt+Enter", "Accept suggestion"],
];

export function PreferencesDialog({ open, prefs, onChange, onClose, storageBytes }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => onChange({ ...prefs, [key]: value });

  return (
    <dialog
      ref={ref}
      className="prefs"
      onClose={onClose}
      // Clicking the backdrop closes the dialog.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="prefs-title"
    >
      <div className="prefs-content">
        <header>
          <h2 id="prefs-title">Preferences</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close preferences">
            ×
          </button>
        </header>

        <fieldset>
          <legend>Theme</legend>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map(([value, label]) => (
              <label key={value} className={prefs.theme === value ? "on" : ""}>
                <input type="radio" name="theme" value={value} checked={prefs.theme === value} onChange={() => set("theme", value)} />
                {label}
              </label>
            ))}
          </div>
          <p className="hint">“System” follows your operating system’s light/dark setting.</p>
        </fieldset>

        <fieldset>
          <legend>Editor</legend>
          <label className="row">
            <span>Font size</span>
            <input
              type="range"
              min={10}
              max={28}
              value={prefs.fontSize}
              onChange={(e) => set("fontSize", Number(e.target.value))}
            />
            <output>{prefs.fontSize}px</output>
          </label>
          {TOGGLES.map(([key, label, hint]) => (
            <label key={key} className="row toggle">
              <span>
                {label}
                <small>{hint}</small>
              </span>
              <input type="checkbox" checked={prefs[key] as boolean} onChange={(e) => set(key, e.target.checked as never)} />
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Keyboard shortcuts</legend>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}>
                <dt>
                  <kbd>{formatShortcut(keys)}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </fieldset>

        <p className="hint">
          Documents are stored only in this browser ({(storageBytes / 1024).toFixed(1)} KB used). Clearing site data
          deletes them, so export anything important.
        </p>
      </div>
    </dialog>
  );
}
