/**
 * @file Case `shadow-inset` — `inset` keyword routes the shadow to
 * the `inner-shadow` EffectIR variant.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { withInsetShadow } from "./fixture";

describe("case shadow-inset", () => {
  const frame = asFrame(singleChild(normalizeOne(withInsetShadow(baseDiv()))));

  it("emits one `inner-shadow` (NOT `drop-shadow`)", () => {
    expect(frame.style.effects).toHaveLength(1);
    expect(frame.style.effects[0]!.kind).toBe("inner-shadow");
  });
});
