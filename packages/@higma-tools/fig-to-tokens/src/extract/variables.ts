/**
 * @file Collect Figma Variables as `Token`s.
 *
 * Iterates `nodeChanges`, finds every VARIABLE node, walks every mode
 * of its VARIABLE_SET, and resolves each per-mode `variableData` to a
 * concrete literal — chasing aliases through other locally-carried
 * VARIABLE nodes. The alias chain is colour-aware (delegates to
 * `resolveVariableColor` for COLOR aliases so we share the same
 * resolution policy as the renderer) and handles FLOAT / BOOLEAN /
 * STRING aliases via a small parallel evaluator that mirrors the
 * private helper inside `variable-resolution.ts`.
 *
 * Library-only aliases (a variable that points at a Figma team-library
 * variable not present in this .fig) remain unresolved and are
 * skipped silently — Figma exports normally do not carry library
 * payloads, and surfacing a half-broken token would be worse than
 * leaving the slot out entirely.
 */

import type {
  FigColor,
  FigGuid,
  FigKiwiVariableData,
  FigKiwiVariableModeBySetMap,
  FigNode,
  FigVariableID,
} from "@higma-document-models/fig/types";
import { FIG_NODE_TYPE } from "@higma-document-models/fig/types";
import {
  getNodeType,
  guidToString,
  type FigKiwiDocumentIndex,
} from "@higma-document-models/fig/domain";
import { projectVariableAnyValue, variableIdKey } from "@higma-document-models/fig/variables";
import type { ColorValue, NumberValue, Token, TokenValue } from "../token-set";
import { buildCssId, buildTokenPath, slugifyForCss } from "./name";

type Mode = {
  readonly id: string;
  readonly name: string;
};

type VariableSet = {
  readonly node: FigNode;
  readonly slug: string;
  readonly name: string;
  readonly modes: readonly Mode[];
};

type SetIndex = ReadonlyMap<string, VariableSet>;

/**
 * Enumerate VARIABLE / VARIABLE_SET nodes and project them to `Token`s,
 * one entry per Variable, with one `valuesByMode` entry per mode of
 * the owning set.
 */
export function extractVariableTokens(document: FigKiwiDocumentIndex): {
  readonly tokens: readonly Token[];
  readonly modesBySetSlug: ReadonlyMap<string, readonly string[]>;
} {
  const setIndex = indexVariableSets(document);
  const tokens: Token[] = [];
  for (const node of document.nodeChanges) {
    if (getNodeType(node) !== FIG_NODE_TYPE.VARIABLE) {
      continue;
    }
    const token = projectVariableToToken(node, document, setIndex);
    if (token) {
      tokens.push(token);
    }
  }
  const modesBySetSlug = new Map<string, readonly string[]>();
  for (const set of setIndex.values()) {
    modesBySetSlug.set(set.slug, set.modes.map((m) => m.name));
  }
  return { tokens, modesBySetSlug };
}

function indexVariableSets(document: FigKiwiDocumentIndex): SetIndex {
  const map = new Map<string, VariableSet>();
  const usedSlugs = new Set<string>();
  for (const node of document.nodeChanges) {
    if (getNodeType(node) !== FIG_NODE_TYPE.VARIABLE_SET) {
      continue;
    }
    const guidKey = guidToString(node.guid);
    const baseName = node.name ?? "Variables";
    const slug = uniqueSlug(slugifyForCss(baseName) || "set", usedSlugs);
    usedSlugs.add(slug);
    const modes = (node.variableSetModes ?? []).map<Mode | undefined>((entry, index) => {
      if (entry.id === undefined) {
        return undefined;
      }
      return {
        id: guidToString(entry.id),
        name: entry.name ?? `Mode ${index + 1}`,
      };
    }).filter((m): m is Mode => m !== undefined);
    if (modes.length === 0) {
      // A set with no modes can't host values — skip.
      continue;
    }
    map.set(guidKey, { node, slug, name: baseName, modes });
  }
  return map;
}

function uniqueSlug(candidate: string, used: ReadonlySet<string>): string {
  if (!used.has(candidate)) {
    return candidate;
  }
  for (let n = 2; n < 10_000; n += 1) {
    const next = `${candidate}-${n}`;
    if (!used.has(next)) {
      return next;
    }
  }
  throw new Error(`fig-to-tokens: could not uniquify variable-set slug for ${candidate}`);
}

function projectVariableToToken(
  node: FigNode,
  document: FigKiwiDocumentIndex,
  setIndex: SetIndex,
): Token | undefined {
  const setID = node.variableSetID;
  if (setID === undefined) {
    return undefined;
  }
  if (setID.guid === undefined) {
    // Library variables (assetRef-only) — skip in this iteration.
    return undefined;
  }
  const set = setIndex.get(guidToString(setID.guid));
  if (set === undefined) {
    return undefined;
  }
  const resolvedType = node.variableResolvedType?.name;
  if (resolvedType === undefined) {
    return undefined;
  }
  const baseName = node.name ?? guidToString(node.guid);
  const path = buildTokenPath(set.name, baseName);
  const cssId = buildCssId(baseName, set.name);
  const valuesByMode = new Map<string, TokenValue>();
  for (const mode of set.modes) {
    const value = resolveVariableValueForMode({
      node,
      modeId: mode.id,
      resolvedType,
      baseName,
      document,
    });
    if (value !== undefined) {
      valuesByMode.set(mode.name, value);
    }
  }
  if (valuesByMode.size === 0) {
    return undefined;
  }
  const defaultModeName = set.modes[0]?.name ?? "default";
  return {
    path,
    cssId,
    source: "variable",
    variableSetSlug: set.slug,
    variableSetName: set.name,
    valuesByMode,
    defaultModeName,
  };
}

function resolveVariableValueForMode(params: {
  readonly node: FigNode;
  readonly modeId: string;
  readonly resolvedType: string;
  readonly baseName: string;
  readonly document: FigKiwiDocumentIndex;
}): TokenValue | undefined {
  const { node, modeId, document, resolvedType, baseName } = params;
  const valueEntry = (node.variableDataValues?.entries ?? []).find((entry) => {
    return entry.modeID !== undefined && guidToString(entry.modeID) === modeId;
  });
  if (!valueEntry || valueEntry.variableData === undefined || valueEntry.modeID === undefined) {
    return undefined;
  }
  const modeMap = buildSingleModeMap(node, valueEntry.modeID);
  if (resolvedType === "COLOR") {
    return resolveColorTokenValue(valueEntry.variableData, document, modeMap);
  }
  return resolveScalarTokenValue({
    data: valueEntry.variableData,
    document,
    modeMap,
    baseName,
  });
}

function buildSingleModeMap(
  variable: FigNode,
  modeID: FigGuid,
): FigKiwiVariableModeBySetMap | undefined {
  const variableSetID = variable.variableSetID;
  if (variableSetID === undefined) {
    return undefined;
  }
  return {
    entries: [{ variableSetID, variableModeID: modeID }],
  };
}

function resolveColorTokenValue(
  data: FigKiwiVariableData,
  document: FigKiwiDocumentIndex,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): ColorValue | undefined {
  const color = evaluateColorVariable(data, document, modeMap, new Set());
  if (color === undefined) {
    return undefined;
  }
  return { kind: "color", css: figColorToCss(color) };
}

function evaluateColorVariable(
  data: FigKiwiVariableData | undefined,
  document: FigKiwiDocumentIndex,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
  seen: ReadonlySet<string>,
): FigColor | undefined {
  const projected = projectVariableAnyValue(data?.value);
  if (!projected) {
    return undefined;
  }
  if (projected.kind === "color") {
    return projected.value;
  }
  if (projected.kind !== "alias") {
    return undefined;
  }
  const key = variableIdKey(projected.value);
  if (seen.has(key)) {
    throw new Error(`fig-to-tokens: cyclic colour-variable alias ${key}`);
  }
  const target = findLocalVariableNode(projected.value, document);
  if (target === undefined) {
    return undefined;
  }
  const targetData = readVariableDataForMode(target, modeMap);
  const nextSeen = new Set([...seen, key]);
  return evaluateColorVariable(targetData, document, modeMap, nextSeen);
}

function resolveScalarTokenValue(params: {
  readonly data: FigKiwiVariableData;
  readonly document: FigKiwiDocumentIndex;
  readonly modeMap: FigKiwiVariableModeBySetMap | undefined;
  readonly baseName: string;
}): TokenValue | undefined {
  const { data, document, modeMap, baseName } = params;
  const literal = evaluateScalarVariable(data, document, modeMap, new Set());
  if (literal === undefined) {
    return undefined;
  }
  if (literal.kind === "float") {
    return inferNumberValue(literal.value, baseName);
  }
  if (literal.kind === "bool") {
    return { kind: "boolean", value: literal.value };
  }
  if (literal.kind === "text") {
    return { kind: "string", value: literal.value };
  }
  return undefined;
}

type ScalarLiteral =
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "text"; readonly value: string };

function evaluateScalarVariable(
  data: FigKiwiVariableData | undefined,
  document: FigKiwiDocumentIndex,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
  seen: ReadonlySet<string>,
): ScalarLiteral | undefined {
  const projected = projectVariableAnyValue(data?.value);
  if (!projected) {
    return undefined;
  }
  if (projected.kind === "float") {
    return { kind: "float", value: projected.value };
  }
  if (projected.kind === "bool") {
    return { kind: "bool", value: projected.value };
  }
  if (projected.kind === "text") {
    return { kind: "text", value: projected.value };
  }
  if (projected.kind === "alias") {
    return followAlias(projected.value, document, modeMap, seen);
  }
  return undefined;
}

function followAlias(
  aliasId: FigVariableID,
  document: FigKiwiDocumentIndex,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
  seen: ReadonlySet<string>,
): ScalarLiteral | undefined {
  const key = variableIdKey(aliasId);
  if (seen.has(key)) {
    throw new Error(`fig-to-tokens: cyclic variable alias ${key}`);
  }
  const target = findLocalVariableNode(aliasId, document);
  if (target === undefined) {
    return undefined;
  }
  const targetData = readVariableDataForMode(target, modeMap);
  if (targetData === undefined) {
    return undefined;
  }
  const nextSeen = new Set([...seen, key]);
  // The alias may resolve to another alias; the recursion handles
  // chains until we reach a concrete value or run out of local nodes.
  return evaluateScalarVariable(targetData, document, modeMap, nextSeen);
}

function findLocalVariableNode(
  id: FigVariableID,
  document: FigKiwiDocumentIndex,
): FigNode | undefined {
  // `FigVariableID` is `FigGuid | { assetRef }`. The FigGuid variant
  // carries `sessionID` + `localID` directly; the assetRef variant
  // wraps a library handle that this .fig does not resolve locally.
  if ("assetRef" in id) {
    return undefined;
  }
  return document.nodesByGuid.get(guidToString(id));
}

function readVariableDataForMode(
  variable: FigNode,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): FigKiwiVariableData | undefined {
  const entries = variable.variableDataValues?.entries ?? [];
  if (entries.length === 0) {
    return undefined;
  }
  const targetModeId = selectModeIdForVariable(variable, modeMap);
  if (targetModeId === undefined) {
    // No mode preference and the variable has multiple values — fall
    // back to the first entry. Matches Figma's behaviour for "no mode
    // context".
    return entries[0]?.variableData;
  }
  for (const entry of entries) {
    if (entry.modeID !== undefined && guidToString(entry.modeID) === targetModeId) {
      return entry.variableData;
    }
  }
  return entries[0]?.variableData;
}

function selectModeIdForVariable(
  variable: FigNode,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): string | undefined {
  const setID = variable.variableSetID;
  if (setID === undefined || setID.guid === undefined) {
    return undefined;
  }
  const setKey = guidToString(setID.guid);
  for (const entry of modeMap?.entries ?? []) {
    const entrySetGuid = entry.variableSetID?.guid;
    if (entrySetGuid === undefined) {
      continue;
    }
    if (guidToString(entrySetGuid) === setKey && entry.variableModeID !== undefined) {
      return guidToString(entry.variableModeID);
    }
  }
  return undefined;
}

/**
 * Heuristic CSS-unit inference for FLOAT variables.
 *
 * Figma stores Variables as raw doubles; the unit is editor metadata
 * that does not survive the round-trip. We look at the source name
 * (variable name + parent set name) for the standard design-system
 * prefixes and emit `px`, `%`, or unitless accordingly. Anything that
 * doesn't match a hint is emitted unitless so downstream tooling can
 * decide.
 */
function inferNumberValue(value: number, sourceName: string): NumberValue {
  const haystack = sourceName.toLowerCase();
  if (/(^|[\s/_-])(opacity|alpha)([\s/_-]|$)/.test(haystack)) {
    return { kind: "number", value, unit: null };
  }
  if (/(^|[\s/_-])(spacing|space|gap|padding|margin|inset|radius|size|width|height|stroke|border|line-?height|font-?size|tracking|letter-?spacing|offset)([\s/_-]|$)/.test(haystack)) {
    return { kind: "number", value, unit: "px" };
  }
  return { kind: "number", value, unit: null };
}

/**
 * Inline `FigColor` → CSS conversion.
 *
 * Hex `#rrggbb` when alpha is 1; otherwise `rgba(...)` with 3-decimal
 * alpha. Channel inputs are clamped to `[0, 1]` per `FigColor`'s
 * documented range.
 */
function figColorToCss(color: FigColor): string {
  const r = clampUnit(color.r);
  const g = clampUnit(color.g);
  const b = clampUnit(color.b);
  const a = clampUnit(color.a);
  if (a >= 0.9995) {
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  }
  const ri = Math.round(r * 255);
  const gi = Math.round(g * 255);
  const bi = Math.round(b * 255);
  return `rgba(${ri}, ${gi}, ${bi}, ${trimDecimal(a, 3)})`;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function toHex2(unit: number): string {
  return Math.round(unit * 255).toString(16).padStart(2, "0");
}

function trimDecimal(value: number, places: number): string {
  return Number(value.toFixed(places)).toString();
}
