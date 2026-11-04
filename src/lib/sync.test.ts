import { describe, expect, it } from "vitest";
import { blockIndexAt, caretScrollTarget, lineAtTop, lineStarts, scrollSyncTarget } from "./sync";

describe("blockIndexAt", () => {
  const offsets = [10, 20, 30];

  it("finds the last block starting at or before the position", () => {
    expect(blockIndexAt(offsets, 10)).toBe(0);
    expect(blockIndexAt(offsets, 19)).toBe(0);
    expect(blockIndexAt(offsets, 20)).toBe(1);
    expect(blockIndexAt(offsets, 999)).toBe(2);
  });

  it("returns -1 before the first block or with no blocks", () => {
    expect(blockIndexAt(offsets, 9)).toBe(-1);
    expect(blockIndexAt([], 5)).toBe(-1);
  });
});

describe("caretScrollTarget", () => {
  const viewport = { scrollTop: 1000, height: 600 };

  it("stays put when the block is fully visible", () => {
    expect(caretScrollTarget({ top: 1100, bottom: 1200 }, viewport)).toBeNull();
    expect(caretScrollTarget({ top: 1000, bottom: 1600 }, viewport)).toBeNull();
  });

  it("stays put when a tall block fills the view", () => {
    expect(caretScrollTarget({ top: 900, bottom: 1700 }, viewport)).toBeNull();
    expect(caretScrollTarget({ top: 900, bottom: 1700 }, viewport, { edited: true })).toBeNull();
  });

  it("places a block outside the view a third of the way down", () => {
    expect(caretScrollTarget({ top: 3000, bottom: 3100 }, viewport)).toBe(2800);
    expect(caretScrollTarget({ top: 500, bottom: 600 }, viewport)).toBe(300);
  });

  it("does the same for a partly visible block that wasn't being edited", () => {
    expect(caretScrollTarget({ top: 1500, bottom: 1700 }, viewport)).toBe(1300);
    expect(caretScrollTarget({ top: 900, bottom: 1100 }, viewport)).toBe(700);
  });

  it("doesn't scroll past the top of the document", () => {
    expect(caretScrollTarget({ top: 50, bottom: 100 }, viewport)).toBe(0);
  });

  it("scrolls just enough when the block being edited grows past the bottom", () => {
    expect(caretScrollTarget({ top: 1500, bottom: 1700 }, viewport, { edited: true })).toBe(1116);
  });

  it("keeps the first line of a growing block on screen", () => {
    expect(caretScrollTarget({ top: 1100, bottom: 2000 }, viewport, { edited: true })).toBe(1100);
  });

  it("brings back an edited block that is out of view", () => {
    expect(caretScrollTarget({ top: 3000, bottom: 3100 }, viewport, { edited: true })).toBe(2800);
  });
});

describe("scrollSyncTarget", () => {
  const block = { offset: 100, top: 1000, bottom: 1180 };

  it("interpolates between this block and the next", () => {
    const next = { offset: 200, top: 1200 };
    expect(scrollSyncTarget(100, block, next, 500)).toBe(1000);
    expect(scrollSyncTarget(150, block, next, 500)).toBe(1100);
  });

  it("ends the last block at its bottom and the end of the document", () => {
    expect(scrollSyncTarget(300, block, null, 500)).toBe(1090);
  });

  it("clamps out-of-range positions and survives an empty span", () => {
    expect(scrollSyncTarget(900, block, null, 500)).toBe(1180);
    expect(scrollSyncTarget(100, block, null, 100)).toBe(1000);
  });
});

describe("line mapping", () => {
  it("finds where each line starts", () => {
    expect(lineStarts("")).toEqual([0]);
    expect(lineStarts("ab\n\ncd\n")).toEqual([0, 3, 4, 7]);
  });

  it("finds the last line at or above a position", () => {
    const tops = [10, 30, 50, 90];
    const at = (y: number) => lineAtTop(tops.length, (l) => tops[l]!, y);
    expect(at(0)).toBe(0);
    expect(at(30)).toBe(1);
    expect(at(89)).toBe(2);
    expect(at(1000)).toBe(3);
  });
});
