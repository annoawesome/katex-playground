/** The full symbol palette, shown as a collapsible side panel. */
import { useMemo, useState } from "react";
import { PALETTE, type PaletteItem } from "../lib/symbols";
import { SymbolButton, itemPreviewTex } from "./Toolbar";

export function Palette({ onInsert, onClose }: { onInsert(item: PaletteItem): void; onClose(): void }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PALETTE;
    return PALETTE.map((g) => ({
      ...g,
      items: g.items.filter((it) => it.title.toLowerCase().includes(q) || itemPreviewTex(it).toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <aside className="palette" aria-label="Symbol palette">
      <div className="palette-head">
        <input
          type="search"
          placeholder="Search symbols…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search symbols"
        />
        <button type="button" className="icon-btn" onClick={onClose} title="Close palette" aria-label="Close palette">
          ×
        </button>
      </div>
      <div className="palette-body">
        {groups.map((g) => (
          <section key={g.name}>
            <h3>{g.name}</h3>
            <div className="palette-grid">
              {g.items.map((item) => (
                <SymbolButton key={`${g.name}-${item.insert}`} item={item} onInsert={onInsert} />
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="muted">No symbols match “{query}”.</p>}
      </div>
    </aside>
  );
}
