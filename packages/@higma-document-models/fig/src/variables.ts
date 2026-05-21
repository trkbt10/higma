/** @file Kiwi variable value projection and concrete value requirements. */

import type {
  FigAssetRef,
  FigColor,
  FigKiwiVariableAnyValue,
  FigKiwiVariableData,
  FigVariableAnyValue,
  FigGuidOrAssetRefId,
  FigVariableID,
} from "./types";
import { guidToString } from "./domain";

/**
 * Project the Kiwi `VariableAnyValue` oneof-by-field-presence payload to
 * a discriminated union. The order follows the Kiwi schema declaration.
 */
export function projectVariableAnyValue(raw: FigKiwiVariableAnyValue | undefined): FigVariableAnyValue | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw.boolValue !== undefined) {
    return { kind: "bool", value: raw.boolValue };
  }
  if (raw.textValue !== undefined) {
    return { kind: "text", value: raw.textValue };
  }
  if (raw.floatValue !== undefined) {
    return { kind: "float", value: raw.floatValue };
  }
  if (raw.alias !== undefined) {
    return { kind: "alias", value: raw.alias };
  }
  if (raw.colorValue !== undefined) {
    return { kind: "color", value: raw.colorValue };
  }
  if (raw.expressionValue !== undefined) {
    return { kind: "expression", value: raw.expressionValue };
  }
  if (raw.mapValue !== undefined) {
    return { kind: "map", value: raw.mapValue };
  }
  return undefined;
}

/** Require a Kiwi variable payload to carry a concrete color value. */
export function requireVariableColor(data: FigKiwiVariableData | undefined, subject: string): FigColor {
  const color = resolveConcreteVariableColor(data, subject);
  if (color !== undefined) {
    return color;
  }
  const value = projectRequiredVariableValue(data, subject);
  throw new Error(`${subject} requires a concrete COLOR variable value, got ${variableValueKindLabel(value)}`);
}

/**
 * Resolve a Kiwi variable payload only when the concrete value is local.
 * Library aliases are explicit references but not concrete values, so callers
 * that also carry an embedded resolved field can keep using that embedded
 * Kiwi value without inventing one.
 */
export function resolveConcreteVariableColor(data: FigKiwiVariableData | undefined, subject: string): FigColor | undefined {
  const value = projectRequiredVariableValue(data, subject);
  if (value.kind === "color") {
    return value.value;
  }
  if (value.kind === "alias") {
    return undefined;
  }
  throw new Error(`${subject} requires a concrete COLOR variable value, got ${variableValueKindLabel(value)}`);
}

/** Require a Kiwi variable payload to carry a concrete numeric value. */
export function requireVariableFloat(data: FigKiwiVariableData | undefined, subject: string): number {
  const value = projectRequiredVariableValue(data, subject);
  if (value.kind === "float") {
    return value.value;
  }
  throw new Error(`${subject} requires a concrete FLOAT variable value, got ${variableValueKindLabel(value)}`);
}

function projectRequiredVariableValue(data: FigKiwiVariableData | undefined, subject: string): FigVariableAnyValue {
  const value = projectVariableAnyValue(data?.value);
  if (value === undefined) {
    throw new Error(`${subject} requires variableData.value`);
  }
  return value;
}

function variableValueKindLabel(value: FigVariableAnyValue): string {
  if (value.kind === "alias") {
    return `alias ${variableIdLabel(value.value)}`;
  }
  return value.kind;
}

function variableIdLabel(id: FigVariableID): string {
  return variableIdKey(id);
}

/**
 * Stable key for Kiwi variable identifiers.
 *
 * Variable references may point to a local GUID or a library assetRef.
 * Code that indexes variable-derived document facts must use the same
 * discriminator for both shapes so local and library namespaces cannot
 * collide.
 */
export function variableIdKey(id: FigVariableID | FigGuidOrAssetRefId): string {
  if ("guid" in id && id.guid !== undefined) {
    return `guid:${guidToString(id.guid)}`;
  }
  if ("assetRef" in id && id.assetRef !== undefined) {
    return variableAssetRefKey(id.assetRef);
  }
  if ("sessionID" in id && "localID" in id) {
    return `guid:${guidToString(id)}`;
  }
  throw new Error("Variable identifier must carry either guid or assetRef");
}

function variableAssetRefKey(ref: FigAssetRef): string {
  if (ref.version === undefined) {
    return `assetRef:${ref.key}`;
  }
  return `assetRef:${ref.key}@${ref.version}`;
}
