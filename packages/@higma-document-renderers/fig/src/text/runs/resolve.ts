/**
 * @file SoT for converting a TEXT node's per-character style metadata into
 * a list of `TextRun` segments, each carrying a fully-resolved fill.
 *
 * Inputs come straight from Kiwi `FigKiwiTextData` fields:
 *   - `characters`            (the source string, used only for length)
 *   - `characterStyleIDs[i]`  (style override id for char i; 0 = base)
 *   - `styleOverrideTable[]`  (sparse style overrides, keyed by styleID)
 *   - the node's own base `fillPaints`
 *   - the document-wide `FigStyleRegistry`
 *
 * Resolution rules (no substitutions, no heuristics):
 *
 *   0. `characterStyleIDs` must use one of the two index spaces emitted by
 *      Kiwi text data: JS string length for raw TEXT nodes, or Figma logical
 *      character length for symbol-override text data that aligns with
 *      `derivedTextData.glyphs[].firstCharacter`. Any other length is
 *      malformed input and throws.
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
 *          the no-substitution policy used at the node level.
 *        - else `override.fillPaints` (when set) is used directly.
 *        - else the override is sparse and intentionally inherits the
 *          node's base fill — that is *not* a substitution, it's the explicit
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
 *   - runs[runs.length - 1].end === the resolved Figma source-index length
 *   - runs are non-empty (start < end) for every entry
 */

import type { FigPaint, FigKiwiVariableModeBySetMap, FigTextStyleOverrideEntry } from "@higma-document-models/fig/types";
import type { FigStyleRegistry } from "@higma-document-models/fig/domain";
import { resolveStyledPaint } from "@higma-document-models/fig/symbols";
import { figmaFontToQuery, type FontQuery } from "@higma-document-models/fig/font";
import { getFillColorAndOpacity } from "../layout";
import type { TextRun } from "@higma-document-renderers/fig/scene-graph";

export type ResolveTextRunsInput = {
  /** Source string. Only the length is consulted; content does not affect fills. */
  readonly characters: string;
  /** Node's own fill paints — the SoT for run fills when no override applies. */
  readonly baseFillPaints: readonly FigPaint[] | undefined;
  /** Per-character styleID array (Figma TextData.characterStyleIDs). */
  readonly characterStyleIDs: readonly number[] | undefined;
  /** Sparse override entries keyed by styleID (Figma TextData.styleOverrideTable). */
  readonly styleOverrideTable: readonly FigTextStyleOverrideEntry[] | undefined;
  /** Document-wide style registry — same SoT used for node-level fills. */
  readonly styleRegistry: FigStyleRegistry;
  readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  /**
   * Diagnostic locator used in thrown errors so unresolvable references
   * point at the offending TEXT node. Lazy because errors are off the
   * common path.
   */
  readonly locator: () => string;
};

/** Resolve a text node's per-character fill metadata into a `TextRun[]`. */
export function resolveTextRuns(input: ResolveTextRunsInput): readonly TextRun[] {
  const { characters, baseFillPaints, characterStyleIDs, styleOverrideTable, styleRegistry, variableModeBySetMap, locator } = input;
  const length = resolveSourceIndexLength(characters, characterStyleIDs, locator);
  if (length === 0) { return []; }

  // Index the override table for O(1) lookup. styleID 0 is reserved for the
  // base style and never appears in the table. A duplicate styleID would be
  // ambiguous — reject.
  const overrideById = new Map<number, FigTextStyleOverrideEntry>();
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
  const fillByStyleId = new Map<number, ResolvedRunStyle>();
  function fillForStyleId(styleId: number): ResolvedRunStyle {
    if (styleId === 0) { return baseFill; }
    const cached = fillByStyleId.get(styleId);
    if (cached) { return cached; }
    const override = overrideById.get(styleId);
    if (!override) {
      throw new Error(
        `Text run resolver: characterStyleIDs references styleID=${styleId} which has no entry in styleOverrideTable on ${locator()}`,
      );
    }
    const fill = resolveOverrideFill(override, baseFill, styleRegistry, variableModeBySetMap);
    const font = resolveOverrideFont(override);
    const resolved: ResolvedRunStyle = font === undefined ? fill : { ...fill, font };
    fillByStyleId.set(styleId, resolved);
    return resolved;
  }

  return collapseRuns(characterStyleIDs, length, fillForStyleId);
}

function resolveSourceIndexLength(
  characters: string,
  characterStyleIDs: readonly number[] | undefined,
  locator: () => string,
): number {
  if (characterStyleIDs === undefined || characterStyleIDs.length === 0) {
    return characters.length;
  }
  if (characterStyleIDs.length === characters.length) {
    return characters.length;
  }
  const logicalLength = [...characters].length;
  if (characterStyleIDs.length === logicalLength) {
    return logicalLength;
  }
  throw new Error(
    `Text run resolver: characterStyleIDs length ${characterStyleIDs.length} does not match characters length ${characters.length} ` +
    `or Figma logical length ${logicalLength} on ${locator()}`,
  );
}

/**
 * Collapse contiguous identical-styleID positions into `TextRun`
 * segments. Boundaries are computed first (positions where the
 * styleID differs from the previous, plus position 0 which always
 * starts a run) and then materialised — keeping the function purely
 * derivation-driven without sweep-state.
 */
function collapseRuns(
  characterStyleIDs: readonly number[],
  length: number,
  fillForStyleId: (styleId: number) => ResolvedRunStyle,
): readonly TextRun[] {
  const runStarts: readonly number[] = characterStyleIDs.flatMap((id, i) => {
    if (i === 0) { return [0]; }
    if (id !== characterStyleIDs[i - 1]) { return [i]; }
    return [];
  });
  return runStarts.map((start, idx) => {
    const end = idx + 1 < runStarts.length ? runStarts[idx + 1] : length;
    const fill = fillForStyleId(characterStyleIDs[start]);
    const base: TextRun = {
      start,
      end,
      fillColor: fill.color,
      fillOpacity: fill.opacity,
    };
    return fill.font === undefined ? base : { ...base, font: fill.font };
  });
}

type ResolvedRunStyle = {
  readonly color: string;
  readonly opacity: number;
  /** Override font for the run; `undefined` means "inherit base font". */
  readonly font?: FontQuery;
};

/**
 * Resolve the font override for a styleOverrideTable entry.
 *
 * Returns the canonical `FontQuery` when the override carries a `fontName`,
 * `undefined` otherwise — the run then inherits the node's base font. The
 * conversion is delegated to `figmaFontToQuery` (the same SoT used by the
 * preloader and the resolver) so cache lookups match exactly.
 */
function resolveOverrideFont(override: FigTextStyleOverrideEntry): FontQuery | undefined {
  if (override.fontName === undefined) {
    return undefined;
  }
  return figmaFontToQuery(override.fontName);
}

/**
 * Resolve a single override entry's fill via the styled-paint SoT.
 *
 * Precedence is the SoT-uniform "registry wins, embedded follows":
 * `styleIdForFill` (when it resolves through the registry) overrides
 * `override.fillPaints`; an unresolved/dangling ref defers to
 * `override.fillPaints`; a sparse override that authors neither leaves
 * the fill at the node's base — that is *not* a substitution but the
 * documented Kiwi NodeChange semantic of "this override doesn't touch
 * the fill".
 */
function resolveOverrideFill(
  override: FigTextStyleOverrideEntry,
  baseFill: { color: string; opacity: number },
  styleRegistry: FigStyleRegistry,
  variableModeBySetMap: FigKiwiVariableModeBySetMap | undefined,
): { color: string; opacity: number } {
  const resolved = resolveStyledPaint(override.styleIdForFill, override.fillPaints, styleRegistry, { variableModeBySetMap });
  if (resolved && resolved.length > 0) { return paintsToFill(resolved); }
  return baseFill;
}

function paintsToFill(paints: readonly FigPaint[] | undefined): { color: string; opacity: number } {
  const r = getFillColorAndOpacity(paints);
  return { color: r.color, opacity: r.opacity };
}
