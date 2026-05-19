/**
 * @file Case `solid-bg` — `<div style="background-color: ...">` becomes
 * a FRAME with a single SOLID fill carrying the parsed colour.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_SOLID_COLOR, withSolidBg } from "./fixture";

describe("case solid-bg", () => {
  const frame = asFrame(singleChild(normalizeOne(withSolidBg(baseDiv()))));

  it("emits exactly one fill", () => {
    expect(frame.style.fills).toHaveLength(1);
  });

  it("emits a SOLID fill with the parsed colour", () => {
    const fill = frame.style.fills[0]!;
    if (fill.kind !== "solid") {
      throw new Error("expected SOLID fill");
    }
    expect(fill.color.r * 255).toBeCloseTo(220, 0);
    expect(fill.color.g * 255).toBeCloseTo(50, 0);
    expect(fill.color.b * 255).toBeCloseTo(47, 0);
    expect(fill.color.a).toBe(1);
  });

  it("ignores fully-transparent backgrounds (CSS default)", () => {
    const transparent = asFrame(
      singleChild(normalizeOne(withSolidBg(baseDiv(), "rgba(0, 0, 0, 0)"))),
    );
    expect(transparent.style.fills).toHaveLength(0);
  });

  it("default colour is the constant exported alongside the function", () => {
    expect(DEFAULT_SOLID_COLOR).toBe("rgb(220, 50, 47)");
  });
});
