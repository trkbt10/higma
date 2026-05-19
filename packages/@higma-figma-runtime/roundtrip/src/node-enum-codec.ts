/** @file Kiwi enum materialisation for fig-family node encode. */

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

const PAINT_LIST_FIELDS = ["fillPaints", "strokePaints", "backgroundPaints"] as const;

export function readFigFamilyNodeChanges<NodeChange>(rawNodes: readonly unknown[]): readonly NodeChange[] {
  return rawNodes as readonly NodeChange[];
}

function enumValue(values: Readonly<Record<string, number>>, name: string, field: string): FigKiwiEnumValue {
  const value = values[name];
  if (value === undefined) {
    throw new Error(`Unsupported ${field} enum name "${name}"`);
  }
  return { value, name };
}

function kiwiImageScaleModeName(name: string): string {
  if (name === "CROP") {
    return "FILL";
  }
  return name;
}

function encodePaintInPlace(paint: Record<string, unknown>): void {
  if (typeof paint.type === "string") {
    paint.type = enumValue(FIG_PAINT_TYPE_VALUES, paint.type, "Paint.type");
  }
  if (typeof paint.blendMode === "string") {
    paint.blendMode = enumValue(FIG_BLEND_MODE_VALUES, paint.blendMode, "Paint.blendMode");
  }
  if (typeof paint.scaleMode === "string") {
    paint.scaleMode = enumValue(FIG_IMAGE_SCALE_MODE_VALUES, kiwiImageScaleModeName(paint.scaleMode), "Paint.scaleMode");
  }
  if (typeof paint.imageScaleMode === "string") {
    paint.imageScaleMode = enumValue(FIG_IMAGE_SCALE_MODE_VALUES, kiwiImageScaleModeName(paint.imageScaleMode), "Paint.imageScaleMode");
  }
}

function encodeEffectInPlace(effect: Record<string, unknown>): void {
  if (typeof effect.type === "string") {
    effect.type = enumValue(FIG_EFFECT_TYPE_VALUES, effect.type, "Effect.type");
  }
  if (typeof effect.blendMode === "string") {
    effect.blendMode = enumValue(FIG_BLEND_MODE_VALUES, effect.blendMode, "Effect.blendMode");
  }
}

function encodePaintListInPlace(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const paint of list) {
    if (paint && typeof paint === "object") {
      encodePaintInPlace(paint as Record<string, unknown>);
    }
  }
}

function encodeEffectListInPlace(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const effect of list) {
    if (effect && typeof effect === "object") {
      encodeEffectInPlace(effect as Record<string, unknown>);
    }
  }
}

function encodeNodeEnumFieldsInPlace(node: Record<string, unknown>): void {
  if (typeof node.strokeAlign === "string") {
    node.strokeAlign = enumValue(FIG_STROKE_ALIGN_VALUES, node.strokeAlign, "Node.strokeAlign");
  }
  if (typeof node.strokeJoin === "string") {
    node.strokeJoin = enumValue(FIG_STROKE_JOIN_VALUES, node.strokeJoin, "Node.strokeJoin");
  }
  if (typeof node.strokeCap === "string") {
    node.strokeCap = enumValue(FIG_STROKE_CAP_VALUES, node.strokeCap, "Node.strokeCap");
  }
  if (typeof node.blendMode === "string") {
    node.blendMode = enumValue(FIG_BLEND_MODE_VALUES, node.blendMode, "Node.blendMode");
  }
}

function encodeOverrideInPlace(override: Record<string, unknown>): void {
  encodeNodeEnumFieldsInPlace(override);
  for (const field of PAINT_LIST_FIELDS) {
    encodePaintListInPlace(override[field]);
  }
  encodeEffectListInPlace(override.effects);
}

function encodeOverrideListInPlace(list: unknown): void {
  if (!Array.isArray(list)) {
    return;
  }
  for (const entry of list) {
    if (entry && typeof entry === "object") {
      encodeOverrideInPlace(entry as Record<string, unknown>);
    }
  }
}

function encodeTextStyleOverridesInPlace(textData: unknown): void {
  if (!textData || typeof textData !== "object") {
    return;
  }
  const overrideTable = (textData as Record<string, unknown>).styleOverrideTable;
  if (!Array.isArray(overrideTable)) {
    return;
  }
  for (const entry of overrideTable) {
    if (entry && typeof entry === "object") {
      encodePaintListInPlace((entry as Record<string, unknown>).fillPaints);
    }
  }
}

function encodeNodeInPlace(node: Record<string, unknown>): void {
  encodeNodeEnumFieldsInPlace(node);
  for (const field of PAINT_LIST_FIELDS) {
    encodePaintListInPlace(node[field]);
  }
  encodeEffectListInPlace(node.effects);
  const symbolData = node.symbolData;
  if (symbolData && typeof symbolData === "object") {
    encodeOverrideListInPlace((symbolData as Record<string, unknown>).symbolOverrides);
  }
  encodeTextStyleOverridesInPlace(node.textData);
}

export function encodeFigFamilyNodeChange<NodeChange>(node: NodeChange): Record<string, unknown> {
  if (!node || typeof node !== "object") {
    throw new Error("Expected fig-family node change to be an object");
  }
  const clone: object = structuredClone(node);
  const mutable = clone as Record<string, unknown>;
  encodeNodeInPlace(mutable);
  return mutable;
}
