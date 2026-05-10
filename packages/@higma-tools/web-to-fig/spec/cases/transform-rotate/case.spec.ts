/**
 * @file Case `transform-rotate` — `rotate(deg)` survives end-to-end.
 *
 * Either the IR carries the rotation angle in some form, or it
 * exposes a transform field on the node. Plain "rect verbatim,
 * forget the matrix" loses the rotation entirely and produces a
 * non-rotated AABB-sized rectangle.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { withRotate } from "./fixture";

describe("case transform-rotate", () => {
  const frame = asFrame(singleChild(normalizeOne(withRotate(baseDiv()))));

  it("carries the rotation in the IR (transform field or rotation property)", () => {
    const carriesTransform =
      Object.prototype.hasOwnProperty.call(frame, "transform")
      || Object.prototype.hasOwnProperty.call(frame.style, "transform")
      || Object.prototype.hasOwnProperty.call(frame, "rotation");
    expect(carriesTransform).toBe(true);
  });
});
