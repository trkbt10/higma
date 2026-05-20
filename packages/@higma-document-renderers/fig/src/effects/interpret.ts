/**
 * @file Effect interpretation — shared SoT
 *
 * Pure functions that interpret Figma effect objects into
 * platform-agnostic intermediate structures. Both the SVG string renderer
 * and the SceneGraph builder consume these.
 */

import type { FigEffect, FigEffectType } from "@higma-document-models/fig/types";
import { kiwiEnumName } from "@higma-document-models/fig/constants";
import { requireVariableColor, requireVariableFloat, resolveConcreteVariableColor } from "@higma-document-models/fig/variables";

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
 * Extract shadow parameters from a DROP_SHADOW or INNER_SHADOW effect.
 *
 * Returns offset, radius, and color in a normalized form usable by
 * both SVG filter construction and SceneGraph effect objects.
 */
function resolveShadowColor(effect: FigEffect): ShadowParams["color"] {
  if (effect.colorVar !== undefined) {
    const color = resolveConcreteVariableColor(effect.colorVar, "Effect.colorVar")
      ?? effect.color
      ?? requireVariableColor(effect.colorVar, "Effect.colorVar");
    return { r: color.r, g: color.g, b: color.b, a: color.a };
  }
  if (effect.color !== undefined) {
    return { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a };
  }
  throw new Error("Effect.color is required when Effect.colorVar is absent");
}

function resolveEffectFloat(
  variableData: FigEffect["radiusVar"],
  embedded: number | undefined,
  subject: string,
): number | undefined {
  if (variableData !== undefined) {
    return requireVariableFloat(variableData, subject);
  }
  return embedded;
}

/** Resolve an effect radius from its concrete variable value or embedded Kiwi field. */
export function resolveEffectRadius(effect: FigEffect): number {
  const radius = resolveEffectFloat(effect.radiusVar, effect.radius, "Effect.radiusVar");
  if (radius === undefined) {
    throw new Error("Effect.radius is required when Effect.radiusVar is absent");
  }
  return radius;
}

/** Resolve an optional shadow spread from its concrete variable value or embedded Kiwi field. */
export function resolveEffectSpread(effect: FigEffect): number | undefined {
  return resolveEffectFloat(effect.spreadVar, effect.spread, "Effect.spreadVar");
}

/** Extracts shadow rendering parameters from a Figma effect definition. */
export function extractShadowParams(effect: FigEffect): ShadowParams {
  return {
    offsetX: resolveShadowOffset(effect.xVar, effect.offset?.x, "Effect.offset.x", "Effect.xVar"),
    offsetY: resolveShadowOffset(effect.yVar, effect.offset?.y, "Effect.offset.y", "Effect.yVar"),
    radius: resolveEffectRadius(effect),
    color: resolveShadowColor(effect),
  };
}

function resolveShadowOffset(
  variableData: FigEffect["xVar"],
  embedded: number | undefined,
  embeddedSubject: string,
  variableSubject: string,
): number {
  const resolved = resolveEffectFloat(variableData, embedded, variableSubject);
  if (resolved === undefined) {
    throw new Error(`${embeddedSubject} is required when ${variableSubject} is absent`);
  }
  return resolved;
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
