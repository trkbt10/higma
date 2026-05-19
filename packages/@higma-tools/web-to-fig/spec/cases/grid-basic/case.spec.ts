/**
 * @file Case `grid-basic` — `display: grid` produces a frame whose
 * children retain the right positions. Whether the IR carries a
 * grid-aware layout descriptor or just absolute-positioned children
 * is acceptable, but the geometry must survive.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { COL_WIDTH, GAP, ROW_HEIGHT, twoColumnGrid } from "./fixture";

describe("case grid-basic", () => {
  const parent = asFrame(singleChild(normalizeOne(twoColumnGrid())));

  it("preserves all 4 children", () => {
    expect(parent.children).toHaveLength(4);
  });

  it("children retain their grid-cell positions (parent-relative)", () => {
    const expected = [
      { x: 0, y: 0 },
      { x: COL_WIDTH + GAP, y: 0 },
      { x: 0, y: ROW_HEIGHT + GAP },
      { x: COL_WIDTH + GAP, y: ROW_HEIGHT + GAP },
    ];
    parent.children.forEach((child, i) => {
      expect(child.box.x).toBe(expected[i]!.x);
      expect(child.box.y).toBe(expected[i]!.y);
      expect(child.box.width).toBe(COL_WIDTH);
      expect(child.box.height).toBe(ROW_HEIGHT);
    });
  });
});
