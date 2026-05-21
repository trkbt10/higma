/**
 * @file Figma variable evaluation — projection from Kiwi `VariableData`
 * to a switchable union, plus the RESOLVE_VARIANT expression evaluator.
 *
 * Why this lives in @higma-document-models/fig/symbols: Figma variables are part of
 * the symbol/instance resolution domain (variable consumption maps
 * carried by INSTANCE nodes drive variant selection), so the
 * evaluator belongs alongside the rest of the symbol resolver.
 *
 * Scope:
 *   - `findVariableConsumptionExpression` — locate an INSTANCE's VCM
 *     entry that wraps an expression we can evaluate.
 *   - `resolveVariantOverride` — given an INSTANCE and the SYMBOL it
 *     references, choose the variant whose authored property values
 *     best match the VCM's RESOLVE_VARIANT mapValue. Returns the
 *     overridden symbol GUID, or `undefined` when:
 *       (a) the INSTANCE has no RESOLVE_VARIANT VCM,
 *       (b) the referenced SYMBOL is standalone (not in a variant set),
 *       (c) the variant properties cannot be resolved (e.g. the alias
 *           target is a library variable that this fig file does not
 *           include).
 */

import type {
  FigGuid,
  FigGuidOrAssetRefId,
  FigAssetRef,
  FigColor,
  FigKiwiVariableData,
  FigVariableExpression,
  FigVariableID,
  FigVariableMapEntry,
  FigKiwiVariableDataMap,
  FigKiwiVariableModeBySetMap,
  FigKiwiVariableModeBySetMapEntry,
  FigNode,
} from "../types";
import { FIG_NODE_TYPE } from "../types";
import { findNodeByGuid, getNodeType, guidToString, type FigKiwiDocumentIndex } from "../domain";
import { isVariantSetFrame } from "./variant-set-kiwi";
import { projectVariableAnyValue, variableIdKey } from "../variables";

// =============================================================================
// Expression locating
// =============================================================================

/**
 * Find the first VCM entry whose `variableData.value` is an
 * expression. Returns the projected expression and the entry's
 * nodeField (which maps to the schema's NodeFieldDef ID — currently
 * unused beyond passthrough but exposed for future evaluators).
 */
export function findVariableConsumptionExpression(
  vcm: FigKiwiVariableDataMap | undefined,
): { readonly expression: FigVariableExpression; readonly nodeField?: number } | undefined {
  if (!vcm?.entries) {
    return undefined;
  }
  for (const entry of vcm.entries) {
    const projected = projectVariableAnyValue(entry.variableData?.value);
    if (projected?.kind === "expression") {
      return { expression: projected.value, nodeField: entry.nodeField };
    }
  }
  return undefined;
}

function findVariantConsumptionExpression(
  instance: FigNode,
): { readonly expression: FigVariableExpression; readonly nodeField?: number } | undefined {
  return (
    findVariableConsumptionExpression(instance.variableConsumptionMap) ??
    findVariableConsumptionExpression(instance.parameterConsumptionMap)
  );
}

// =============================================================================
// Variable mode context
// =============================================================================

/**
 * Merge variable-mode selections inherited from the render/instance
 * ancestry with the selections authored on the current Kiwi node.
 *
 * A map with zero entries contributes no selected modes; it does not
 * reset inherited modes. Concrete entries override inherited entries
 * for the same variable set because the nearest node owns the active
 * Figma mode for that set. Kiwi also emits override entries that name
 * a variable-set without `variableModeID`; those are not selected
 * modes. They clear the inherited selection for that set so callers
 * fall back to the variable-set default instead of carrying an invalid
 * half-entry into paint / variant resolution.
 */
export function mergeVariableModeBySetMap(
  inherited: FigKiwiVariableModeBySetMap | undefined,
  local: FigKiwiVariableModeBySetMap | undefined,
): FigKiwiVariableModeBySetMap | undefined {
  const localEntries = local?.entries ?? [];
  if (localEntries.length === 0) {
    return inherited;
  }
  const entries = new Map<string, FigKiwiVariableModeBySetMapEntry>();
  for (const entry of inherited?.entries ?? []) {
    entries.set(variableModeEntrySetKey(entry), requireSelectedVariableModeEntry(entry));
  }
  for (const entry of localEntries) {
    const setKey = variableModeEntrySetKey(entry);
    if (entry.variableModeID === undefined) {
      entries.delete(setKey);
      continue;
    }
    entries.set(setKey, entry);
  }
  if (entries.size === 0) {
    return undefined;
  }
  return { entries: Array.from(entries.values()) };
}

function requireSelectedVariableModeEntry(
  entry: FigKiwiVariableModeBySetMapEntry,
): FigKiwiVariableModeBySetMapEntry {
  if (entry.variableModeID === undefined) {
    throw new Error(`VariableResolver: inherited variableModeBySetMap entry for ${variableModeEntrySetKey(entry)} is missing variableModeID`);
  }
  return entry;
}

// =============================================================================
// RESOLVE_VARIANT
// =============================================================================

/** Numeric value of `ExpressionFunction.RESOLVE_VARIANT` per figma-schema.json. */
const EXPRESSION_FUNCTION_RESOLVE_VARIANT = 2;

/**
 * Test whether `expr` is the RESOLVE_VARIANT function. The schema
 * uses both numeric `value` (binary serialisation) and a string `name`
 * (developer-facing schema tag), so both are accepted.
 */
function isResolveVariant(expr: FigVariableExpression): boolean {
  const fn = expr.expressionFunction;
  return fn?.value === EXPRESSION_FUNCTION_RESOLVE_VARIANT || fn?.name === "RESOLVE_VARIANT";
}

/**
 * Find the variant container that holds `symbolNode` as one of its
 * variants, walking up `parentIndex.guid`.
 *
 * Returns `undefined` for standalone SYMBOLs whose parent is not a
 * Variant Set. These never benefit from RESOLVE_VARIANT.
 *
 * A Variant Set on disk is a FRAME with:
 *   - `isStateGroup === true`
 *   - `componentPropDefs` containing at least one VARIANT-typed entry
 *
 * The on-disk schema has no COMPONENT_SET NodeType — see
 * `docs/refactor/component-type-cleanup.md`. The `Prop=Value` child
 * naming convention is decorative; Figma reconstructs displayed
 * labels from `stateGroupPropertyValueOrders` + `variantPropSpecs`,
 * not from names.
 */
function findVariantContainer(
  symbolNode: FigNode,
  document: FigKiwiDocumentIndex,
): FigNode | undefined {
  const parentGuid = symbolNode.parentIndex?.guid;
  if (!parentGuid) {
    return undefined;
  }
  const parent = findNodeByGuid(document, parentGuid);
  if (!parent) {
    return undefined;
  }
  if (isVariantSetFrame(parent)) {
    return parent;
  }
  return undefined;
}

/**
 * Parse a SYMBOL variant child's `variantPropSpecs` into a property
 * name → value map. The parent FRAME's `componentPropDefs` carries
 * the propDef id ⇄ name mapping; we look up names from there.
 *
 * Returns an empty map when the SYMBOL has no variant specs (i.e.
 * it is not a Variant Set child).
 */
function parseVariantPropertiesFromSpecs(
  variant: FigNode,
  container: FigNode,
): Map<string, string> {
  const out = new Map<string, string>();
  const specs = variant.variantPropSpecs ?? [];
  if (specs.length === 0) {
    return out;
  }
  const propDefs = container.componentPropDefs ?? [];
  const nameById = new Map<string, string>();
  for (const def of propDefs) {
    if (def.id && def.name) {
      nameById.set(guidToString(def.id), def.name);
    }
  }
  for (const spec of specs) {
    if (!spec.propDefId || spec.value === undefined) {
      continue;
    }
    const propName = nameById.get(guidToString(spec.propDefId));
    if (propName) {
      out.set(propName, spec.value);
    }
  }
  return out;
}

/**
 * From the RESOLVE_VARIANT expression's first argument, extract the
 * map of property name → resolved value. The first argument must be
 * a `mapValue`; each entry's `value.value` is the variable data we
 * want to resolve to a literal string (the name of the variant value
 * to select).
 *
 * We can resolve a `text`-kind literal directly. `alias`-kind values
 * point at variables — resolving them needs a local variable table
 * the .fig file doesn't carry for library aliases, so we surface
 * those as `undefined` and let the caller bail.
 */
function extractMapEntries(expr: FigVariableExpression): readonly FigVariableMapEntry[] | undefined {
  const firstArg = expr.expressionArguments?.[0];
  const projected = projectVariableAnyValue(firstArg?.value);
  if (projected?.kind !== "map") {
    return undefined;
  }
  return projected.value.values;
}

/**
 * Try to resolve a `VariableData` to its concrete property-value string.
 *
 * Local aliases are resolved against Kiwi VARIABLE nodes in the same
 * document, including the active `variableModeBySetMap`. Library-only
 * aliases whose VARIABLE node is not carried by this .fig remain
 * unresolved so target selection fails visibly instead of substituting.
 */
function resolveVariableLiteral(
  data: FigKiwiVariableData | undefined,
  input: {
    readonly document: FigKiwiDocumentIndex;
    readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  },
  seenVariableKeys: ReadonlySet<string> = new Set(),
): string | undefined {
  const projected = projectVariableAnyValue(data?.value);
  if (!projected) {
    return undefined;
  }
  if (projected.kind === "text") {
    return projected.value;
  }
  if (projected.kind === "bool") {
    return projected.value ? "true" : "false";
  }
  if (projected.kind === "float") {
    return String(projected.value);
  }
  if (projected.kind === "alias") {
    return resolveVariableAliasLiteral(projected.value, input, seenVariableKeys);
  }
  // color / expression / map — not directly a property literal.
  return undefined;
}

function resolveVariableAliasLiteral(
  id: FigVariableID,
  input: {
    readonly document: FigKiwiDocumentIndex;
    readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  },
  seenVariableKeys: ReadonlySet<string>,
): string | undefined {
  const aliased = resolveLocalVariableAliasData(id, input, seenVariableKeys);
  if (aliased === undefined) {
    return undefined;
  }
  const nextSeen = new Set([...seenVariableKeys, variableIdKey(id)]);
  return resolveVariableLiteral(aliased, input, nextSeen);
}

/**
 * Resolve a VariableData payload to a concrete color when the Kiwi
 * document carries the addressed VARIABLE node locally. Library-only
 * aliases remain unresolved (`undefined`) so callers can use a
 * document-observed materialized cache without inventing a value.
 */
export function resolveVariableColor(
  data: FigKiwiVariableData | undefined,
  input: {
    readonly document: FigKiwiDocumentIndex;
    readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  },
  seenVariableKeys: ReadonlySet<string> = new Set(),
): FigColor | undefined {
  const projected = projectVariableAnyValue(data?.value);
  if (projected === undefined) {
    return undefined;
  }
  if (projected.kind === "color") {
    return projected.value;
  }
  if (projected.kind === "alias") {
    return resolveVariableAliasColor(projected.value, input, seenVariableKeys);
  }
  throw new Error(`VariableResolver: expected COLOR variable value, got ${projected.kind}`);
}

function resolveVariableAliasColor(
  id: FigVariableID,
  input: {
    readonly document: FigKiwiDocumentIndex;
    readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  },
  seenVariableKeys: ReadonlySet<string>,
): FigColor | undefined {
  const aliased = resolveLocalVariableAliasData(id, input, seenVariableKeys);
  if (aliased === undefined) {
    return undefined;
  }
  const nextSeen = new Set([...seenVariableKeys, variableIdKey(id)]);
  return resolveVariableColor(aliased, input, nextSeen);
}

function resolveLocalVariableAliasData(
  id: FigVariableID,
  input: {
    readonly document: FigKiwiDocumentIndex;
    readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  },
  seenVariableKeys: ReadonlySet<string>,
): FigKiwiVariableData | undefined {
  const key = variableIdKey(id);
  if (seenVariableKeys.has(key)) {
    throw new Error(`VariableResolver: cyclic variable alias ${key}`);
  }
  const variable = resolveLocalVariableNode(id, input.document);
  if (variable === undefined) {
    return undefined;
  }
  const modeID = resolveVariableModeID(variable, input);
  return requireVariableDataForMode(variable, modeID);
}

function resolveLocalVariableNode(id: FigVariableID, document: FigKiwiDocumentIndex): FigNode | undefined {
  if ("assetRef" in id && id.assetRef !== undefined) {
    return findVariableNodeByAssetRef(document, id.assetRef);
  }
  if (!("sessionID" in id) || !("localID" in id)) {
    throw new Error("VariableResolver: VariableID must carry either assetRef or guid");
  }
  const node = findNodeByGuid(document, id);
  if (node === undefined) {
    throw new Error(`VariableResolver: local variable guid ${guidToString(id)} is missing from the Kiwi document`);
  }
  if (getNodeType(node) !== FIG_NODE_TYPE.VARIABLE) {
    throw new Error(`VariableResolver: local variable guid ${guidToString(id)} points to ${getNodeType(node)}`);
  }
  return node;
}

function findVariableNodeByAssetRef(document: FigKiwiDocumentIndex, ref: FigAssetRef): FigNode | undefined {
  const matches = document.nodeChanges.filter((node) => (
    getNodeType(node) === FIG_NODE_TYPE.VARIABLE &&
    node.key === ref.key &&
    (ref.version === undefined || node.version === ref.version)
  ));
  if (matches.length > 1) {
    throw new Error(`VariableResolver: assetRef ${variableIdKey({ assetRef: ref })} resolves to multiple local VARIABLE nodes`);
  }
  return matches[0];
}

function resolveVariableModeID(
  variable: FigNode,
  input: {
    readonly document: FigKiwiDocumentIndex;
    readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  },
): FigGuid {
  const variableSetID = variable.variableSetID;
  if (variableSetID === undefined) {
    throw new Error(`VariableResolver: VARIABLE ${guidToString(variable.guid)} is missing variableSetID`);
  }
  const selected = selectedVariableModeID(variableSetID, input.variableModeBySetMap);
  if (selected !== undefined) {
    return selected;
  }
  const valueEntries = variable.variableDataValues?.entries ?? [];
  if (valueEntries.length === 1) {
    return requireVariableDataValueModeID(variable, valueEntries[0]!);
  }
  return requireVariableSetDefaultModeID(variable, variableSetID, input.document);
}

function selectedVariableModeID(
  variableSetID: FigGuidOrAssetRefId,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): FigGuid | undefined {
  const entries = modeMap?.entries ?? [];
  if (entries.length === 0) {
    return undefined;
  }
  const setKey = variableIdKey(variableSetID);
  const matches = entries.filter((entry) => variableModeEntrySetKey(entry) === setKey);
  if (matches.length > 1) {
    throw new Error(`VariableResolver: variableModeBySetMap contains multiple entries for ${setKey}`);
  }
  const match = matches[0];
  if (match === undefined) {
    return undefined;
  }
  if (match.variableModeID === undefined) {
    throw new Error(`VariableResolver: variableModeBySetMap entry for ${setKey} is missing variableModeID`);
  }
  return match.variableModeID;
}

function requireVariableSetDefaultModeID(
  variable: FigNode,
  variableSetID: FigGuidOrAssetRefId,
  document: FigKiwiDocumentIndex,
): FigGuid {
  const set = resolveLocalVariableSetNode(variableSetID, document);
  if (set === undefined) {
    throw new Error(`VariableResolver: VARIABLE ${guidToString(variable.guid)} has multiple values but its VARIABLE_SET is missing`);
  }
  const first = set.variableSetModes?.[0];
  if (first === undefined) {
    throw new Error(`VariableResolver: VARIABLE_SET ${guidToString(set.guid)} has no variableSetModes`);
  }
  if (first.id === undefined) {
    throw new Error(`VariableResolver: VARIABLE_SET ${guidToString(set.guid)} has a mode without id`);
  }
  return first.id;
}

function resolveLocalVariableSetNode(id: FigGuidOrAssetRefId, document: FigKiwiDocumentIndex): FigNode | undefined {
  if (id.guid !== undefined) {
    return requireVariableSetNodeByGuid(document, id.guid);
  }
  if (id.assetRef !== undefined) {
    return findVariableSetNodeByAssetRef(document, id.assetRef);
  }
  throw new Error("VariableResolver: variableSetID must carry either guid or assetRef");
}

function requireVariableSetNodeByGuid(document: FigKiwiDocumentIndex, guid: FigGuid): FigNode {
  const node = findNodeByGuid(document, guid);
  if (node === undefined) {
    throw new Error(`VariableResolver: local VARIABLE_SET guid ${guidToString(guid)} is missing from the Kiwi document`);
  }
  if (getNodeType(node) !== FIG_NODE_TYPE.VARIABLE_SET) {
    throw new Error(`VariableResolver: local VARIABLE_SET guid ${guidToString(guid)} points to ${getNodeType(node)}`);
  }
  return node;
}

function findVariableSetNodeByAssetRef(document: FigKiwiDocumentIndex, ref: FigAssetRef): FigNode | undefined {
  const matches = document.nodeChanges.filter((node) => (
    getNodeType(node) === FIG_NODE_TYPE.VARIABLE_SET &&
    node.key === ref.key &&
    (ref.version === undefined || node.version === ref.version)
  ));
  if (matches.length > 1) {
    throw new Error(`VariableResolver: assetRef ${variableIdKey({ assetRef: ref })} resolves to multiple local VARIABLE_SET nodes`);
  }
  return matches[0];
}

function requireVariableDataForMode(variable: FigNode, modeID: FigGuid): FigKiwiVariableData {
  const valueEntries = variable.variableDataValues?.entries;
  if (valueEntries === undefined || valueEntries.length === 0) {
    throw new Error(`VariableResolver: VARIABLE ${guidToString(variable.guid)} has no variableDataValues`);
  }
  const matches = valueEntries.filter((entry) => figGuidEquals(entry.modeID, modeID));
  if (matches.length !== 1) {
    throw new Error(
      `VariableResolver: VARIABLE ${guidToString(variable.guid)} has ${matches.length} values for mode ${guidToString(modeID)}`,
    );
  }
  const data = matches[0]!.variableData;
  if (data === undefined) {
    throw new Error(`VariableResolver: VARIABLE ${guidToString(variable.guid)} mode ${guidToString(modeID)} is missing variableData`);
  }
  return data;
}

function requireVariableDataValueModeID(
  variable: FigNode,
  entry: NonNullable<FigNode["variableDataValues"]>["entries"][number],
): FigGuid {
  if (entry.modeID === undefined) {
    throw new Error(`VariableResolver: VARIABLE ${guidToString(variable.guid)} has a variableDataValues entry without modeID`);
  }
  return entry.modeID;
}

function variableModeEntrySetKey(entry: FigKiwiVariableModeBySetMapEntry): string {
  const variableSetID = entry.variableSetID;
  if (variableSetID === undefined) {
    throw new Error("VariableResolver: variableModeBySetMap entry is missing variableSetID");
  }
  return variableIdKey(variableSetID);
}

function figGuidEquals(left: FigGuid | undefined, right: FigGuid): boolean {
  return left !== undefined && left.sessionID === right.sessionID && left.localID === right.localID;
}

/**
 * Score a candidate variant against the requested property-value
 * map. Higher is better; -1 means "mismatch" (a property the
 * map demands has a different value on this variant). When all
 * properties tie (or the map is empty), the function returns 0 so
 * the caller's tie-breaker (authored order) decides.
 */
function scoreVariant(
  variant: FigNode,
  container: FigNode,
  requestedProps: ReadonlyMap<string, string>,
): number {
  const variantProps = parseVariantPropertiesFromSpecs(variant, container);
  const scores: number[] = Array.from(requestedProps, ([k, v]) => {
    const variantValue = variantProps.get(k);
    if (variantValue === undefined) {
      // Property not present on this variant — neutral.
      return 0;
    }
    if (variantValue === v) {
      return 1;
    }
    return -1;
  });
  if (scores.includes(-1)) {
    return -1;
  }
  return scores.reduce((total, score) => total + score, 0);
}

/**
 * Result of evaluating RESOLVE_VARIANT for an INSTANCE.
 */
export type ResolveVariantResult = {
  /**
   * The variant whose properties best match. `undefined` when no
   * reliable match could be made (see file header for cases).
   */
  readonly resolvedSymbolID: FigGuid | undefined;
  /**
   * Reason for `undefined` when applicable — exposed so the renderer
   * can log/inspect why a variant couldn't be resolved without
   * having to re-derive the diagnostic.
   */
  readonly unresolvedReason?:
    | "no-vcm-expression"
    | "not-resolve-variant"
    | "no-map-arg"
    | "no-variant-container"
    | "unresolved-aliases";
};

/**
 * Evaluate RESOLVE_VARIANT for an INSTANCE. Returns the variant's
 * symbol GUID only when Kiwi carries enough local data for a clear
 * variant match. `undefined` means the expression is not a local
 * variant-selection SoT; SymbolResolver still owns the final target
 * choice and may use the INSTANCE's authored `symbolID`.
 */
export function resolveVariantOverride(
  instance: FigNode,
  symbolNode: FigNode,
  input: {
    readonly document: FigKiwiDocumentIndex;
    readonly childrenOf: (node: FigNode) => readonly FigNode[];
    readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  },
): ResolveVariantResult {
  const located = findVariantConsumptionExpression(instance);
  if (!located) {
    return { resolvedSymbolID: undefined, unresolvedReason: "no-vcm-expression" };
  }
  if (!isResolveVariant(located.expression)) {
    return { resolvedSymbolID: undefined, unresolvedReason: "not-resolve-variant" };
  }
  const mapEntries = extractMapEntries(located.expression);
  if (!mapEntries || mapEntries.length === 0) {
    return { resolvedSymbolID: undefined, unresolvedReason: "no-map-arg" };
  }
  const container = findVariantContainer(symbolNode, input.document);
  if (!container) {
    return { resolvedSymbolID: undefined, unresolvedReason: "no-variant-container" };
  }

  // Resolve each map entry to a literal property-value string. When
  // any entry is a library alias, there is no local Kiwi value to
  // compare. A partial resolution would silently pick a different
  // variant, so SymbolResolver must keep the authored target instead.
  const requestedProps = parseVariantPropertiesFromSpecs(symbolNode, container);
  for (const entry of mapEntries) {
    const literal = resolveVariableLiteral(entry.value, input);
    if (literal === undefined) {
      return { resolvedSymbolID: undefined, unresolvedReason: "unresolved-aliases" };
    }
    requestedProps.set(entry.key, literal);
  }

  // Score each variant; pick the highest. Authored order breaks ties.
  const variants = input.childrenOf(container).filter((c): c is FigNode => getNodeType(c) === FIG_NODE_TYPE.SYMBOL);
  const best = variants.reduce<{ readonly node: FigNode; readonly score: number } | undefined>((current, variant) => {
    const score = scoreVariant(variant, container, requestedProps);
    if (current === undefined || score > current.score) {
      return { node: variant, score };
    }
    return current;
  }, undefined);
  if (best === undefined || best.score < 0) {
    return { resolvedSymbolID: undefined, unresolvedReason: "no-variant-container" };
  }
  return { resolvedSymbolID: best.node.guid };
}
