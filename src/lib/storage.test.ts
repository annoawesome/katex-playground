import { describe, expect, it } from "vitest";
import {
  addDocument,
  createDocument,
  DEFAULT_PREFERENCES,
  defaultWorkspace,
  deleteDocument,
  loadPreferences,
  loadWorkspace,
  parsePreferences,
  parseWorkspace,
  PREFERENCES_KEY,
  renameDocument,
  savePreferences,
  saveWorkspace,
  uniqueName,
  updateDocumentContent,
  WORKSPACE_KEY,
  type StorageLike,
} from "./storage";
import { WELCOME_DOCUMENT } from "./welcome";

/** In-memory Storage for tests. */
function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("workspace persistence", () => {
  it("starts with the welcome document when storage is empty", () => {
    const ws = loadWorkspace(memoryStorage());
    expect(ws.documents).toHaveLength(1);
    expect(ws.documents[0]!.content).toBe(WELCOME_DOCUMENT);
    expect(ws.activeId).toBe(ws.documents[0]!.id);
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const ws = addDocument(defaultWorkspace(1), createDocument("Second", "x", 2));
    expect(saveWorkspace(storage, ws)).toEqual({ ok: true });
    expect(loadWorkspace(storage)).toEqual(ws);
  });

  it("falls back to the default on corrupt JSON", () => {
    const ws = loadWorkspace(memoryStorage({ [WORKSPACE_KEY]: "{not json" }));
    expect(ws.documents[0]!.name).toBe("Welcome");
  });

  it("works without storage at all", () => {
    expect(loadWorkspace(null).documents).toHaveLength(1);
    expect(saveWorkspace(null, defaultWorkspace())).toMatchObject({ ok: false });
  });

  it("reports a full storage as a readable error", () => {
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => {},
    };
    const res = saveWorkspace(full, defaultWorkspace());
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/full/i);
  });
});

describe("parseWorkspace", () => {
  const doc = { id: "a", name: "A", content: "", createdAt: 1, updatedAt: 1 };

  it("rejects wrong versions and shapes", () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace({ version: 2, documents: [doc], activeId: "a" })).toBeNull();
    expect(parseWorkspace({ version: 1, documents: [], activeId: "a" })).toBeNull();
  });

  it("drops malformed documents and repairs a dangling activeId", () => {
    const ws = parseWorkspace({ version: 1, documents: [{ id: 5 }, doc], activeId: "missing" });
    expect(ws).toEqual({ version: 1, documents: [doc], activeId: "a" });
  });
});

describe("workspace operations", () => {
  const base = () => {
    const a = { ...createDocument("A", "a", 1), id: "a" };
    const b = { ...createDocument("B", "b", 1), id: "b" };
    return { version: 1 as const, documents: [a, b], activeId: "a" };
  };

  it("updates content and timestamps only when changed", () => {
    const ws = base();
    expect(updateDocumentContent(ws, "a", "a", 9).documents[0]!.updatedAt).toBe(1);
    const next = updateDocumentContent(ws, "a", "new", 9);
    expect(next.documents[0]).toMatchObject({ content: "new", updatedAt: 9 });
    expect(ws.documents[0]!.content).toBe("a"); // not mutated
  });

  it("renames, normalising empty names", () => {
    expect(renameDocument(base(), "a", "  New  ").documents[0]!.name).toBe("New");
    expect(renameDocument(base(), "a", "   ").documents[0]!.name).toBe("Untitled");
    expect(renameDocument(base(), "a", "", 0, false).documents[0]!.name).toBe("");
  });

  it("deletes and picks a neighbour as the active document", () => {
    const ws = deleteDocument(base(), "a");
    expect(ws.documents.map((d) => d.id)).toEqual(["b"]);
    expect(ws.activeId).toBe("b");
  });

  it("never leaves the workspace empty", () => {
    const ws = deleteDocument(deleteDocument(base(), "a"), "b");
    expect(ws.documents).toHaveLength(1);
    expect(ws.activeId).toBe(ws.documents[0]!.id);
  });

  it("generates unique names", () => {
    const ws = base();
    expect(uniqueName(ws, "C")).toBe("C");
    expect(uniqueName(ws, "A")).toBe("A 2");
  });
});

describe("preferences", () => {
  it("defaults when missing or invalid", () => {
    expect(parsePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ theme: "neon", fontSize: "big", lineNumbers: "yes" })).toEqual(DEFAULT_PREFERENCES);
  });

  it("clamps numbers into range", () => {
    expect(parsePreferences({ fontSize: 99, splitRatio: -1 })).toMatchObject({ fontSize: 28, splitRatio: 0.2 });
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const prefs = { ...DEFAULT_PREFERENCES, theme: "dark" as const, lineNumbers: false };
    savePreferences(storage, prefs);
    expect(JSON.parse(storage.data.get(PREFERENCES_KEY)!)).toEqual(prefs);
    expect(loadPreferences(storage)).toEqual(prefs);
  });
});
