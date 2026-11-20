/**
 * Keeps the preview pane on the part of the document being worked on. The
 * caret drives it; with "cursor-scroll", so does scrolling the editor. It only
 * moves when the caret reaches another block or the text changes, so scrolling
 * the preview by hand is left alone. Decisions live in `lib/sync.ts`.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { blockIndexAt, caretScrollTarget, scrollSyncTarget } from "../lib/sync";
import type { PreviewSync } from "../lib/storage";

/** Longer scrolls than this many viewports jump instead of animating. */
const MAX_SMOOTH_VIEWPORTS = 3;

interface Options {
  paneRef: RefObject<HTMLElement | null>;
  paperRef: RefObject<HTMLElement | null>;
  /** The caret's source offset. */
  caret: number;
  content: string;
  /** The text the preview currently shows; offsets are stale until it matches `content`. */
  renderedContent: string;
  mode: PreviewSync;
  /** Identifies the open document. */
  documentId: string;
  /** Re-runs the sync when the mobile view switches to the preview. */
  view: string;
}

const anchorsIn = (paper: HTMLElement) => paper.querySelectorAll<HTMLElement>(":scope > [data-src]");
const offsetOf = (el: HTMLElement) => Number(el.dataset.src);

/** The element's vertical extent in the pane's scrolling coordinates. */
function extentOf(el: HTMLElement, pane: HTMLElement) {
  const paneTop = pane.getBoundingClientRect().top;
  const r = el.getBoundingClientRect();
  return { top: r.top - paneTop + pane.scrollTop, bottom: r.bottom - paneTop + pane.scrollTop };
}

/** Returns the handler for editor scrolling (a source offset at the editor's top edge). */
export function usePreviewSync({ paneRef, paperRef, caret, content, renderedContent, mode, documentId, view }: Options) {
  const last = useRef<{ documentId: string; index: number; content: string } | null>(null);

  useEffect(() => {
    const pane = paneRef.current;
    const paper = paperRef.current;
    if (!pane || !paper || mode === "off") {
      last.current = null;
      return;
    }
    if (content !== renderedContent) return;
    // A hidden pane (the mobile source view) loses its scroll position, so
    // forget what was synced and sync afresh when it is shown.
    if (pane.clientHeight === 0) {
      last.current = null;
      return;
    }

    const anchors = anchorsIn(paper);
    const index = blockIndexAt(Array.from(anchors, offsetOf), caret);
    const prev = last.current?.documentId === documentId ? last.current : null;
    const edited = prev !== null && prev.content !== content;
    if (prev && prev.index === index && !edited) return;
    last.current = { documentId, index, content };

    let target: number | null;
    if (index === -1) {
      // Before the first block (the preamble): the top, once, not per keystroke.
      target = prev?.index === -1 ? null : 0;
    } else {
      const viewport = { scrollTop: pane.scrollTop, height: pane.clientHeight };
      target = caretScrollTarget(extentOf(anchors[index]!, pane), viewport, { edited: edited && prev.index === index });
    }
    if (target === null) return;

    const instant =
      !prev ||
      edited ||
      Math.abs(target - pane.scrollTop) > pane.clientHeight * MAX_SMOOTH_VIEWPORTS ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    pane.scrollTo({ top: target, behavior: instant ? "auto" : "smooth" });
  }, [paneRef, paperRef, caret, content, renderedContent, mode, documentId, view]);

  const latest = useRef({ content, renderedContent });
  latest.current = { content, renderedContent };

  return useCallback(
    (pos: number) => {
      const pane = paneRef.current;
      const paper = paperRef.current;
      if (!pane || !paper || latest.current.content !== latest.current.renderedContent) return;
      const anchors = anchorsIn(paper);
      const offsets = Array.from(anchors, offsetOf);
      const index = blockIndexAt(offsets, pos);
      if (index === -1 || (index === 0 && pos === offsets[0])) {
        pane.scrollTo({ top: 0 });
        return;
      }
      const next = anchors[index + 1];
      const top = scrollSyncTarget(
        pos,
        { offset: offsets[index]!, ...extentOf(anchors[index]!, pane) },
        next ? { offset: offsets[index + 1]!, top: extentOf(next, pane).top } : null,
        latest.current.content.length,
      );
      pane.scrollTo({ top });
    },
    [paneRef, paperRef],
  );
}
