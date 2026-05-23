/** @file Tests for Figma blend mode conversion. */

import { BLEND_MODE_VALUES } from "@higma-document-models/fig/constants";
import { convertFigmaBlendMode, convertFigmaNodeBlendMode } from "./blend-mode";

describe("Figma blend mode conversion", () => {
  it("keeps SOFT_LIGHT available for paint and effect blend layers", () => {
    expect(convertFigmaBlendMode({ value: BLEND_MODE_VALUES.SOFT_LIGHT, name: "SOFT_LIGHT" })).toBe("soft-light");
  });

  it("does not project node-level SOFT_LIGHT into an SVG blend layer", () => {
    expect(convertFigmaNodeBlendMode({ value: BLEND_MODE_VALUES.SOFT_LIGHT, name: "SOFT_LIGHT" })).toBeUndefined();
  });

  it("keeps node-level LINEAR_BURN and LINEAR_DODGE as explicit Figma SVG blend layers", () => {
    expect(convertFigmaNodeBlendMode({ value: BLEND_MODE_VALUES.LINEAR_BURN, name: "LINEAR_BURN" })).toBe("plus-darker");
    expect(convertFigmaNodeBlendMode({ value: BLEND_MODE_VALUES.LINEAR_DODGE, name: "LINEAR_DODGE" })).toBe("plus-lighter");
  });
});
