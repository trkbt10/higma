/**
 * @file Case `box-leaf` — neutral `<div>` produces a neutral FRAME IR.
 *
 * This is the bottom of the case ladder. Every higher-tier case
 * starts from `baseDiv()` and adds one feature; if THIS case fails,
 * everything above it is meaningless because the baseline is broken.
 * Assert only the contract a no-style `<div>` carries:
 *
 *   - normalises to `kind: "frame"`
 *   - empty fills / strokes / effects
 *   - opacity 1, no cornerRadius, blendMode "normal", clipsContent false
 *   - autoLayout `direction: "none"` (no children means no inference)
 *   - geometry equals the input rect
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv, DEFAULT_BOX } from "./fixture";

describe("case box-leaf", () => {
  const ir = normalizeOne(baseDiv());
  const frame = asFrame(singleChild(ir));

  it("produces a FRAME node", () => {
    expect(frame.kind).toBe("frame");
  });

  it("inherits the input rect verbatim", () => {
    expect(frame.box).toEqual(DEFAULT_BOX);
  });

  it("emits no fills, strokes, or effects", () => {
    expect(frame.style.fills).toEqual([]);
    expect(frame.style.strokes).toEqual([]);
    expect(frame.style.effects).toEqual([]);
  });

  it("uses neutral defaults for opacity / blend / clipping / radius", () => {
    expect(frame.style.opacity).toBe(1);
    expect(frame.style.blendMode).toBe("normal");
    expect(frame.style.clipsContent).toBe(false);
    expect(frame.style.cornerRadius).toBeUndefined();
  });

  it("emits no autoLayout (no children to infer)", () => {
    expect(frame.autoLayout.direction).toBe("none");
  });
});
