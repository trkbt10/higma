/** @file Tests for editor layout bounds operations. */
import {
  layoutBoundsBottom,
  layoutBoundsRight,
  layoutBoundsTouchOrOverlap,
  resolveLayoutBoundsIntersection,
} from "./layout-bounds";

describe("layout bounds operations", () => {
  it("resolves right and bottom edges from the bounds SoT", () => {
    const bounds = { x: 8, y: 13, width: 21, height: 34 };

    expect(layoutBoundsRight(bounds)).toBe(29);
    expect(layoutBoundsBottom(bounds)).toBe(47);
  });

  it("treats edge contact as visible for hit-area culling", () => {
    expect(layoutBoundsTouchOrOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 10, width: 4, height: 4 },
    )).toBe(true);
  });

  it("requires positive area for render-surface clipping", () => {
    expect(resolveLayoutBoundsIntersection(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 10, width: 4, height: 4 },
    )).toBeUndefined();

    expect(resolveLayoutBoundsIntersection(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 4, y: 6, width: 10, height: 10 },
    )).toEqual({ x: 4, y: 6, width: 6, height: 4 });
  });
});
