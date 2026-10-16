/** A minimal accessible dropdown menu (button + popover list). */
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: ReactNode;
  onSelect(): void;
  /** Optional secondary text, right-aligned. */
  hint?: string;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
}

export type MenuEntry = MenuItem | "separator" | { heading: string };

interface Props {
  label: ReactNode;
  title?: string;
  items: MenuEntry[];
  align?: "left" | "right";
  className?: string;
}

export function Menu({ label, title, items, align = "left", className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Focus the first item for keyboard users.
    rootRef.current?.querySelector<HTMLButtonElement>(".menu-list button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Arrow-key navigation between items.
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>(".menu-list button:not(:disabled)") ?? [])];
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(idx + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <div className={`menu ${className}`} ref={rootRef}>
      <button
        type="button"
        className="menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div className={`menu-list align-${align}`} role="menu" onKeyDown={onListKey}>
          {items.map((it, i) => {
            if (it === "separator") return <hr key={i} />;
            if ("heading" in it) {
              return (
                <div key={i} className="menu-heading">
                  {it.heading}
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role={it.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={it.checked}
                className={`${it.danger ? "danger" : ""}${it.checked ? " checked" : ""}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                <span className="menu-label">{it.label}</span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
