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
 * No fallbacks: a consumer setting `styleIdForFill`/`styleIdForStrokeFill`
 * to an entry that the registry does not contain is treated as a
 * malformed reference by the resolution helpers, which throw rather
 * than silently returning the consumer's stale local paint cache.
 */

import type { FigNode, MutableFigNode, FigPaint, FigStyleId } from "../types";
import type { FigStyleRegistry } from "../domain/document";
import { guidToString } from "@higma-document-models/fig/domain";

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
  if (!ref) return undefined;
  if (ref.guid) return guidToString(ref.guid);
  if (ref.assetRef?.key) return ref.assetRef.key;
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
  if (!ref) return [];
  const keys: string[] = [];
  if (ref.guid) keys.push(guidToString(ref.guid));
  if (ref.assetRef?.key) keys.push(ref.assetRef.key);
  return keys;
}

/**
 * Extract the authoritative paint array from a style-definition node.
 *
 * SoT: a node is a style-definition iff `styleType` is set; the paint
 * lives in the field implied by `styleType` (FILL → `fillPaints`,
 * STROKE → `strokePaints`). Returns `undefined` when the node is not a
 * paint-style definition or when the implied field is empty (the latter
 * is treated as "this style contributes nothing"; consumers that try to
 * resolve such a reference will throw at lookup time).
 *
 * No fallback between fillPaints/strokePaints: which field carries the
 * paint is determined by the style's own type, not by the consumer's
 * intent. Consumer-side intent (use as fill vs stroke) is independent
 * and handled at the `lookupStylePaint` boundary.
 */
function getStylePaint(node: FigNode): readonly FigPaint[] | undefined {
  const typeName = node.styleType?.name;
  if (typeName === "FILL") {
    if (node.fillPaints && node.fillPaints.length > 0) { return node.fillPaints; }
    return undefined;
  }
  if (typeName === "STROKE") {
    if (node.strokePaints && node.strokePaints.length > 0) { return node.strokePaints; }
    return undefined;
  }
  return undefined;
}

/**
 * Build a style registry from a node map.
 *
 * Walks every node and indexes the ones that are style definitions
 * (`styleType` set). Each style is registered under its GUID (via
 * `guidToString`) and, when present, its `key` (assetRef hash). The
 * two namespaces share one map because their string forms can't
 * collide ("session:local" vs hex digest).
 *
 * The resulting map is keyed by the union of both reference forms a
 * consumer might use — so a `styleIdForFill` carrying either a guid or
 * an assetRef.key resolves through a single `Map.get`.
 */
export function buildFigStyleRegistry(nodeMap: ReadonlyMap<string, FigNode>): FigStyleRegistry {
  const map = new Map<string, readonly FigPaint[]>();
  for (const [, node] of nodeMap) {
    const paint = getStylePaint(node);
    if (!paint) { continue; }
    if (node.guid) { map.set(guidToString(node.guid), paint); }
    if (typeof node.key === "string" && node.key.length > 0) { map.set(node.key, paint); }
  }
  return map;
}

/**
 * Look up the paint array referenced by a `FigStyleId`.
 *
 * Tries `guid` first (authoritative same-file reference) then
 * `assetRef.key` (team-library import). Returns `undefined` only when
 * the reference itself is empty (no guid and no assetRef.key) — caller
 * is responsible for deciding what an empty reference means in their
 * context. When the reference HAS at least one key but neither key
 * resolves, the registry is malformed for that consumer's needs and
 * the function still returns `undefined` so the caller can throw with
 * a context-specific error.
 */
function lookupStylePaint(
  ref: FigStyleId | undefined,
  registry: FigStyleRegistry,
): readonly FigPaint[] | undefined {
  if (!ref) { return undefined; }
  if (ref.guid && !isSentinelGuid(ref.guid)) {
    const paint = registry.get(guidToString(ref.guid));
    if (paint) { return paint; }
  }
  if (ref.assetRef?.key) {
    const paint = registry.get(ref.assetRef.key);
    if (paint) { return paint; }
  }
  return undefined;
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
 * Resolve a paint reference through the registry.
 *
 * This is the single SoT consumers use to turn a `styleIdForFill` or
 * `styleIdForStrokeFill` into a paint array. Throws when the reference
 * carries a key but the registry has no entry for it — that's a
 * malformed reference (dangling style guid or missing asset-ref proxy)
 * which historically the codebase masked by silently using the
 * consumer's stale cached `fillPaints`/`strokePaints`. Throwing here
 * makes such inconsistencies visible at the conversion boundary
 * instead of leaking into rendered output.
 *
 * `diagnostic.locator` produces a string identifying the resolution
 * site (e.g. "node 34:785 (Vector)") so the thrown error names the
 * actual offending node — keep the call cheap, it's only invoked on
 * the throw path.
 */
export function resolvePaintRef(
  ref: FigStyleId | undefined,
  registry: FigStyleRegistry,
  diagnostic: { readonly intent: "fill" | "stroke"; readonly locator: () => string },
): readonly FigPaint[] | undefined {
  if (!styleRefHasKey(ref)) { return undefined; }
  const paint = lookupStylePaint(ref, registry);
  if (paint) { return paint; }
  throw new Error(
    `Unresolved styleId for ${diagnostic.intent} on ${diagnostic.locator()}: ` +
    `${JSON.stringify(ref)} not found in style registry`,
  );
}

/**
 * Format `"<sessionID:localID> (<name>)"` for diagnostic output.
 *
 * Accepts either a raw FigNode (`guid: FigGuid`) or a domain
 * FigDesignNode (`id: FigNodeId`, the string-form of the GUID) so the
 * same locator can serve both layers without callers having to convert.
 */
export function formatNodeLocator(node: {
  readonly guid?: { readonly sessionID: number; readonly localID: number };
  readonly id?: string;
  readonly name?: string | undefined;
}): string {
  const guidStr = node.guid
    ? guidToString(node.guid)
    : (typeof node.id === "string" && node.id.length > 0 ? node.id : "<no-guid>");
  return `${guidStr} (${node.name ?? "?"})`;
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * Resolve styleIdForFill / styleIdForStrokeFill on an immutable FigNode.
 *
 * If the node's `styleIdForFill` resolves through the registry, returns
 * a new node with `fillPaints` replaced by the registry value (and the
 * same for stroke). The original node is returned unchanged when no
 * resolvable references are present.
 *
 * Stale-cache repair: a node's own `fillPaints` may have been captured
 * when the referenced style had a different paint. The registry's
 * value is the SoT, so we always replace when a resolution succeeds —
 * even when the new value is structurally equal to the cache, the
 * identity-comparison `!==` is enough to detect "we resolved through a
 * style" vs "we left the cache".
 */
export function resolveNodeStyleIds(
  node: FigNode,
  registry: FigStyleRegistry,
): FigNode {
  const fillResolved = resolvePaintRef(node.styleIdForFill, registry, { intent: "fill", locator: () => formatNodeLocator(node) });
  const strokeResolved = resolvePaintRef(node.styleIdForStrokeFill, registry, { intent: "stroke", locator: () => formatNodeLocator(node) });

  if (fillResolved === undefined && strokeResolved === undefined) {
    return node;
  }

  let fillPaints = node.fillPaints;
  let strokePaints = node.strokePaints;
  let changed = false;
  if (fillResolved && fillResolved !== fillPaints) {
    fillPaints = fillResolved;
    changed = true;
  }
  if (strokeResolved && strokeResolved !== strokePaints) {
    strokePaints = strokeResolved;
    changed = true;
  }
  if (!changed) { return node; }
  return { ...node, fillPaints, strokePaints } as FigNode;
}

/**
 * Resolve styleIdForFill / styleIdForStrokeFill on a mutable node clone.
 *
 * Used inside `applyOverrides` where nodes are MutableFigNode clones
 * created by `deepCloneNode`. Mirrors `resolveNodeStyleIds` but mutates
 * in place.
 */
export function resolveStyleIdOnMutableNode(
  node: MutableFigNode,
  registry: FigStyleRegistry,
): void {
  const fillResolved = resolvePaintRef(node.styleIdForFill, registry, { intent: "fill", locator: () => formatNodeLocator(node) });
  if (fillResolved) { node.fillPaints = fillResolved; }
  const strokeResolved = resolvePaintRef(node.styleIdForStrokeFill, registry, { intent: "stroke", locator: () => formatNodeLocator(node) });
  if (strokeResolved) { node.strokePaints = strokeResolved; }
}

