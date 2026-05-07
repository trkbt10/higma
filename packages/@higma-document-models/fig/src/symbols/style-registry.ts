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
 * `fillPaints` / `strokePaints` cache. The resolution helpers therefore
 * return `undefined` for dangling refs so callers fall through to the
 * embedded paint, matching Figma's actual behaviour. A successful
 * registry lookup still wins over the embedded cache (the registry is
 * authoritative when it has an entry).
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
 * Resolve a paint reference through the registry — the lookup primitive.
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
 * semantics should call `resolveStyledPaint` instead, which is the
 * higher-level SoT covering the full styled-paint resolution.
 */
export function resolvePaintRef(
  ref: FigStyleId | undefined,
  registry: FigStyleRegistry,
): readonly FigPaint[] | undefined {
  if (!styleRefHasKey(ref)) { return undefined; }
  return lookupStylePaint(ref, registry);
}

/**
 * Resolve the authoritative paint for a styled element — the SoT.
 *
 * Every consumer of `styleIdForFill` / `styleIdForStrokeFill` /
 * per-override `styleIdForFill` answers the same question: "given a
 * style reference and an embedded paint cache, which paints are
 * authoritative?". The answer is uniform:
 *
 *   1. If the registry resolves the reference, the registry value
 *      wins — it's the file-level SoT and is the right value even when
 *      the embedded cache is structurally identical.
 *   2. Otherwise the embedded cache (the consumer's own
 *      `fillPaints` / `strokePaints` / override `fillPaints`) is the
 *      SoT. This matches Figma's rendering for dangling refs and is
 *      the only value present when the consumer carries no styleId.
 *
 * Returns `undefined` only when both the ref and the embedded cache
 * are absent — callers can chain `?? []` or `?? someBase` as their
 * own context dictates. Empty embedded arrays are preserved (they
 * represent "explicitly no paint", not "no value").
 *
 * Centralising the rule here means renderer text-runs, scene-graph
 * INSTANCE merges, vector per-path style overrides, and the
 * conversion-layer node helpers all share the same answer to one
 * question. Adding observability (counters, logs) for dangling refs
 * later only needs a single call-site change.
 */
export function resolveStyledPaint(
  ref: FigStyleId | undefined,
  embedded: readonly FigPaint[] | undefined,
  registry: FigStyleRegistry,
): readonly FigPaint[] | undefined {
  const fromRegistry = resolvePaintRef(ref, registry);
  if (fromRegistry !== undefined) { return fromRegistry; }
  return embedded;
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
  return `${pickGuidString(node)} (${node.name ?? "?"})`;
}

function pickGuidString(node: {
  readonly guid?: { readonly sessionID: number; readonly localID: number };
  readonly id?: string;
}): string {
  if (node.guid) { return guidToString(node.guid); }
  if (typeof node.id === "string" && node.id.length > 0) { return node.id; }
  return "<no-guid>";
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
  const fillResolved = resolvePaintRef(node.styleIdForFill, registry);
  const strokeResolved = resolvePaintRef(node.styleIdForStrokeFill, registry);

  if (fillResolved === undefined && strokeResolved === undefined) {
    return node;
  }

  // `nextPaintFor` returns either the registry-resolved value (when
  // present and identity-distinct from the cache) or the original
  // cache reference; the identity-compare downstream then tells us
  // whether anything actually changed.
  const fillPaints = nextPaintFor(node.fillPaints, fillResolved);
  const strokePaints = nextPaintFor(node.strokePaints, strokeResolved);

  if (fillPaints === node.fillPaints && strokePaints === node.strokePaints) {
    return node;
  }
  return { ...node, fillPaints, strokePaints } as FigNode;
}

function nextPaintFor(
  cached: readonly FigPaint[] | undefined,
  resolved: readonly FigPaint[] | undefined,
): readonly FigPaint[] | undefined {
  if (resolved && resolved !== cached) { return resolved; }
  return cached;
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
  const fillResolved = resolvePaintRef(node.styleIdForFill, registry);
  if (fillResolved) { node.fillPaints = fillResolved; }
  const strokeResolved = resolvePaintRef(node.styleIdForStrokeFill, registry);
  if (strokeResolved) { node.strokePaints = strokeResolved; }
}

