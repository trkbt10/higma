/**
 * @file Effect interpretation — shared SoT
 *
 * Pure functions that interpret Figma effect objects into
 * platform-agnostic intermediate structures. Both the SVG string renderer
 * and the SceneGraph builder consume these.
 */

import type { FigEffect, FigEffectType } from "@higma-document-models/fig/types";
import { kiwiEnumName } from "@higma-document-models/fig/constants";

// =============================================================================
// Effect Type
// =============================================================================

/**
 * Get the effect type name from a Figma effect.
 *
 */
export function getEffectTypeName(effect: FigEffect): FigEffectType {
  const type = kiwiEnumName<FigEffectType>(effect.type, "FigEffect.type");
  if (type === undefined) {
    throw new Error("FigEffect.type is required");
  }
  return type;
}

// =============================================================================
// Visibility
// =============================================================================

/**
 * Check if an effect is visible.
 */
export function isEffectVisible(effect: FigEffect): boolean {
  return effect.visible !== false;
}

// =============================================================================
// Shadow Parameters
// =============================================================================

export type ShadowParams = {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly radius: number;
  readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
};

/**
 * Default shadow color (used when effect.color is undefined).
 */
const DEFAULT_SHADOW_COLOR = { r: 0, g: 0, b: 0, a: 0.25 };

/**
 * Extract shadow parameters from a DROP_SHADOW or INNER_SHADOW effect.
 *
 * Returns offset, radius, and color in a normalized form usable by
 * both SVG filter construction and SceneGraph effect objects.
 */
function resolveShadowColor(color: FigEffect["color"]): ShadowParams["color"] {
  return color ? { r: color.r, g: color.g, b: color.b, a: color.a } : DEFAULT_SHADOW_COLOR;
}

/** Extracts shadow rendering parameters from a Figma effect definition. */
export function extractShadowParams(effect: FigEffect): ShadowParams {
  return {
    offsetX: effect.offset?.x ?? 0,
    offsetY: effect.offset?.y ?? 0,
    radius: effect.radius ?? 0,
    color: resolveShadowColor(effect.color),
  };
}

// =============================================================================
// Effect Classification
// =============================================================================

/**
 * Check if effects array has visible effects of a given type.
 */
export function hasEffectOfType(effects: readonly FigEffect[] | undefined, type: FigEffectType): boolean {
  if (!effects || effects.length === 0) {return false;}
  return effects.some((e) => isEffectVisible(e) && getEffectTypeName(e) === type);
}

/**
 * Get visible effects of a given type.
 */
export function getEffectsOfType(effects: readonly FigEffect[] | undefined, type: FigEffectType): readonly FigEffect[] {
  if (!effects || effects.length === 0) {return [];}
  return effects.filter((e) => isEffectVisible(e) && getEffectTypeName(e) === type);
}
