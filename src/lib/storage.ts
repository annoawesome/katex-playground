/**
 * Persistence in the browser's `localStorage`.
 *
 * Two independent records are stored:
 *
 *   katex-playground:workspace   → all documents + which one is open
 *   katex-playground:preferences → user preferences
 *
 * Everything that touches storage takes a `StorageLike` so tests can pass an
 * in-memory implementation. Reads are defensive: malformed or outdated data
 * never crashes the app, it falls back to defaults (keeping whatever valid
 * documents can be salvaged).
 */
import { WELCOME_DOCUMENT } from "./welcome";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const WORKSPACE_KEY = "katex-playground:workspace";
export const PREFERENCES_KEY = "katex-playground:preferences";

// ───────────────────────────────────────────────────────────── documents

export interface StoredDocument {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  version: 1;
  documents: StoredDocument[];
  activeId: string;
}

export function createId(): string {
  // crypto.randomUUID exists in all modern browsers (secure contexts) and Node.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDocument(name: string, content = "", now = Date.now()): StoredDocument {
  return { id: createId(), name, content, createdAt: now, updatedAt: now };
}

export function defaultWorkspace(now = Date.now()): Workspace {
  const doc = createDocument("Welcome", WELCOME_DOCUMENT, now);
  return { version: 1, documents: [doc], activeId: doc.id };
}

function isStoredDocument(x: unknown): x is StoredDocument {
  if (typeof x !== "object" || x === null) return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    typeof d.content === "string" &&
    typeof d.createdAt === "number" &&
    typeof d.updatedAt === "number"
  );
}

/** Validates arbitrary parsed JSON into a Workspace, or null if unusable. */
export function parseWorkspace(raw: unknown): Workspace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const w = raw as Record<string, unknown>;
  if (w.version !== 1 || !Array.isArray(w.documents)) return null;
  const documents = w.documents.filter(isStoredDocument);
  if (documents.length === 0) return null;
  const activeId =
    typeof w.activeId === "string" && documents.some((d) => d.id === w.activeId) ? w.activeId : documents[0]!.id;
  return { version: 1, documents, activeId };
}

export function loadWorkspace(storage: StorageLike | null): Workspace {
  if (!storage) return defaultWorkspace();
  try {
    const text = storage.getItem(WORKSPACE_KEY);
    if (text) {
      const ws = parseWorkspace(JSON.parse(text));
      if (ws) return ws;
    }
  } catch {
    // Corrupt JSON or storage access denied: fall through to the default.
  }
  return defaultWorkspace();
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export function saveWorkspace(storage: StorageLike | null, ws: Workspace): SaveResult {
  if (!storage) return { ok: false, error: "Browser storage is unavailable" };
  try {
    storage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
    return { ok: true };
  } catch (err) {
    // Most likely QuotaExceededError (localStorage is ~5 MB per site).
    const name = err instanceof Error ? err.name : "";
    return {
      ok: false,
      error: name === "QuotaExceededError" ? "Storage is full — export and delete some documents" : "Could not save",
    };
  }
}

// Pure workspace operations. They return new objects (React state friendly).

export function updateDocumentContent(ws: Workspace, id: string, content: string, now = Date.now()): Workspace {
  return {
    ...ws,
    documents: ws.documents.map((d) => (d.id === id && d.content !== content ? { ...d, content, updatedAt: now } : d)),
  };
}

/**
 * Renames a document. With `normalize` (the default) the name is trimmed and
 * an empty name becomes "Untitled"; the name field passes `false` while the
 * user is still typing so that clearing the field doesn't fight them.
 */
export function renameDocument(ws: Workspace, id: string, name: string, now = Date.now(), normalize = true): Workspace {
  const clean = normalize ? name.trim() || "Untitled" : name;
  return { ...ws, documents: ws.documents.map((d) => (d.id === id ? { ...d, name: clean, updatedAt: now } : d)) };
}

export function addDocument(ws: Workspace, doc: StoredDocument): Workspace {
  return { ...ws, documents: [...ws.documents, doc], activeId: doc.id };
}

/** Deletes a document. A workspace is never left empty. */
export function deleteDocument(ws: Workspace, id: string, now = Date.now()): Workspace {
  const idx = ws.documents.findIndex((d) => d.id === id);
  if (idx === -1) return ws;
  const documents = ws.documents.filter((d) => d.id !== id);
  if (documents.length === 0) {
    const fresh = createDocument("Untitled", "", now);
    return { ...ws, documents: [fresh], activeId: fresh.id };
  }
  const activeId = ws.activeId === id ? documents[Math.min(idx, documents.length - 1)]!.id : ws.activeId;
  return { ...ws, documents, activeId };
}

/** A name like "Untitled 3" that isn't used yet. */
export function uniqueName(ws: Workspace, base: string): string {
  const names = new Set(ws.documents.map((d) => d.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

// ───────────────────────────────────────────────────────────── preferences

export type ThemePreference = "system" | "light" | "dark";

export interface Preferences {
  theme: ThemePreference;
  /** Editor font size in px. */
  fontSize: number;
  lineNumbers: boolean;
  /** Auto-insert closing brackets, braces and `$`. */
  autoClose: boolean;
  /** Offer "lazy math" rewrites (see suggest.ts). */
  suggestions: boolean;
  /** Pop up command completions after typing `\`. */
  completions: boolean;
  /** Show the always-visible row of common symbols. */
  quickSymbols: boolean;
  /** Fraction of the width given to the editor pane (0.2–0.8). */
  splitRatio: number;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  theme: "system",
  fontSize: 14,
  lineNumbers: true,
  autoClose: true,
  suggestions: true,
  completions: true,
  quickSymbols: true,
  splitRatio: 0.5,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Merges stored data over defaults, ignoring anything of the wrong type. */
export function parsePreferences(raw: unknown): Preferences {
  const p: Preferences = { ...DEFAULT_PREFERENCES };
  if (typeof raw !== "object" || raw === null) return p;
  const r = raw as Record<string, unknown>;
  if (r.theme === "system" || r.theme === "light" || r.theme === "dark") p.theme = r.theme;
  if (typeof r.fontSize === "number" && Number.isFinite(r.fontSize)) p.fontSize = clamp(Math.round(r.fontSize), 10, 28);
  if (typeof r.splitRatio === "number" && Number.isFinite(r.splitRatio)) p.splitRatio = clamp(r.splitRatio, 0.2, 0.8);
  for (const key of ["lineNumbers", "autoClose", "suggestions", "completions", "quickSymbols"] as const) {
    if (typeof r[key] === "boolean") p[key] = r[key];
  }
  return p;
}

export function loadPreferences(storage: StorageLike | null): Preferences {
  try {
    const text = storage?.getItem(PREFERENCES_KEY);
    return parsePreferences(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(storage: StorageLike | null, prefs: Preferences): void {
  try {
    storage?.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a nicety; failing to save them is not worth surfacing.
  }
}

/** `window.localStorage`, or null when unavailable (privacy modes, SSR, tests). */
export function browserStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage;
    // Accessing localStorage can throw in some sandboxed iframes.
    s.getItem(WORKSPACE_KEY);
    return s;
  } catch {
    return null;
  }
}
