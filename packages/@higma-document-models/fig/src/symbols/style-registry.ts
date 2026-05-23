/**
 * @file Style Registry — resolves styleId references to FigPaint arrays
 *
 * Figma's .fig format uses `styleIdForFill` / `styleIdForStrokeFill` to
 * reference shared styles. A `FigStyleId` carries up to two reference
 * keys:
 *
 * 1. `guid` — a local GUID pointing at a style-definition node in the
 *    same file.
 * 2. `assetRef.key` — a team-library asset key pointing at a style
 *    imported from another Figma file. Figma emits a local proxy node
 *    (typically on the Internal Only Canvas) whose own `key` matches
 *    this assetRef.key and whose own `styleType` + paint array carry
 *    the authoritative paint.
 *
 * SoT (Source of Truth) summary:
 *
 *  - The paint of a style-definition node lives in exactly one place,
 *    determined by `styleType`: `FILL` styles store paint in
 *    `fillPaints`, `STROKE` styles in `strokePaints`. Anything else
 *    (no `styleType` set, or `styleType` outside the paint family)
 *    is not a style-definition node from the registry's perspective.
 *
 *  - Consumers may reference the same style as either a fill (via
 *    `styleIdForFill`) or a stroke (via `styleIdForStrokeFill`); these
 *    intents are independent of where the paint is stored on the
 *    style. The registry therefore exposes a single map keyed by
 *    `guidToString(...)` or `assetRef.key`, returning the same paint
 *    array regardless of how the consumer intends to use it.
 *
 *  - Both key namespaces share one map: GUID strings have the form
 *    "sessionID:localID" (digits + colon only) whereas assetRef keys
 *    are hex content hashes — they don't collide.
 *
 * Dangling references: a consumer's `styleIdForFill` /
 * `styleIdForStrokeFill` may carry a key whose target is not in the
 * registry. This is a normal state for Figma Community-distributed
 * `.fig` files — team-library proxies are routinely stripped on export
 * for licensing reasons, and intra-file refs occasionally point at
 * non-style nodes (e.g. a stale guid pointing at a now-FRAME node).
 * Figma itself renders such cases using the consumer's own embedded
 * `fillPaints` / `strokePaints` fields. The resolution functions therefore
 * return `undefined` for dangling refs so the caller uses the embedded
 * paint as the only local SoT, matching Figma's actual behaviour. A successful
 * registry lookup wins over the embedded cache for ordinary static styles.
 * Variable-bound styles are not an exception to this ownership rule: the
 * registry carries the style definition, and the registry also carries the
 * document-wide variable materialization table used to evaluate that
 * definition for a selected mode. Consumer paint arrays remain a cache; they
 * are authoritative only when the style reference itself is absent or
 * dangling.
 */

import type {
  FigColor,
  FigColorStopVar,
  FigKiwiVariableData,
  FigKiwiVariableModeBySetMap,
  FigGuidOrAssetRefId,
  FigNode,
  FigPaint,
  FigSolidPaint,
  FigStyleId,
  FigEffect,
  MutableFigNode,
  FigVariableID,
} from "../types";
import {
  getNodeType,
  guidToString,
  type FigKiwiDocumentIndex,
  type FigStyleRegistry,
  type FigTextStyleProperties,
} from "../domain";
import { projectVariableAnyValue, variableIdKey } from "../variables";
import { mergeVariableModeBySetMap, resolveVariableColor } from "./variable-resolution";
import { asSolidPaint } from "../color";

// =============================================================================
// Construction
// =============================================================================

/**
 * Extract the lookup key for a style reference.
 *
 * Prefers `guid` over `assetRef.key` when both are present: same-file
 * references are considered authoritative. Returns undefined when the
 * reference carries neither.
 */
export function styleRefKey(ref: FigStyleId | undefined): string | undefined {
  if (!ref) { return undefined; }
  if (ref.guid) { return guidToString(ref.guid); }
  if (ref.assetRef?.key) { return ref.assetRef.key; }
  return undefined;
}

/**
 * Extract all lookup keys carried by a style reference.
 *
 * When both `guid` and `assetRef.key` are present, either may resolve —
 * consumers try keys in preference order (guid, then assetRef) until one
 * hits. Returning both keeps `styleRefKey` simple for the common case
 * while still supporting files where the guid is dangling but the
 * asset-ref proxy is present.
 */
export function styleRefKeys(ref: FigStyleId | undefined): readonly string[] {
  if (!ref) { return []; }
  const keys: string[] = [];
  if (ref.guid) { keys.push(guidToString(ref.guid)); }
  if (ref.assetRef?.key) { keys.push(ref.assetRef.key); }
  return keys;
}

/**
 * Pull the authoritative payload out of a style-definition node, choosing
 * the field implied by `styleType`:
 *
 *   FILL    → `fillPaints`     (paint array)
 *   STROKE  → `strokePaints`   (paint array)
 *   EFFECT  → `effects`        (effect array)
 *   TEXT    → text properties  (font/size/line-height/...)
 *   GRID    → `layoutGrids`    (layout-grid array, opaque to us)
 *
 * Returns `undefined` for non-style-definition nodes and for definitions
 * whose implied field is missing (treated as "this style has no local
 * payload"; consumers use their embedded cache as the only local SoT).
 *
 * The dispatch is type-driven, never consumer-intent-driven: a FILL
 * style stores its paint in `fillPaints` regardless of whether the
 * consumer references it via `styleIdForFill` or `styleIdForStrokeFill`.
 * The single-namespace registry maps below preserve that property.
 */
type StyleDefinitionEntry =
  | { readonly kind: "paint"; readonly paints: readonly FigPaint[] }
  | { readonly kind: "effect"; readonly effects: readonly FigEffect[] }
  | { readonly kind: "text"; readonly properties: FigTextStyleProperties }
  | { readonly kind: "grid"; readonly layoutGrids: readonly unknown[] };

function readStyleDefinition(node: FigNode): StyleDefinitionEntry | undefined {
  const typeName = node.styleType?.name;
  if (typeName === "FILL") {
    return readPaintStyleDefinition(node.fillPaints);
  }
  if (typeName === "STROKE") {
    return readPaintStyleDefinition(node.strokePaints);
  }
  if (typeName === "EFFECT") {
    return readEffectStyleDefinition(node.effects);
  }
  if (typeName === "TEXT") {
    return readTextStyleDefinition(node);
  }
  if (typeName === "GRID") {
    return readGridStyleDefinition(node.layoutGrids);
  }
  return undefined;
}

function readTextStyleDefinition(node: FigNode): StyleDefinitionEntry | undefined {
  const properties = readTextStyleProperties(node);
  if (properties === undefined) {
    return undefined;
  }
  return { kind: "text", properties };
}

function readPaintStyleDefinition(paints: readonly FigPaint[] | undefined): StyleDefinitionEntry | undefined {
  if (paints === undefined || paints.length === 0) {
    return undefined;
  }
  return { kind: "paint", paints };
}

function readEffectStyleDefinition(effects: readonly FigEffect[] | undefined): StyleDefinitionEntry | undefined {
  if (effects === undefined || effects.length === 0) {
    return undefined;
  }
  return { kind: "effect", effects };
}

function readGridStyleDefinition(grids: FigNode["layoutGrids"]): StyleDefinitionEntry | undefined {
  if (!Array.isArray(grids) || grids.length === 0) {
    return undefined;
  }
  return { kind: "grid", layoutGrids: grids as readonly unknown[] };
}

/**
 * Extract the property bag a TEXT-type style-definition node contributes.
 *
 * A TEXT style may set any subset of the typical text properties; only
 * the explicitly-set ones are part of its definition (the rest leave
 * the consumer's local values intact). Returns `undefined` when no
 * property is set, signalling the style contributes nothing.
 */
function readTextStyleProperties(node: FigNode): FigTextStyleProperties | undefined {
  const properties: FigTextStyleProperties = {
    fontName: node.fontName,
    fontSize: node.fontSize,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    textCase: node.textCase,
    textDecoration: node.textDecoration,
    textTracking: node.textTracking,
    fontVariations: node.fontVariations,
  };
  const hasAny =
    properties.fontName !== undefined ||
    properties.fontSize !== undefined ||
    properties.lineHeight !== undefined ||
    properties.letterSpacing !== undefined ||
    properties.textCase !== undefined ||
    properties.textDecoration !== undefined ||
    properties.textTracking !== undefined ||
    (Array.isArray(properties.fontVariations) && properties.fontVariations.length > 0);
  if (!hasAny) { return undefined; }
  return properties;
}

/**
 * Build a style registry from the Kiwi document index.
 *
 * Walks every node and indexes the ones that are style definitions
 * (`styleType` set). Each style is registered under its GUID (via
 * `guidToString`) and, when present, its `key` (assetRef hash). The
 * two namespaces share one map per StyleType because their string
 * forms can't collide ("session:local" vs hex digest).
 *
 * Five Kiwi `StyleType` values get their own map so consumers can
 * resolve with type-correct value shapes without a runtime tag check.
 */
export function buildFigStyleRegistry(document: FigKiwiDocumentIndex): FigStyleRegistry {
  return buildFigStyleRegistryFromDocuments([document]);
}

/** Build one style registry from the primary Kiwi document plus explicit source documents. */
export function buildFigStyleRegistryFromDocuments(
  documents: readonly FigKiwiDocumentIndex[],
): FigStyleRegistry {
  if (documents.length === 0) {
    throw new Error("StyleRegistry: at least one Kiwi document source is required");
  }
  const paints = new Map<string, readonly FigPaint[]>();
  const effects = new Map<string, readonly FigEffect[]>();
  const textProperties = new Map<string, FigTextStyleProperties>();
  const layoutGrids = new Map<string, readonly unknown[]>();
  const variableColorMaterializations = buildVariableColorMaterializations(documents);
  for (const document of documents) {
    for (const node of document.nodeChanges) {
      const entry = readStyleDefinition(node);
      if (!entry) { continue; }
      indexEntryUnderKeys(node, entry, { paints, effects, textProperties, layoutGrids });
    }
  }
  return { paints, effects, textProperties, layoutGrids, variableColorMaterializations };
}

function buildVariableColorMaterializations(documents: readonly FigKiwiDocumentIndex[]): ReadonlyMap<string, FigColor> {
  const primary = documents[0];
  if (primary === undefined) {
    throw new Error("StyleRegistry: at least one Kiwi document source is required for variable materialization");
  }
  const colors = new Map<string, FigColor>();
  for (const document of documents) {
    indexLocalVariableColorMaterializations(document, colors);
  }
  for (const root of primary.roots) {
    indexVariableColorMaterializationsForSubtree(root, primary.childrenOf, undefined, colors);
  }
  return colors;
}

function indexLocalVariableColorMaterializations(
  document: FigKiwiDocumentIndex,
  colors: Map<string, FigColor>,
): void {
  for (const node of document.nodeChanges) {
    if (getNodeType(node) !== "VARIABLE") {
      continue;
    }
    indexLocalVariableColorMaterializationsForNode(node, document, colors);
  }
}

function indexLocalVariableColorMaterializationsForNode(
  node: FigNode,
  document: FigKiwiDocumentIndex,
  colors: Map<string, FigColor>,
): void {
  if (node.variableResolvedType?.name !== "COLOR") {
    return;
  }
  const variableSetID = node.variableSetID;
  if (variableSetID === undefined) {
    throw new Error(`StyleRegistry: VARIABLE ${formatNodeLocator(node)} is missing variableSetID`);
  }
  const valueEntries = node.variableDataValues?.entries;
  if (valueEntries === undefined || valueEntries.length === 0) {
    throw new Error(`StyleRegistry: VARIABLE ${formatNodeLocator(node)} has no variableDataValues`);
  }
  const variableIDs = variableNodeReferenceIDs(node);
  for (const entry of valueEntries) {
    if (entry.modeID === undefined) {
      throw new Error(`StyleRegistry: VARIABLE ${formatNodeLocator(node)} has a variableDataValues entry without modeID`);
    }
    const color = resolveVariableColor(entry.variableData, {
      document,
      variableModeBySetMap: {
        entries: [{ variableSetID, variableModeID: entry.modeID }],
      },
    });
    if (color === undefined) {
      continue;
    }
    for (const variableID of variableIDs) {
      setVariableColorMaterialization(
        colors,
        localVariableColorMaterializationKey(variableID, variableSetID, entry.modeID),
        color,
        `${formatNodeLocator(node)}.variableDataValues[${guidToString(entry.modeID)}]`,
      );
    }
  }
}

function variableNodeReferenceIDs(node: FigNode): readonly FigVariableID[] {
  const ids: FigVariableID[] = [node.guid];
  if (typeof node.key !== "string" || node.key.length === 0) {
    return ids;
  }
  if (typeof node.version !== "string" || node.version.length === 0) {
    return [...ids, { assetRef: { key: node.key } }];
  }
  return [...ids, { assetRef: { key: node.key, version: node.version } }];
}

function indexVariableColorMaterializationsForSubtree(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
  inheritedModeMap: FigKiwiVariableModeBySetMap | undefined,
  colors: Map<string, FigColor>,
): void {
  const modeMap = mergeVariableModeBySetMap(inheritedModeMap, node.variableModeBySetMap);
  indexVariableColorMaterializationsForNode(node, modeMap, colors);
  for (const child of childrenOf(node)) {
    indexVariableColorMaterializationsForSubtree(child, childrenOf, modeMap, colors);
  }
}

function indexVariableColorMaterializationsForNode(
  node: FigNode,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
  colors: Map<string, FigColor>,
): void {
  indexPaintListVariableColorMaterializations(node.fillPaints, modeMap, colors, `${formatNodeLocator(node)}.fillPaints`);
  indexPaintListVariableColorMaterializations(node.strokePaints, modeMap, colors, `${formatNodeLocator(node)}.strokePaints`);
  indexPaintListVariableColorMaterializations(node.backgroundPaints, modeMap, colors, `${formatNodeLocator(node)}.backgroundPaints`);
}

function indexPaintListVariableColorMaterializations(
  paints: readonly FigPaint[] | undefined,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
  colors: Map<string, FigColor>,
  subject: string,
): void {
  if (paints === undefined) {
    return;
  }
  paints.forEach((paint, index) => {
    indexPaintVariableColorMaterializations(paint, modeMap, colors, `${subject}[${index}]`);
  });
}

function indexPaintVariableColorMaterializations(
  paint: FigPaint,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
  colors: Map<string, FigColor>,
  subject: string,
): void {
  if (paintHasColor(paint)) {
    indexVariableDataColorMaterialization(paint.colorVar, paint.color, modeMap, colors, `${subject}.colorVar`);
  }
  if (!paintHasStopsVar(paint)) {
    return;
  }
  paint.stopsVar.forEach((stop, index) => {
    if (stop.color === undefined) {
      return;
    }
    indexVariableDataColorMaterialization(stop.colorVar, stop.color, modeMap, colors, `${subject}.stopsVar[${index}].colorVar`);
  });
}

function indexVariableDataColorMaterialization(
  data: FigKiwiVariableData | undefined,
  color: FigColor,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
  colors: Map<string, FigColor>,
  subject: string,
): void {
  const key = observedVariableColorMaterializationKey(data, modeMap);
  if (key === undefined) {
    return;
  }
  setVariableColorMaterialization(colors, key, color, subject);
}

function setVariableColorMaterialization(
  colors: Map<string, FigColor>,
  key: string,
  color: FigColor,
  subject: string,
): void {
  const existing = colors.get(key);
  if (existing === undefined) {
    colors.set(key, color);
    return;
  }
  if (figColorEquals(existing, color)) {
    return;
  }
  throw new Error(`${subject} conflicts with an existing Kiwi variable color materialization for ${key}`);
}

function indexEntryUnderKeys(
  node: FigNode,
  entry: StyleDefinitionEntry,
  maps: {
    readonly paints: Map<string, readonly FigPaint[]>;
    readonly effects: Map<string, readonly FigEffect[]>;
    readonly textProperties: Map<string, FigTextStyleProperties>;
    readonly layoutGrids: Map<string, readonly unknown[]>;
  },
): void {
  const keys = nodeRegistryKeys(node);
  if (keys.length === 0) { return; }
  if (entry.kind === "paint") {
    for (const key of keys) { setRegistryEntry(maps.paints, key, entry.paints, node); }
    return;
  }
  if (entry.kind === "effect") {
    for (const key of keys) { setRegistryEntry(maps.effects, key, entry.effects, node); }
    return;
  }
  if (entry.kind === "text") {
    for (const key of keys) { setRegistryEntry(maps.textProperties, key, entry.properties, node); }
    return;
  }
  for (const key of keys) { setRegistryEntry(maps.layoutGrids, key, entry.layoutGrids, node); }
}

function setRegistryEntry<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  node: FigNode,
): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, value);
    return;
  }
  if (existing === value) {
    return;
  }
  throw new Error(`StyleRegistry: ${formatNodeLocator(node)} conflicts with an existing Kiwi style definition for ${key}`);
}

function nodeRegistryKeys(node: FigNode): readonly string[] {
  const keys: string[] = [];
  if (node.guid) { keys.push(guidToString(node.guid)); }
  if (typeof node.key === "string" && node.key.length > 0) { keys.push(node.key); }
  return keys;
}

/**
 * Generic registry-key resolver. Tries the `guid` form first (authoritative
 * same-file reference) then the `assetRef.key` form (team-library import).
 * The sentinel guid `0xffffffff:0xffffffff` is treated as "no guid".
 *
 * Returns `undefined` for empty references and for dangling references
 * (key carried but absent from the supplied map). Per-StyleType resolvers
 * call this against their own map.
 */
function lookupRegistryEntry<V>(
  ref: FigStyleId | undefined,
  byKey: ReadonlyMap<string, V>,
): V | undefined {
  if (!ref) { return undefined; }
  const guidHit = lookupGuidRegistryEntry(ref, byKey);
  if (guidHit !== undefined) {
    return guidHit;
  }
  const assetKey = ref.assetRef?.key;
  if (assetKey === undefined) {
    return undefined;
  }
  return byKey.get(assetKey);
}

function lookupGuidRegistryEntry<V>(
  ref: FigStyleId,
  byKey: ReadonlyMap<string, V>,
): V | undefined {
  if (ref.guid === undefined || isSentinelGuid(ref.guid)) {
    return undefined;
  }
  return byKey.get(guidToString(ref.guid));
}

/**
 * Sentinel guid (`0xffffffff:0xffffffff`) Figma uses to mean "no reference"
 * inside a `FigStyleId` slot — the field is structurally present but
 * carries no actual guid. The Kiwi schema reserves uint32 max in both
 * components to distinguish "no guid" from a real same-file reference.
 */
const NO_REF_SENTINEL = 0xffffffff;

function isSentinelGuid(guid: FigStyleId["guid"]): boolean {
  if (!guid) { return false; }
  return guid.sessionID === NO_REF_SENTINEL && guid.localID === NO_REF_SENTINEL;
}

/**
 * Whether a style reference carries any lookup key. An empty `FigStyleId`
 * (object present but no guid and no assetRef.key) and a reference whose
 * only guid is the `0xffffffff:0xffffffff` "no-ref" sentinel are both
 * treated as "no reference", since no lookup can succeed against them.
 */
export function styleRefHasKey(ref: FigStyleId | undefined): ref is FigStyleId {
  if (!ref) { return false; }
  if (ref.guid && !isSentinelGuid(ref.guid)) { return true; }
  if (typeof ref.assetRef?.key === "string" && ref.assetRef.key.length > 0) { return true; }
  return false;
}

/**
 * Resolve a paint reference through the registry — the lookup primitive
 * for FILL / STROKE styles.
 *
 * Three outcomes:
 *
 *  - the reference is empty (no guid, no assetRef.key, or the
 *    `0xffffffff:0xffffffff` no-ref sentinel) → `undefined`.
 *  - the reference resolves through the registry → the registry's
 *    paint array (authoritative).
 *  - the reference carries a key but the registry has no matching
 *    entry (a dangling ref) → `undefined`. Figma's exporter routinely
 *    emits dangling refs (team-library proxies stripped from
 *    Community files, intra-file guids that point at non-style nodes
 *    such as a stale FRAME guid) and Figma itself renders such cases
 *    using the consumer's embedded paint cache. Failing fast would
 *    refuse to open normal `.fig` files.
 *
 * This is the **lookup** SoT. Consumers that want "registry-or-embedded"
 * semantics should call `resolveStyledPaint` instead.
 */
export function resolvePaintRef(
  ref: FigStyleId | undefined,
  registry: FigStyleRegistry,
): readonly FigPaint[] | undefined {
  if (!styleRefHasKey(ref)) { return undefined; }
  return lookupRegistryEntry(ref, registry.paints);
}

/**
 * Resolve an effect reference through the registry — the lookup
 * primitive for EFFECT styles. Same dangling-ref semantics as
 * `resolvePaintRef`.
 */
export function resolveEffectsRef(
  ref: FigStyleId | undefined,
  registry: FigStyleRegistry,
): readonly FigEffect[] | undefined {
  if (!styleRefHasKey(ref)) { return undefined; }
  return lookupRegistryEntry(ref, registry.effects);
}

/**
 * Resolve a text-style reference through the registry — the lookup
 * primitive for TEXT styles. Returns the property bag the style sets
 * (any subset of font/size/line-height/letter-spacing/case/decoration);
 * dangling refs and empty refs both yield `undefined`.
 */
export function resolveTextStyleRef(
  ref: FigStyleId | undefined,
  registry: FigStyleRegistry,
): FigTextStyleProperties | undefined {
  if (!styleRefHasKey(ref)) { return undefined; }
  return lookupRegistryEntry(ref, registry.textProperties);
}

/**
 * Resolve a grid reference through the registry — the lookup primitive
 * for GRID styles. The value is opaque (Kiwi `LayoutGrid[]`); decoders
 * walk the array themselves. Same dangling-ref semantics as the
 * paint resolver.
 */
export function resolveGridRef(
  ref: FigStyleId | undefined,
  registry: FigStyleRegistry,
): readonly unknown[] | undefined {
  if (!styleRefHasKey(ref)) { return undefined; }
  return lookupRegistryEntry(ref, registry.layoutGrids);
}

/**
 * Resolve the authoritative paint for a styled element — the SoT.
 *
 * Every consumer of `styleIdForFill` / `styleIdForStrokeFill` /
 * per-override `styleIdForFill` answers the same question: "given a
 * style reference and an embedded paint cache, which paints are
 * authoritative?". The answer is uniform:
 *
 *   1. If the registry resolves a static style reference, the registry
 *      value wins — it's the file-level style definition SoT and is the
 *      right value even when the embedded cache is structurally identical.
 *   2. Otherwise the embedded cache (the consumer's own
 *      `fillPaints` / `strokePaints` / override `fillPaints`) is the
 *      SoT. This matches Figma's rendering for dangling refs and is
 *      the only value present when the consumer carries no styleId.
 *
 * Returns `undefined` only when both the ref and the embedded cache
 * are absent. Empty embedded arrays are preserved (they
 * represent "explicitly no paint", not "no value").
 */
export function resolveStyledPaint(
  ref: FigStyleId | undefined,
  embedded: readonly FigPaint[] | undefined,
  registry: FigStyleRegistry,
  options?: { readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap },
): readonly FigPaint[] | undefined {
  const registryPaints = resolvePaintRef(ref, registry);
  if (registryPaints === undefined) {
    return materializeVariablePaintColors(embedded, registry, options?.variableModeBySetMap);
  }
  return materializeVariablePaintColors(registryPaints, registry, options?.variableModeBySetMap);
}

function hasSelectedVariableMode(modeMap: FigKiwiVariableModeBySetMap | undefined): boolean {
  return (modeMap?.entries ?? []).length > 0;
}

function materializeVariablePaintColors(
  paints: readonly FigPaint[] | undefined,
  registry: FigStyleRegistry,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): readonly FigPaint[] | undefined {
  if (paints === undefined || !hasSelectedVariableMode(modeMap) || registry.variableColorMaterializations.size === 0) {
    return paints;
  }
  const next = paints.map((paint) => materializeVariablePaintColor(paint, registry, modeMap));
  if (next.every((paint, index) => paint === paints[index])) {
    return paints;
  }
  return next;
}

function materializeVariablePaintColor(
  paint: FigPaint,
  registry: FigStyleRegistry,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): FigPaint {
  const colorMaterialized = materializePaintColor(paint, registry, modeMap);
  return materializePaintStopColors(colorMaterialized, registry, modeMap);
}

function materializePaintColor(
  paint: FigPaint,
  registry: FigStyleRegistry,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): FigPaint {
  const solidPaint = asSolidPaint(paint);
  if (solidPaint === undefined) { return paint; }
  const color = resolveVariableMaterializedColor(paint.colorVar, registry, modeMap);
  if (color === undefined) {
    return paint;
  }
  return materializeSolidPaintColor(solidPaint, color);
}

function materializeSolidPaintColor(paint: FigSolidPaint, color: FigColor): FigSolidPaint {
  const materializedColor = { r: color.r, g: color.g, b: color.b, a: 1 };
  if (figColorEquals(materializedColor, paint.color) && paint.opacity === color.a) {
    return paint;
  }
  return {
    ...paint,
    color: materializedColor,
    opacity: color.a,
  };
}

function materializePaintStopColors(
  paint: FigPaint,
  registry: FigStyleRegistry,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): FigPaint {
  if (!paintHasStopsVar(paint)) {
    return paint;
  }
  const stopsVar = paint.stopsVar.map((stop) => materializeColorStopVar(stop, registry, modeMap));
  if (stopsVar.every((stop, index) => stop === paint.stopsVar[index])) {
    return paint;
  }
  return { ...paint, stopsVar };
}

function materializeColorStopVar(
  stop: FigColorStopVar,
  registry: FigStyleRegistry,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): FigColorStopVar {
  const color = resolveVariableMaterializedColor(stop.colorVar, registry, modeMap);
  if (color === undefined) {
    return stop;
  }
  if (stop.color !== undefined && figColorEquals(color, stop.color)) {
    return stop;
  }
  return { ...stop, color };
}

function resolveVariableMaterializedColor(
  data: FigKiwiVariableData | undefined,
  registry: FigStyleRegistry,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): FigColor | undefined {
  const local = resolveLocalVariableMaterializedColor(data, registry, modeMap);
  if (local !== undefined) {
    return local;
  }
  const key = observedVariableColorMaterializationKey(data, modeMap);
  if (key === undefined) {
    return undefined;
  }
  return registry.variableColorMaterializations.get(key);
}

function resolveLocalVariableMaterializedColor(
  data: FigKiwiVariableData | undefined,
  registry: FigStyleRegistry,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): FigColor | undefined {
  const value = projectVariableAnyValue(data?.value);
  if (value?.kind !== "alias") {
    return undefined;
  }
  const entries = modeMap?.entries ?? [];
  const hits = entries
    .map((entry) => registry.variableColorMaterializations.get(localVariableColorMaterializationKeyForModeEntry(value.value, entry)))
    .filter((color): color is FigColor => color !== undefined);
  if (hits.length === 0) {
    return undefined;
  }
  const first = hits[0]!;
  if (hits.every((color) => figColorEquals(color, first))) {
    return first;
  }
  throw new Error(`StyleRegistry: local VARIABLE color ${variableIdKey(value.value)} resolves to conflicting selected modes`);
}

function observedVariableColorMaterializationKey(
  data: FigKiwiVariableData | undefined,
  modeMap: FigKiwiVariableModeBySetMap | undefined,
): string | undefined {
  const value = projectVariableAnyValue(data?.value);
  if (value?.kind !== "alias") {
    return undefined;
  }
  const modeKey = variableModeMapKey(modeMap);
  if (modeKey === undefined) {
    return undefined;
  }
  return `observed:${variableIdKey(value.value)}|${modeKey}`;
}

function localVariableColorMaterializationKeyForModeEntry(
  variableID: FigVariableID,
  entry: FigKiwiVariableModeBySetMap["entries"][number],
): string {
  const variableSetID = entry.variableSetID;
  const modeID = entry.variableModeID;
  if (variableSetID === undefined) {
    throw new Error("StyleRegistry: variableModeBySetMap entry is missing variableSetID");
  }
  if (modeID === undefined) {
    throw new Error("StyleRegistry: variableModeBySetMap entry is missing variableModeID");
  }
  return localVariableColorMaterializationKey(variableID, variableSetID, modeID);
}

function localVariableColorMaterializationKey(
  variableID: FigVariableID,
  variableSetID: FigGuidOrAssetRefId,
  modeID: { readonly sessionID: number; readonly localID: number },
): string {
  return `local:${variableIdKey(variableID)}|${variableIdKey(variableSetID)}@${guidToString(modeID)}`;
}

function variableModeMapKey(modeMap: FigKiwiVariableModeBySetMap | undefined): string | undefined {
  const entries = modeMap?.entries ?? [];
  if (entries.length === 0) {
    return undefined;
  }
  return entries.map(variableModeEntryKey).sort().join(",");
}

function variableModeEntryKey(entry: FigKiwiVariableModeBySetMap["entries"][number]): string {
  const setID = entry.variableSetID;
  const modeID = entry.variableModeID;
  if (setID === undefined) {
    throw new Error("StyleRegistry: variableModeBySetMap entry is missing variableSetID");
  }
  if (modeID === undefined) {
    throw new Error("StyleRegistry: variableModeBySetMap entry is missing variableModeID");
  }
  return `${variableIdKey(setID)}@${guidToString(modeID)}`;
}

function paintHasColor(paint: FigPaint): paint is FigPaint & { readonly color: FigColor } {
  return "color" in paint && paint.color !== undefined;
}

function paintHasStopsVar(paint: FigPaint): paint is FigPaint & { readonly stopsVar: readonly FigColorStopVar[] } {
  return "stopsVar" in paint && paint.stopsVar !== undefined;
}

function figColorEquals(left: FigColor, right: FigColor): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a;
}

/**
 * Resolve the authoritative effect array — same SoT as
 * `resolveStyledPaint`, applied to EFFECT styles. Registry wins when
 * the ref resolves; otherwise the embedded `effects` cache is SoT.
 */
export function resolveStyledEffects(
  ref: FigStyleId | undefined,
  embedded: readonly FigEffect[] | undefined,
  registry: FigStyleRegistry,
): readonly FigEffect[] | undefined {
  return resolveEffectsRef(ref, registry) ?? embedded;
}

/**
 * Resolve the authoritative text-property bundle — variant of the
 * paint SoT for TEXT styles.
 *
 * Unlike paint/effect/grid (which replace the entire array atomically),
 * a TEXT style overlays a *subset* of properties on top of the
 * consumer's embedded values. The style may set, say, only
 * `lineHeight` and `fontSize` while leaving `fontName` for the
 * consumer to control. This function materialises the per-property
 * precedence: registry property when set, else embedded property.
 *
 * Dangling refs return the embedded bundle unchanged (matches Figma's
 * actual rendering when a text style reference can't resolve).
 */
export function resolveStyledTextProperties(
  ref: FigStyleId | undefined,
  embedded: FigTextStyleProperties,
  registry: FigStyleRegistry,
): FigTextStyleProperties {
  const fromRegistry = resolveTextStyleRef(ref, registry);
  if (fromRegistry === undefined) { return embedded; }
  return {
    fontName: fromRegistry.fontName ?? embedded.fontName,
    fontSize: fromRegistry.fontSize ?? embedded.fontSize,
    lineHeight: fromRegistry.lineHeight ?? embedded.lineHeight,
    letterSpacing: fromRegistry.letterSpacing ?? embedded.letterSpacing,
    textCase: fromRegistry.textCase ?? embedded.textCase,
    textDecoration: fromRegistry.textDecoration ?? embedded.textDecoration,
    textTracking: fromRegistry.textTracking ?? embedded.textTracking,
    fontVariations: fromRegistry.fontVariations ?? embedded.fontVariations,
  };
}

/**
 * Resolve the authoritative layout-grid array — same SoT as
 * `resolveStyledPaint`, applied to GRID styles.
 */
export function resolveStyledGrids(
  ref: FigStyleId | undefined,
  embedded: readonly unknown[] | undefined,
  registry: FigStyleRegistry,
): readonly unknown[] | undefined {
  return resolveGridRef(ref, registry) ?? embedded;
}

/**
 * Format `"<sessionID:localID> (<name>)"` for diagnostic output.
 *
 * Accepts a raw FigNode-like object with a Kiwi GUID.
 */
export function formatNodeLocator(node: {
  readonly guid?: { readonly sessionID: number; readonly localID: number };
  readonly name?: string | undefined;
}): string {
  return `${pickGuidString(node)} (${node.name ?? "?"})`;
}

function pickGuidString(node: {
  readonly guid?: { readonly sessionID: number; readonly localID: number };
}): string {
  if (node.guid) { return guidToString(node.guid); }
  return "<no-guid>";
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * Bake every styleId reference on a node into the corresponding cache
 * field, returning a new immutable node when at least one reference
 * resolved.
 *
 * Coverage parallels the registry's StyleType axis:
 *   - `styleIdForFill`       → `fillPaints`       (paint registry)
 *   - `styleIdForStrokeFill` → `strokePaints`     (paint registry)
 *   - `styleIdForEffect`     → `effects`          (effect registry)
 *   - `styleIdForText`       → text properties    (text registry)
 *   - `styleIdForGrid`       → `layoutGrids`      (grid registry)
 *
 * Stale-cache repair: a node's own cached field may have been captured
 * when the referenced style had a different value. The registry is the
 * SoT, so each successful resolution overwrites the matching cache
 * field. Dangling refs leave the cache unchanged (Figma's own render
 * behaviour).
 *
 * Returns the original `node` reference when nothing changed — callers
 * that compare with `!==` use that to short-circuit.
 */
export function resolveNodeStyleIds(
  node: FigNode,
  registry: FigStyleRegistry,
): FigNode {
  const overlay = computeStyleOverlay(node, registry);
  if (overlay === undefined) { return node; }
  return { ...node, ...overlay } as FigNode;
}

/**
 * Mutating sibling of `resolveNodeStyleIds`. Used inside the override
 * pipeline (`applyOverrides`) where the target is already a clone, so
 * a fresh allocation per resolve would be wasted.
 */
export function resolveStyleIdOnMutableNode(
  node: MutableFigNode,
  registry: FigStyleRegistry,
): void {
  const overlay = computeStyleOverlay(node, registry);
  if (overlay === undefined) { return; }
  Object.assign(node, overlay);
}

/**
 * Compute the partial node update implied by every resolved styleId
 * reference on `node`. Returns `undefined` when no field needs to
 * change — that signals "registry contributed nothing here". Each
 * field present in the result is a guaranteed change vs the input.
 *
 * Centralising the decision here is what lets the immutable and
 * mutable variants of the public API share one implementation.
 */
type StyleOverlay = {
  fillPaints?: readonly FigPaint[];
  strokePaints?: readonly FigPaint[];
  effects?: readonly FigEffect[];
  fontName?: FigNode["fontName"];
  fontSize?: FigNode["fontSize"];
  lineHeight?: FigNode["lineHeight"];
  letterSpacing?: FigNode["letterSpacing"];
  textCase?: FigNode["textCase"];
  textDecoration?: FigNode["textDecoration"];
  textTracking?: FigNode["textTracking"];
  fontVariations?: FigNode["fontVariations"];
  layoutGrids?: readonly unknown[];
};

function computeStyleOverlay(
  node: FigNode,
  registry: FigStyleRegistry,
): StyleOverlay | undefined {
  const overlay: StyleOverlay = {};
  const fillResolved = resolvePaintRef(node.styleIdForFill, registry);
  if (fillResolved !== undefined && fillResolved !== node.fillPaints) {
    overlay.fillPaints = fillResolved;
  }
  const strokeResolved = resolvePaintRef(node.styleIdForStrokeFill, registry);
  if (strokeResolved !== undefined && strokeResolved !== node.strokePaints) {
    overlay.strokePaints = strokeResolved;
  }
  const effectsResolved = resolveEffectsRef(node.styleIdForEffect, registry);
  if (effectsResolved !== undefined && effectsResolved !== node.effects) {
    overlay.effects = effectsResolved;
  }
  const textResolved = resolveTextStyleRef(node.styleIdForText, registry);
  if (textResolved !== undefined) {
    pickResolvedTextField(textResolved, node, "fontName", overlay);
    pickResolvedTextField(textResolved, node, "fontSize", overlay);
    pickResolvedTextField(textResolved, node, "lineHeight", overlay);
    pickResolvedTextField(textResolved, node, "letterSpacing", overlay);
    pickResolvedTextField(textResolved, node, "textCase", overlay);
    pickResolvedTextField(textResolved, node, "textDecoration", overlay);
    pickResolvedTextField(textResolved, node, "textTracking", overlay);
    pickResolvedTextField(textResolved, node, "fontVariations", overlay);
  }
  const gridResolved = resolveGridRef(node.styleIdForGrid, registry);
  if (gridResolved !== undefined && gridResolved !== node.layoutGrids) {
    overlay.layoutGrids = gridResolved;
  }
  return Object.keys(overlay).length === 0 ? undefined : overlay;
}

function pickResolvedTextField<K extends keyof FigTextStyleProperties & keyof StyleOverlay & keyof FigNode>(
  resolved: FigTextStyleProperties,
  node: FigNode,
  field: K,
  overlay: StyleOverlay,
): void {
  const value = resolved[field];
  if (value === undefined) { return; }
  if (value === node[field]) { return; }
  // `value` is sourced from the registry's `FigTextStyleProperties`
  // bag whose property types match `FigNode`'s by construction, so
  // an explicit cast wraps the narrowing the compiler can't follow
  // through the keyed lookup.
  overlay[field] = value as StyleOverlay[K];
}
