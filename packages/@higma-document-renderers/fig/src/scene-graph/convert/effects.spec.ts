/** @file Effect conversion tests */

import type { FigEffect } from "@higma-document-models/fig/types";
import { convertEffectsToScene } from "./effects";
import { BLEND_MODE_VALUES, EFFECT_TYPE_VALUES } from "@higma-document-models/fig/constants";

function blurEffect(type: "FOREGROUND_BLUR" | "BACKGROUND_BLUR", radius: number): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES[type], name: type },
    visible: true,
    radius,
  };
}

describe("convertEffectsToScene", () => {
  it("treats FOREGROUND_BLUR as layer blur", () => {
    expect(convertEffectsToScene([blurEffect("FOREGROUND_BLUR", 8)])).toEqual([
      { type: "layer-blur", radius: 8 },
    ]);
  });

  it("converts BACKGROUND_BLUR separately", () => {
    expect(convertEffectsToScene([blurEffect("BACKGROUND_BLUR", 10)])).toEqual([
      { type: "background-blur", radius: 10 },
    ]);
  });

  it("preserves first-class drop shadow attributes", () => {
    expect(convertEffectsToScene([{
      type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" },
      visible: true,
      color: { r: 1, g: 0, b: 0, a: 0.5 },
      offset: { x: 3, y: 4 },
      radius: 8,
      spread: 2,
      blendMode: { value: BLEND_MODE_VALUES.MULTIPLY, name: "MULTIPLY" },
      showShadowBehindNode: false,
    }])).toEqual([{
      type: "drop-shadow",
      color: { r: 1, g: 0, b: 0, a: 0.5 },
      offset: { x: 3, y: 4 },
      radius: 8,
      spread: 2,
      blendMode: "multiply",
      showShadowBehindNode: false,
    }]);
  });
});
