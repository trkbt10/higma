/**
 * @file Kiwi enum normalization for fig-family node changes.
 */

import {
  FIG_BLEND_MODE_VALUES,
  FIG_EFFECT_TYPE_VALUES,
  FIG_IMAGE_SCALE_MODE_VALUES,
  FIG_PAINT_TYPE_VALUES,
  FIG_STROKE_ALIGN_VALUES,
  FIG_STROKE_CAP_VALUES,
  FIG_STROKE_JOIN_VALUES,
} from "./fig-enum-values";

export type FigKiwiEnumValue = {
  readonly value: number;
  readonly name: string;
};

const PAINT_ENUM_FIELDS = ["type", "blendMode", "scaleMode", "imageScaleMode"] as const;
const NODE_ENUM_FIELDS = ["strokeAlign", "strokeJoin", "strokeCap", "blendMode"] as const;

function isKiwiEnumValue(value: unknown): value is FigKiwiEnumValue {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as { readonly name?: unknown; readonly value?: unknown };
  return typeof obj.name === "string" && typeof obj.value === "number";
}

function enumNameOrValue(value: unknown): unknown {
  if (isKiwiEnumValue(value)) {
    return value.name;
  }
  return value;
}

function normalizePaintInPlace(paint: Record<string, unknown>): void {
  for (const field of PAINT_ENUM_FIELDS) {
    if (field in paint) {
      paint[field] = enumNameOrValue(paint[field]);
    }
  }
}

function normalizeEffectInPlace(effect: Record<string, unknown>): void {
  if ("type" in effect) {
    effect.type = enumNameOrValue(effect.type);
  }
  if ("blendMode" in effect) {
    effect.blendMode = enumNameOrValue(effect.blendMode);
  }
}

function normalizePaintList(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const paint of list) {
    if (paint && typeof paint === "object") {
      normalizePaintInPlace(paint as Record<string, unknown>);
    }
  }
}

function normalizeEffectList(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const effect of list) {
    if (effect && typeof effect === "object") {
      normalizeEffectInPlace(effect as Record<string, unknown>);
    }
  }
}

function normalizeOverrideInPlace(override: Record<string, unknown>): void {
  for (const field of NODE_ENUM_FIELDS) {
    if (field in override) {
      override[field] = enumNameOrValue(override[field]);
    }
  }
  normalizePaintList(override.fillPaints);
  normalizePaintList(override.strokePaints);
  normalizePaintList(override.backgroundPaints);
  normalizeEffectList(override.effects);
}

function normalizeOverrideList(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const entry of list) {
    if (entry && typeof entry === "object") {
      normalizeOverrideInPlace(entry as Record<string, unknown>);
    }
  }
}

function normalizeNodeInPlace(node: Record<string, unknown>): void {
  for (const field of NODE_ENUM_FIELDS) {
    if (field in node) {
      node[field] = enumNameOrValue(node[field]);
    }
  }
  normalizePaintList(node.fillPaints);
  normalizePaintList(node.strokePaints);
  normalizePaintList(node.backgroundPaints);
  normalizeEffectList(node.effects);
  normalizeOverrideList(node.symbolOverrides);
  const symbolData = node.symbolData;
  if (symbolData && typeof symbolData === "object") {
    normalizeOverrideList((symbolData as Record<string, unknown>).symbolOverrides);
  }
}

/** Normalize decoded Kiwi enum objects into string-valued fig-family node fields. */
export function normaliseFigFamilyNodeChanges<NodeChange>(
  rawNodes: readonly unknown[],
): readonly NodeChange[] {
  for (const node of rawNodes) {
    if (node && typeof node === "object") {
      normalizeNodeInPlace(node as Record<string, unknown>);
    }
  }
  return rawNodes as readonly NodeChange[];
}

function lookupEnum(values: Readonly<Record<string, number>>, name: unknown): FigKiwiEnumValue | unknown {
  if (typeof name !== "string") {
    return name;
  }
  if (!(name in values)) {
    return name;
  }
  return { value: values[name], name };
}

/**
 * Reduce a wide UI-level scale-mode label to a name the Figma Kiwi
 * schema actually defines. Mirrors `canonicaliseImageScaleMode`
 * from `@higma-document-models/fig/constants` but lives here too
 * so the runtime layer does not need to depend on the higher-level
 * model package. CROP is the editor's UI alias for FILL — Figma's
 * binary format does not declare it.
 */
function canonicaliseImageScaleModeName(name: string): string {
  if (name === "CROP") {
    return "FILL";
  }
  return name;
}

function denormalizePaintInPlace(paint: Record<string, unknown>): void {
  if (typeof paint.type === "string") {
    paint.type = lookupEnum(FIG_PAINT_TYPE_VALUES, paint.type);
  }
  if (typeof paint.blendMode === "string") {
    paint.blendMode = lookupEnum(FIG_BLEND_MODE_VALUES, paint.blendMode);
  }
  if (typeof paint.scaleMode === "string") {
    paint.scaleMode = lookupEnum(FIG_IMAGE_SCALE_MODE_VALUES, canonicaliseImageScaleModeName(paint.scaleMode));
  }
  if (typeof paint.imageScaleMode === "string") {
    paint.imageScaleMode = lookupEnum(FIG_IMAGE_SCALE_MODE_VALUES, canonicaliseImageScaleModeName(paint.imageScaleMode));
  }
}

function denormalizeEffectInPlace(effect: Record<string, unknown>): void {
  if (typeof effect.type === "string") {
    effect.type = lookupEnum(FIG_EFFECT_TYPE_VALUES, effect.type);
  }
  if (typeof effect.blendMode === "string") {
    effect.blendMode = lookupEnum(FIG_BLEND_MODE_VALUES, effect.blendMode);
  }
}

function denormalizePaintList(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const paint of list) {
    if (paint && typeof paint === "object") {
      denormalizePaintInPlace(paint as Record<string, unknown>);
    }
  }
}

function denormalizeEffectList(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const effect of list) {
    if (effect && typeof effect === "object") {
      denormalizeEffectInPlace(effect as Record<string, unknown>);
    }
  }
}

function denormalizeOverrideInPlace(override: Record<string, unknown>): void {
  if (typeof override.strokeAlign === "string") {
    override.strokeAlign = lookupEnum(FIG_STROKE_ALIGN_VALUES, override.strokeAlign);
  }
  if (typeof override.strokeJoin === "string") {
    override.strokeJoin = lookupEnum(FIG_STROKE_JOIN_VALUES, override.strokeJoin);
  }
  if (typeof override.strokeCap === "string") {
    override.strokeCap = lookupEnum(FIG_STROKE_CAP_VALUES, override.strokeCap);
  }
  if (typeof override.blendMode === "string") {
    override.blendMode = lookupEnum(FIG_BLEND_MODE_VALUES, override.blendMode);
  }
  denormalizePaintList(override.fillPaints);
  denormalizePaintList(override.strokePaints);
  denormalizePaintList(override.backgroundPaints);
  denormalizeEffectList(override.effects);
}

function denormalizeOverrideList(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const entry of list) {
    if (entry && typeof entry === "object") {
      denormalizeOverrideInPlace(entry as Record<string, unknown>);
    }
  }
}

function denormalizeNodeInPlace(node: Record<string, unknown>): void {
  if (typeof node.strokeAlign === "string") {
    node.strokeAlign = lookupEnum(FIG_STROKE_ALIGN_VALUES, node.strokeAlign);
  }
  if (typeof node.strokeJoin === "string") {
    node.strokeJoin = lookupEnum(FIG_STROKE_JOIN_VALUES, node.strokeJoin);
  }
  if (typeof node.strokeCap === "string") {
    node.strokeCap = lookupEnum(FIG_STROKE_CAP_VALUES, node.strokeCap);
  }
  if (typeof node.blendMode === "string") {
    node.blendMode = lookupEnum(FIG_BLEND_MODE_VALUES, node.blendMode);
  }
  denormalizePaintList(node.fillPaints);
  denormalizePaintList(node.strokePaints);
  denormalizePaintList(node.backgroundPaints);
  denormalizeEffectList(node.effects);
  denormalizeOverrideList(node.symbolOverrides);
  const symbolData = node.symbolData;
  if (symbolData && typeof symbolData === "object") {
    denormalizeOverrideList((symbolData as Record<string, unknown>).symbolOverrides);
  }
}

/** Clone a fig-family node change and convert string enums back to Kiwi enum values for encoding. */
export function denormaliseFigFamilyNodeForEncode<NodeChange>(node: NodeChange): Record<string, unknown> {
  if (!node || typeof node !== "object") {
    throw new Error("Expected fig-family node change to be an object");
  }
  const clone: object = structuredClone(node);
  const mutable = clone as Record<string, unknown>;
  denormalizeNodeInPlace(mutable);
  return mutable;
}
