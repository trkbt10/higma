/**
 * @file SoT for converting a TEXT node's per-character style metadata into
 * a list of `TextRun` segments, each carrying a fully-resolved fill.
 *
 * Inputs come straight from the domain TextData fields:
 *   - `characters`            (the source string, used only for length)
 *   - `characterStyleIDs[i]`  (style override id for char i; 0 = base)
 *   - `styleOverrideTable[]`  (sparse style overrides, keyed by styleID)
 *   - the node's own base `fillPaints`
 *   - the document-wide `FigStyleRegistry`
 *
 * Resolution rules (no fallbacks, no heuristics):
 *
 *   1. Without `characterStyleIDs`, or when every entry is 0, the entire
 *      source is one run with the base fill resolved from the node's own
 *      `fillPaints`.
 *
 *   2. Otherwise, contiguous characters that share the same styleID are
 *      grouped into one run. styleID 0 always resolves to the base fill.
 *
 *   3. For a non-zero styleID, the override entry from `styleOverrideTable`
 *      is the SoT for that run's fill:
 *        - `override.styleIdForFill` (when set) is resolved through the
 *          style registry. An unresolvable reference throws, mirroring
 *          the no-fallback policy used at the node level.
 *        - else `override.fillPaints` (when set) is used directly.
 *        - else the override is sparse and intentionally inherits the
 *          node's base fill — that is *not* a fallback, it's the explicit
 *          "this override doesn't touch fill" semantic of sparse
 *          NodeChange-shaped Kiwi entries.
 *
 *   4. When a styleID appears in `characterStyleIDs` but has no matching
 *      entry in `styleOverrideTable`, the input is malformed and we
 *      throw — silently using the base style would mask data corruption.
 *
 * The output runs always satisfy:
 *   - runs[0].start === 0
 *   - runs[i].end === runs[i+1].start
 *   - runs[runs.length - 1].end === characters.length
 *   - runs are non-empty (start < end) for every entry
 */

import type { FigPaint } from "@higma-document-models/fig/types";
import type { FigStyleRegistry, TextStyleOverride } from "@higma-document-models/fig/domain";
import { resolvePaintRef } from "@higma-document-models/fig/symbols";
import { getFillColorAndOpacity } from "../layout/fill";
import type { TextRun } from "./types";

export type ResolveTextRunsInput = {
  /** Source string. Only the length is consulted; content does not affect fills. */
  readonly characters: string;
  /** Node's own fill paints — the SoT for run fills when no override applies. */
  readonly baseFillPaints: readonly FigPaint[] | undefined;
  /** Per-character styleID array (Figma TextData.characterStyleIDs). */
  readonly characterStyleIDs: readonly number[] | undefined;
  /** Sparse override entries keyed by styleID (Figma TextData.styleOverrideTable). */
  readonly styleOverrideTable: readonly TextStyleOverride[] | undefined;
  /** Document-wide style registry — same SoT used for node-level fills. */
  readonly styleRegistry: FigStyleRegistry;
  /**
   * Diagnostic locator used in thrown errors so unresolvable references
   * point at the offending TEXT node. Lazy because errors are off the
   * common path.
   */
  readonly locator: () => string;
};

/** Resolve a text node's per-character fill metadata into a `TextRun[]`. */
export function resolveTextRuns(input: ResolveTextRunsInput): readonly TextRun[] {
  const { characters, baseFillPaints, characterStyleIDs, styleOverrideTable, styleRegistry, locator } = input;
  const length = characters.length;
  if (length === 0) { return []; }

  // Input validation comes first. Errors here surface schema violations
  // regardless of whether the run-collapse path actually consults the
  // questionable inputs — a malformed override table is a malformed
  // override table, even if every character happens to use the base.
  if (characterStyleIDs && characterStyleIDs.length > 0 && characterStyleIDs.length !== length) {
    throw new Error(
      `Text run resolver: characterStyleIDs length ${characterStyleIDs.length} does not match characters length ${length} on ${locator()}`,
    );
  }

  // Index the override table for O(1) lookup. styleID 0 is reserved for the
  // base style and never appears in the table; the conversion layer already
  // strips it. A duplicate styleID would be ambiguous — reject.
  const overrideById = new Map<number, TextStyleOverride>();
  for (const entry of styleOverrideTable ?? []) {
    if (entry.styleID === 0) {
      throw new Error(`Text run resolver: styleOverrideTable contains forbidden styleID=0 on ${locator()}`);
    }
    if (overrideById.has(entry.styleID)) {
      throw new Error(`Text run resolver: duplicate styleID=${entry.styleID} in styleOverrideTable on ${locator()}`);
    }
    overrideById.set(entry.styleID, entry);
  }

  const baseFill = paintsToFill(baseFillPaints);

  // Fast path: no per-character metadata, or every char uses the base.
  if (!characterStyleIDs || characterStyleIDs.length === 0 || characterStyleIDs.every((id) => id === 0)) {
    return [{ start: 0, end: length, fillColor: baseFill.color, fillOpacity: baseFill.opacity }];
  }

  // Memoise per-styleID fills — many runs share the same id, and resolving
  // through the registry is the same answer every time.
  const fillByStyleId = new Map<number, { color: string; opacity: number }>();
  function fillForStyleId(styleId: number): { color: string; opacity: number } {
    if (styleId === 0) { return baseFill; }
    const cached = fillByStyleId.get(styleId);
    if (cached) { return cached; }
    const override = overrideById.get(styleId);
    if (!override) {
      throw new Error(
        `Text run resolver: characterStyleIDs references styleID=${styleId} which has no entry in styleOverrideTable on ${locator()}`,
      );
    }
    const resolved = resolveOverrideFill(override, baseFill, styleRegistry, locator);
    fillByStyleId.set(styleId, resolved);
    return resolved;
  }

  // Sweep the styleID array once, collapsing identical-id runs.
  const runs: TextRun[] = [];
  let runStart = 0;
  let runId = characterStyleIDs[0];
  for (let i = 1; i < length; i++) {
    if (characterStyleIDs[i] === runId) { continue; }
    const fill = fillForStyleId(runId);
    runs.push({ start: runStart, end: i, fillColor: fill.color, fillOpacity: fill.opacity });
    runStart = i;
    runId = characterStyleIDs[i];
  }
  // Flush the final run.
  const lastFill = fillForStyleId(runId);
  runs.push({ start: runStart, end: length, fillColor: lastFill.color, fillOpacity: lastFill.opacity });

  return runs;
}

/**
 * Resolve a single override entry's fill, with explicit precedence:
 * styleIdForFill (registry SoT) > inline fillPaints > base fill.
 *
 * The "fall through to base" leg is *not* a fallback: a sparse Kiwi
 * NodeChange override that omits both `styleIdForFill` and `fillPaints`
 * is intentionally signalling "this override does not touch the fill",
 * and inheriting the base is the documented semantic.
 */
function resolveOverrideFill(
  override: TextStyleOverride,
  baseFill: { color: string; opacity: number },
  styleRegistry: FigStyleRegistry,
  locator: () => string,
): { color: string; opacity: number } {
  const styleResolved = resolvePaintRef(override.styleIdForFill, styleRegistry, {
    intent: "fill",
    locator: () => `${locator()} (text run styleID=${override.styleID})`,
  });
  if (styleResolved) { return paintsToFill(styleResolved); }
  if (override.fillPaints && override.fillPaints.length > 0) {
    return paintsToFill(override.fillPaints);
  }
  return baseFill;
}

function paintsToFill(paints: readonly FigPaint[] | undefined): { color: string; opacity: number } {
  const r = getFillColorAndOpacity(paints);
  return { color: r.color, opacity: r.opacity };
}
