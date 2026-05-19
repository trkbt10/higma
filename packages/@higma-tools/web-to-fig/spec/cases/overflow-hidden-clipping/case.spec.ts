/**
 * @file Case `overflow-hidden-clipping` — parent's `overflow: hidden`
 * sets `style.clipsContent: true`; the child's IR rect remains the
 * visual (un-clipped) size.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { OVERSIZED_CHILD_RECT, clippedParent } from "./fixture";

describe("case overflow-hidden-clipping", () => {
  const parent = asFrame(singleChild(normalizeOne(clippedParent())));

  it("parent has clipsContent = true", () => {
    expect(parent.style.clipsContent).toBe(true);
  });

  it("child IR rect carries the un-clipped visual size", () => {
    expect(parent.children).toHaveLength(1);
    const child = parent.children[0]!;
    // The child's box is parent-relative: (0, 0) origin, but full
    // un-clipped extent — the parent's clipsContent does the masking
    // at render time.
    expect(child.box.width).toBe(OVERSIZED_CHILD_RECT.width);
    expect(child.box.height).toBe(OVERSIZED_CHILD_RECT.height);
  });
});
