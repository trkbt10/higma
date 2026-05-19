/**
 * @file Case `corner-radius-asymmetric` — per-corner radius surfaces
 * as `rectangleCornerRadii` on the Kiwi FigNode (the corners do NOT
 * collapse to a single `cornerRadius` because they differ).
 */
import { asFrame, buildOne, findFigNodeByName, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_RADII_PX, withAsymmetricRadius } from "./fixture";

describe("case corner-radius-asymmetric — IR", () => {
  const frame = asFrame(singleChild(normalizeOne(withAsymmetricRadius(baseDiv()))));

  it("preserves all four authored radii in TL/TR/BR/BL order", () => {
    const radii = frame.style.cornerRadius!;
    expect(radii).toEqual([
      { kind: "px", value: DEFAULT_RADII_PX[0] },
      { kind: "px", value: DEFAULT_RADII_PX[1] },
      { kind: "px", value: DEFAULT_RADII_PX[2] },
      { kind: "px", value: DEFAULT_RADII_PX[3] },
    ]);
  });
});

describe("case corner-radius-asymmetric — Kiwi FigNode", () => {
  const { context } = buildOne(withAsymmetricRadius(baseDiv()));
  const node = findFigNodeByName(context, "div");

  it("emits `rectangleCornerRadii` (not the uniform-collapse form)", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.rectangleCornerRadii).toEqual(DEFAULT_RADII_PX);
    expect(node.cornerRadius).toBeUndefined();
  });
});
