/**
 * @file Pin the `characterStyleIDs` post-normalise contract.
 *
 * Pre-fix: a stored `characterStyleIDs` length other than
 * `characters.length` threw `text-runs: characterStyleIDs length X ≠
 * characters length Y`, breaking emit on real-world Figma files
 * whose Kiwi encoding omits trailing zeros (the documented base-style
 * suffix) and on files that carry authoring residue (style ids
 * beyond an erased text tail). Post-fix: the routine pads with 0
 * (base style) when shorter and truncates when longer, mirroring the
 * SVG renderer's own post-normalise expectation.
 */
import { normaliseCharacterStyleIDs } from "./text-runs";

describe("normaliseCharacterStyleIDs", () => {
  it("returns the same array when lengths already agree", () => {
    const input = [1, 1, 2, 2] as const;
    const out = normaliseCharacterStyleIDs(input, 4);
    expect(out).toEqual([1, 1, 2, 2]);
    // Identity preserved so the fast path doesn't allocate.
    expect(out).toBe(input);
  });

  it("pads with 0 when the stored array is shorter than characters (trailing-zero Kiwi omission)", () => {
    const out = normaliseCharacterStyleIDs([1, 1, 2], 6);
    expect(out).toEqual([1, 1, 2, 0, 0, 0]);
  });

  it("truncates when the stored array is longer than characters (authoring residue past an erased tail)", () => {
    const out = normaliseCharacterStyleIDs([1, 1, 2, 2, 3, 3], 4);
    expect(out).toEqual([1, 1, 2, 2]);
  });

  it("handles zero-length characters by returning an empty array", () => {
    const out = normaliseCharacterStyleIDs([1, 2, 3], 0);
    expect(out).toEqual([]);
  });

  it("handles an empty raw array by padding to length with zeros", () => {
    const out = normaliseCharacterStyleIDs([], 3);
    expect(out).toEqual([0, 0, 0]);
  });
});
