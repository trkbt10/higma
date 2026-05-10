/**
 * @file Case `opacity` — CSS `opacity` lands on `style.opacity`
 * verbatim. The default 1 is asserted by the `box-leaf` case; this
 * case proves a non-default value survives.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_OPACITY, withOpacity } from "./fixture";

describe("case opacity", () => {
  it("forwards the authored opacity to `style.opacity`", () => {
    const frame = asFrame(singleChild(normalizeOne(withOpacity(baseDiv()))));
    expect(frame.style.opacity).toBe(DEFAULT_OPACITY);
  });

  it("accepts a fully transparent element (opacity: 0)", () => {
    const frame = asFrame(singleChild(normalizeOne(withOpacity(baseDiv(), 0))));
    expect(frame.style.opacity).toBe(0);
  });
});
