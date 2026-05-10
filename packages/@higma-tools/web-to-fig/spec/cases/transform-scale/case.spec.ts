/**
 * @file Case `transform-scale` — `scale(s)` survives end-to-end.
 *
 * The IR is allowed to carry the scale either by:
 *   (a) inflating the box dimensions to the visual bbox (Figma
 *       paints children un-grown but the parent's effective size is
 *       the visual size), OR
 *   (b) keeping the box at the layout size and surfacing the scale
 *       through a separate `transform` field.
 *
 * The contract: SOME representation must reflect the scale. A
 * normaliser that drops both falls through this `||` and the case
 * fails.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_BOX } from "../box-leaf/fixture";
import { DEFAULT_SCALE, withScale } from "./fixture";

describe("case transform-scale", () => {
  const frame = asFrame(singleChild(normalizeOne(withScale(baseDiv()))));

  it("preserves the scale via box dimensions or an explicit transform", () => {
    const dimsAreScaled =
      Math.abs(frame.box.width - DEFAULT_BOX.width * DEFAULT_SCALE) < 0.01
      && Math.abs(frame.box.height - DEFAULT_BOX.height * DEFAULT_SCALE) < 0.01;
    const irCarriesTransform =
      Object.prototype.hasOwnProperty.call(frame, "transform")
      || Object.prototype.hasOwnProperty.call(frame.style, "transform");
    expect(dimsAreScaled || irCarriesTransform).toBe(true);
  });
});
