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
 *           target is a library variable that this fig file doesn't
 *           include — Figma's exporter pre-bakes those references but
 *           when we render from the .fig directly we have no value).
 *
 * The `(c)` case is the dominant outcome on real-world .fig corpora:
 * every RESOLVE_VARIANT we observe references library `assetRef`
 * aliases whose values aren't carried in the .fig. Returning
 * `undefined` reports that this evaluator cannot derive a local
 * override; SymbolResolver remains the single unit that chooses the
 * effective symbol target from the authored Kiwi fields.
 */

import type {
  FigGuid,
  FigKiwiVariableData,
  FigVariableExpression,
  FigVariableMapEntry,
  FigKiwiVariableDataMap,
  FigNode,
} from "../types";
import { FIG_NODE_TYPE } from "../types";
import { findNodeByGuid, getNodeType, guidToString, type FigKiwiDocumentIndex } from "../domain";
import { isVariantSetFrame } from "./variant-set-kiwi";
import { projectVariableAnyValue } from "../variables";

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
 * Try to resolve a `VariableData` to its concrete property-value
 * string. Returns `undefined` when the value is an alias to a
 * library-only variable whose value is not carried by this .fig.
 *
 * (Local-variable aliasing — `alias` pointing at a `FigGuid` whose
 * variable definition lives in the same .fig — would also need a
 * variable resolver wired in here. Until that arrives we stay
 * conservative: only literal `text` and `bool` values resolve.)
 */
function resolveVariableLiteral(data: FigKiwiVariableData | undefined): string | undefined {
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
  // alias / color / expression / map — not directly a property literal.
  return undefined;
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
  },
): ResolveVariantResult {
  const located = findVariableConsumptionExpression(instance.variableConsumptionMap);
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
  const requestedProps = new Map<string, string>();
  for (const entry of mapEntries) {
    const literal = resolveVariableLiteral(entry.value);
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
