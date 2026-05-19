/**
 * @file FigEffect ↔ EffectIR conversion.
 *
 * Coverage:
 *   - DROP_SHADOW       ↔ drop-shadow
 *   - INNER_SHADOW      ↔ inner-shadow
 *   - FOREGROUND_BLUR   ↔ layer-blur
 *   - BACKGROUND_BLUR   ↔ background-blur
 */
import type { FigEffect, FigEffectType, KiwiEnumValue } from "@higma-document-models/fig/types";
import { EFFECT_TYPE_VALUES, kiwiEnumName } from "@higma-document-models/fig/constants";
import type { BlurEffectIR, EffectIR, ShadowEffectIR } from "../ir/types";
import { figColorToIR, irColorToFig } from "./color";

/** FigEffect → IR effect (shadows + layer/background blur). */
export function figEffectToIR(effect: FigEffect): EffectIR {
  const name = effectTypeName(effect.type);
  switch (name) {
    case "DROP_SHADOW":
      return shadowToIR(effect, "drop-shadow");
    case "INNER_SHADOW":
      return shadowToIR(effect, "inner-shadow");
    case "FOREGROUND_BLUR":
      return blurToIR(effect, "layer-blur");
    case "BACKGROUND_BLUR":
      return blurToIR(effect, "background-blur");
  }
}

/** Inverse of `figEffectToIR` — IR effect → FigEffect. */
export function irEffectToFig(effect: EffectIR): FigEffect {
  switch (effect.kind) {
    case "drop-shadow":
      return shadowToFig(effect, "DROP_SHADOW");
    case "inner-shadow":
      return shadowToFig(effect, "INNER_SHADOW");
    case "layer-blur":
      return blurToFig(effect, "FOREGROUND_BLUR");
    case "background-blur":
      return blurToFig(effect, "BACKGROUND_BLUR");
  }
}

function effectTypeName(t: FigEffectType | KiwiEnumValue<FigEffectType>): FigEffectType {
  const name = kiwiEnumName<FigEffectType>(t, "FigEffect.type");
  if (name === undefined) {
    throw new Error("figEffectToIR: FigEffect.type is required");
  }
  return name;
}

function shadowToIR(effect: FigEffect, kind: "drop-shadow" | "inner-shadow"): ShadowEffectIR {
  if (!effect.color) {
    throw new Error(`figEffectToIR: ${kind} requires a color`);
  }
  return {
    kind,
    color: figColorToIR(effect.color),
    offsetX: effect.offset?.x ?? 0,
    offsetY: effect.offset?.y ?? 0,
    blurRadius: effect.radius ?? 0,
    spread: effect.spread,
    visible: effect.visible,
  };
}

function shadowToFig(
  effect: ShadowEffectIR,
  type: "DROP_SHADOW" | "INNER_SHADOW",
): FigEffect {
  return {
    type: { name: type, value: EFFECT_TYPE_VALUES[type] },
    color: irColorToFig(effect.color),
    offset: { x: effect.offsetX, y: effect.offsetY },
    radius: effect.blurRadius,
    spread: effect.spread,
    visible: effect.visible,
  };
}

function blurToIR(effect: FigEffect, kind: "layer-blur" | "background-blur"): BlurEffectIR {
  return {
    kind,
    radius: effect.radius ?? 0,
    visible: effect.visible,
  };
}

function blurToFig(
  effect: BlurEffectIR,
  type: "FOREGROUND_BLUR" | "BACKGROUND_BLUR",
): FigEffect {
  return {
    type: { name: type, value: EFFECT_TYPE_VALUES[type] },
    radius: effect.radius,
    visible: effect.visible,
  };
}
