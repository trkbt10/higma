/**
 * @file Case `z-index-stacking` — IR child order must reflect the
 * CSS paint order, not the DOM source order. The fixture authors low
 * z-index first then high; the IR's last child should be the one
 * with the highest z-index.
 *
 * Today the normaliser ignores `z-index` entirely, so this case
 * fails — the IR keeps DOM order and the rendered Figma frame
 * paints in the wrong stacking order.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { overlappingSiblings } from "./fixture";

describe("case z-index-stacking", () => {
  const parent = asFrame(singleChild(normalizeOne(overlappingSiblings())));

  it("orders children by CSS paint order (highest z-index last)", () => {
    expect(parent.children).toHaveLength(2);
    // The high-z-index child has id `parent/high`.
    expect(parent.children[parent.children.length - 1]!.id).toBe("parent/high");
  });
});
