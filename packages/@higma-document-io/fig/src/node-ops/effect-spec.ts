/** @file EffectSpec → FigEffect lift. */

import type { FigEffect } from "@higma-document-models/fig/types";
import {
  BLEND_MODE_VALUES,
  EFFECT_TYPE_VALUES,
  toEnumValue,
} from "@higma-document-models/fig/constants";
import type { EffectSpec } from "../types/spec-types";

/**
 * Branch helper: decides whether an entry in `NodeSpec.effects` is a
 * string-discriminated `EffectSpec` or a pre-built `FigEffect`.
 */
export function isEffectSpec(effect: EffectSpec | FigEffect): effect is EffectSpec {
  return typeof effect.type === "string";
}

/** Lift an `EffectSpec` to a wire-format `FigEffect`. */
export function effectSpecToFig(spec: EffectSpec): FigEffect {
  return {
    ...spec,
    type: toEnumValue(spec.type, EFFECT_TYPE_VALUES)!,
    blendMode: spec.blendMode === undefined ? undefined : toEnumValue(spec.blendMode, BLEND_MODE_VALUES),
  };
}

export function liftEffects(
  effects: readonly (EffectSpec | FigEffect)[] | undefined,
): readonly FigEffect[] | undefined {
  if (effects === undefined) {
    return undefined;
  }
  return effects.map((e) => (isEffectSpec(e) ? effectSpecToFig(e) : e));
}
