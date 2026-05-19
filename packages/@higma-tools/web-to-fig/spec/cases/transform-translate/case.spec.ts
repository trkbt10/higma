/**
 * @file Case `transform-translate` — `transform: matrix(1,0,0,1,tx,ty)`.
 *
 * Browser-side `getBoundingClientRect` already returns the post-
 * transform rect, so a normaliser that simply trusts `el.rect`
 * places the frame at the visually-correct position. The case
 * proves that contract: the resulting IR box equals the input rect
 * (which the fixture already shifted by (tx, ty)).
 *
 * If the normaliser ever starts adding the transform on top of the
 * already-transformed rect, this case catches the double-counting.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_BOX } from "../box-leaf/fixture";
import { DEFAULT_TX, DEFAULT_TY, withTranslate } from "./fixture";

describe("case transform-translate", () => {
  const frame = asFrame(singleChild(normalizeOne(withTranslate(baseDiv()))));

  it("places the frame at the post-transform position (no double-count)", () => {
    expect(Math.round(frame.box.x)).toBe(DEFAULT_BOX.x + DEFAULT_TX);
    expect(Math.round(frame.box.y)).toBe(DEFAULT_BOX.y + DEFAULT_TY);
  });

  it("preserves width and height (translate doesn't scale)", () => {
    expect(frame.box.width).toBe(DEFAULT_BOX.width);
    expect(frame.box.height).toBe(DEFAULT_BOX.height);
  });
});
