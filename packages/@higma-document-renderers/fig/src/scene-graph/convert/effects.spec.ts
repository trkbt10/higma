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

  it("uses concrete effect variable values before embedded shadow fields", () => {
    expect(convertEffectsToScene([{
      type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" },
      visible: true,
      color: { r: 1, g: 1, b: 1, a: 1 },
      colorVar: { value: { colorValue: { r: 0, g: 0, b: 0, a: 0.5 } } },
      offset: { x: 3, y: 4 },
      xVar: { value: { floatValue: 8 } },
      yVar: { value: { floatValue: 9 } },
      radius: 1,
      radiusVar: { value: { floatValue: 12 } },
      spread: 2,
      spreadVar: { value: { floatValue: 6 } },
    }])).toEqual([{
      type: "drop-shadow",
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      offset: { x: 8, y: 9 },
      radius: 12,
      spread: 6,
      showShadowBehindNode: undefined,
    }]);
  });

  it("throws when an effect variable is an unresolved alias", () => {
    expect(() => convertEffectsToScene([{
      type: { value: EFFECT_TYPE_VALUES.BACKGROUND_BLUR, name: "BACKGROUND_BLUR" },
      visible: true,
      radiusVar: {
        value: {
          alias: {
            assetRef: { key: "library-radius" },
          },
        },
      },
    }])).toThrow("Effect.radiusVar requires a concrete FLOAT variable value, got alias assetRef:library-radius");
  });
});
