/**
 * Scroll positions for syncing the preview to the source.
 *
 * The renderer stamps each top-level block with its source offset (see
 * `sourceAnchors` in `render.ts`). `components/usePreviewSync.ts` reads those
 * offsets and measurements from the DOM; the decisions live here. Sync runs
 * one way, from source to preview, and is accurate to the block.
 */

/** A block's vertical extent, in the scrolling pane's content coordinates. */
export interface BlockExtent {
  top: number;
  bottom: number;
}

export interface Viewport {
  scrollTop: number;
  height: number;
}

/** How far down the viewport a block is placed when the preview scrolls to it. */
const PLACEMENT = 1 / 3;
/** Space left under a block that has grown past the bottom of the viewport. */
const REVEAL_MARGIN = 16;

/** Index of the last block starting at or before `pos`, or -1 if there is none. */
export function blockIndexAt(offsets: readonly number[], pos: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! <= pos) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Where the preview should scroll for the block holding the caret, or null to
 * stay put. `edited` means the block being typed in is the one already synced.
 */
export function caretScrollTarget(block: BlockExtent, viewport: Viewport, { edited = false } = {}): number | null {
  const viewTop = viewport.scrollTop;
  const viewBottom = viewTop + viewport.height;
  // Fully visible, or too tall to fit and already filling the view.
  if (block.top >= viewTop && block.bottom <= viewBottom) return null;
  if (block.top <= viewTop && block.bottom >= viewBottom) return null;
  // Grew past the bottom: scroll just enough, keeping its first line on screen.
  if (edited && block.top >= viewTop && block.top < viewBottom) {
    return Math.min(block.top, block.bottom - viewport.height + REVEAL_MARGIN);
  }
  return Math.max(0, block.top - viewport.height * PLACEMENT);
}

/**
 * Where the preview's top edge should be for the source position `pos`,
 * interpolated within the block so the preview doesn't jump block by block.
 * The block ends where `next` starts; the last block ends at `docEnd`.
 */
export function scrollSyncTarget(
  pos: number,
  block: BlockExtent & { offset: number },
  next: { offset: number; top: number } | null,
  docEnd: number,
): number {
  const endOffset = next ? next.offset : docEnd;
  const endTop = next ? next.top : block.bottom;
  const span = endOffset - block.offset;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (pos - block.offset) / span)) : 0;
  return Math.max(0, block.top + (endTop - block.top) * fraction);
}

/** The source offset at which each line starts. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** The last of `count` lines whose top is at or above `y`; line 0 if none is. */
export function lineAtTop(count: number, topOf: (line: number) => number, y: number): number {
  let lo = 0;
  let hi = count - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (topOf(mid) <= y) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
