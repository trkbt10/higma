/**
 * @file Case `corner-radius-uniform` — uniform CSS `border-radius`
 * becomes a 4-tuple of identical px LengthIRs in IR, and collapses to
 * a single FRAME `cornerRadius` value at the Kiwi FigNode boundary.
 */
import { asFrame, buildOne, findFigNodeByName, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_RADIUS_PX, withUniformRadius } from "./fixture";

describe("case corner-radius-uniform — IR", () => {
  const frame = asFrame(singleChild(normalizeOne(withUniformRadius(baseDiv()))));

  it("emits a 4-tuple cornerRadius", () => {
    expect(frame.style.cornerRadius).toHaveLength(4);
  });

  it("each corner is `kind: px` with the authored value", () => {
    const radii = frame.style.cornerRadius!;
    for (const r of radii) {
      expect(r).toEqual({ kind: "px", value: DEFAULT_RADIUS_PX });
    }
  });
});

describe("case corner-radius-uniform — Kiwi FigNode", () => {
  const { context } = buildOne(withUniformRadius(baseDiv()));
  const node = findFigNodeByName(context, "div");

  it("collapses to a single FRAME `cornerRadius`", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.cornerRadius).toBe(DEFAULT_RADIUS_PX);
  });

  it("does not emit `rectangleCornerRadii` when the corners are uniform", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.rectangleCornerRadii).toBeUndefined();
  });
});
