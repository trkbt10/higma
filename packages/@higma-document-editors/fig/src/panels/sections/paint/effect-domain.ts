/** @file Effect operations over Kiwi effect arrays. */
import { BLEND_MODE_VALUES, EFFECT_TYPE_VALUES, kiwiEnumName, toEnumValue, type EnumValue } from "@higma-document-models/fig/constants";
import type { BlendMode, FigColor, FigEffect, FigEffectType } from "@higma-document-models/fig/types";
import { extractShadowParams, getEffectTypeName, isEffectVisible, resolveShowShadowBehindNode } from "@higma-document-renderers/fig/effects";
import type { BlendModeId, EffectTypeId, EffectView } from "@higma-editor-kernel/ui/property-sections";
import { figColorToHex, hexToFigColor } from "./paint-domain";

const EDITOR_AUTHORED_SHADOW_COLOR: FigColor = { r: 0, g: 0, b: 0, a: 0.25 };

function kiwiEffectType(type: EffectTypeId): EnumValue<FigEffectType> {
  const value = toEnumValue(type, EFFECT_TYPE_VALUES);
  if (value === undefined) {
    throw new Error(`Effect type ${type} is not present in the Kiwi schema`);
  }
  return value;
}

function kiwiBlendMode(blendMode: BlendModeId): EnumValue<BlendMode> {
  const value = toEnumValue(blendMode, BLEND_MODE_VALUES);
  if (value === undefined) {
    throw new Error(`Blend mode ${blendMode} is not present in the Kiwi schema`);
  }
  return value;
}

function blendModeName(effect: FigEffect): BlendModeId {
  const blendMode = kiwiEnumName<BlendMode>(effect.blendMode, "effect.blendMode");
  if (blendMode === undefined) {
    return "NORMAL";
  }
  if (blendMode === "PASS_THROUGH" || blendMode === "LINEAR_BURN" || blendMode === "LINEAR_DODGE") {
    throw new Error(`Effect blend mode ${blendMode} is not supported by the property section`);
  }
  return blendMode;
}

/** Convert a Kiwi effect into property-section view state. */
export function effectToView(effect: FigEffect): EffectView {
  const type = getEffectTypeName(effect) as EffectTypeId;
  const shadow = extractShadowParams(effect);
  const color = shadow.color;
  return {
    type,
    visible: isEffectVisible(effect),
    radius: shadow.radius,
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    spread: effect.spread ?? 0,
    blendMode: blendModeName(effect),
    hex: figColorToHex(color),
    opacity: color.a,
    showShadowBehindNode: resolveShowShadowBehindNode(effect),
  };
}

function createEffect(type: EffectTypeId): FigEffect {
  if (type === "DROP_SHADOW" || type === "INNER_SHADOW") {
    return {
      type: kiwiEffectType(type),
      visible: true,
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 0,
      color: EDITOR_AUTHORED_SHADOW_COLOR,
      blendMode: kiwiBlendMode("NORMAL"),
      showShadowBehindNode: true,
    };
  }
  return {
    type: kiwiEffectType(type),
    visible: true,
    radius: 8,
  };
}

/** Append an editor-authored drop shadow effect. */
export function addEffect(effects: readonly FigEffect[] | undefined): readonly FigEffect[] {
  return [...(effects ?? []), createEffect("DROP_SHADOW")];
}

/** Remove one Kiwi effect from an effect list. */
export function removeEffect(effects: readonly FigEffect[] | undefined, index: number): readonly FigEffect[] {
  const list = effects ?? [];
  if (list[index] === undefined) {
    throw new Error(`Effect index ${index} is outside the effect list`);
  }
  return list.filter((_, currentIndex) => currentIndex !== index);
}

function replaceEffect(
  effects: readonly FigEffect[] | undefined,
  index: number,
  updater: (effect: FigEffect) => FigEffect,
): readonly FigEffect[] {
  const list = effects ?? [];
  const effect = list[index];
  if (effect === undefined) {
    throw new Error(`Effect index ${index} is outside the effect list`);
  }
  return list.map((current, currentIndex) => {
    if (currentIndex === index) {
      return updater(current);
    }
    return current;
  });
}

function writeEffectView(effect: FigEffect, view: EffectView): FigEffect {
  const currentType = getEffectTypeName(effect);
  if (currentType !== view.type) {
    return createEffect(view.type);
  }
  return {
    ...effect,
    visible: view.visible,
    radius: view.radius,
    offset: { x: view.offsetX, y: view.offsetY },
    spread: view.spread,
    blendMode: kiwiBlendMode(view.blendMode),
    color: hexToFigColor(view.hex, view.opacity),
    showShadowBehindNode: view.showShadowBehindNode,
  };
}

/** Update one Kiwi effect from property-section view state. */
export function updateEffect(
  effects: readonly FigEffect[] | undefined,
  index: number,
  view: EffectView,
): readonly FigEffect[] {
  return replaceEffect(effects, index, (effect) => writeEffectView(effect, view));
}

/** Return a compact effect count label. */
export function effectSummary(effects: readonly FigEffect[] | undefined): string {
  const count = effects?.length ?? 0;
  return `${count}`;
}
