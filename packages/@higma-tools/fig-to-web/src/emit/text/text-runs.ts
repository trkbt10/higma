/**
 * @file Per-character text-run resolution for the JSX emitter.
 *
 * A Figma TEXT node carries per-character style metadata via two
 * fields on `textData`:
 *
 *   - `characterStyleIDs[i]` — the styleID applied to character `i`.
 *     Value `0` means "use the node's base style"; non-zero values
 *     reference an entry in `styleOverrideTable` whose `styleID`
 *     field matches.
 *
 *   - `styleOverrideTable[]` — sparse `NodeChange`-shaped overrides.
 *     Each entry contributes the subset of style properties that
 *     differ from the base (commonly `fontName`, `fontSize`,
 *     `fillPaints`, `styleIdForFill`, `lineHeight`, `letterSpacing`).
 *     Properties not set on the override inherit from the base.
 *
 * The single-`<span>` emit pattern collapses every character into the
 * base style, dropping the run distinctions Figma stores. This matters
 * for two real cases in the Youtube fixture:
 *
 *   - "Comments 149": "Comments " is the base colour; "149" is a
 *     dimmer style-proxy colour. Single-span output renders all 12
 *     characters in the base colour and the count loses its visual
 *     emphasis.
 *
 *   - "DIY Toys | Satisfying And Relaxing | SADEK Tuts ...": uses
 *     three style runs (Bold, sparse-no-change, Regular) layered on
 *     a Medium base. Single-span output renders the whole title in
 *     Medium and the bold sections disappear.
 *
 * This module is the SoT for "what runs does this TEXT node have, and
 * what's the *effective* style of each one?". It is deliberately
 * aware of the same override-precedence rules the renderer's
 * `text/runs/resolve.ts` follows so the two stay in lockstep when
 * pixel-diffing the React output against the renderer's SVG.
 */
import type { FigFontName, FigNode, FigPaint, FigValueWithUnits } from "@higma-document-models/fig/types";
import type { TokenIndex } from "../../tokens";

/** A contiguous range of characters that share an effective style. */
export type TextRun = {
  /** Inclusive start character index. */
  readonly start: number;
  /** Exclusive end character index. */
  readonly end: number;
  /** Resolved fill colour (CSS). Undefined means "inherit from base". */
  readonly color?: string;
  /** Override fontName.family, when the run differs from base. */
  readonly fontFamily?: string;
  /** Override fontName.style, when the run differs from base. */
  readonly fontStyle?: string;
  /** Override fontSize, when the run differs from base. */
  readonly fontSize?: number;
  /** Override lineHeight, when the run differs from base. */
  readonly lineHeight?: FigValueWithUnits;
  /** Override letterSpacing, when the run differs from base. */
  readonly letterSpacing?: FigValueWithUnits;
};

type RawTextDataLike = {
  readonly characters?: string;
  readonly characterStyleIDs?: readonly number[];
  readonly styleOverrideTable?: readonly RawOverrideEntry[];
};

type RawOverrideEntry = {
  readonly styleID: number;
  readonly fontName?: FigFontName;
  readonly fontSize?: number;
  readonly fillPaints?: readonly FigPaint[];
  readonly lineHeight?: FigValueWithUnits;
  readonly letterSpacing?: FigValueWithUnits;
  readonly [key: string]: unknown;
};

function readRawTextData(node: FigNode): RawTextDataLike {
  const td = (node as Record<string, unknown>).textData as RawTextDataLike | undefined;
  if (td) {
    return td;
  }
  return node as RawTextDataLike;
}

function readCharacters(node: FigNode): string {
  const td = readRawTextData(node);
  return td.characters ?? (node.characters as string | undefined) ?? "";
}

/**
 * Resolve a TEXT node into one or more runs.
 *
 * Always returns at least one run. The fast path collapses to a
 * single run with no override fields when `characterStyleIDs` is
 * absent, empty, or all-zero — that's the "this node has no runs"
 * shape and lets callers skip the multi-span emit path entirely.
 */
export function resolveTextRuns(node: FigNode, index: TokenIndex): readonly TextRun[] {
  if (node.type.name !== "TEXT") {
    return [];
  }
  const characters = readCharacters(node);
  const length = characters.length;
  if (length === 0) {
    return [{ start: 0, end: 0 }];
  }

  const td = readRawTextData(node);
  const cIds = td.characterStyleIDs;
  const sot = td.styleOverrideTable;

  // Fast path: no per-character metadata.
  if (!cIds || cIds.length === 0 || cIds.every((id) => id === 0)) {
    return [{ start: 0, end: length }];
  }

  // Length mismatch is a schema violation; surface it instead of
  // truncating silently. Mirrors the renderer's resolveTextRuns.
  if (cIds.length !== length) {
    throw new Error(`text-runs: characterStyleIDs length ${cIds.length} ≠ characters length ${length}`);
  }

  const overrideById = new Map<number, RawOverrideEntry>();
  for (const entry of sot ?? []) {
    if (entry.styleID === 0) {
      continue;
    }
    overrideById.set(entry.styleID, entry);
  }

  // Sweep collapse identical-id runs.
  const segments: { readonly start: number; readonly end: number; readonly styleId: number }[] = [];
  let runStart = 0;
  let runId = cIds[0];
  for (let i = 1; i < length; i += 1) {
    if (cIds[i] === runId) {
      continue;
    }
    segments.push({ start: runStart, end: i, styleId: runId });
    runStart = i;
    runId = cIds[i];
  }
  segments.push({ start: runStart, end: length, styleId: runId });

  return segments.map((seg) => buildRun(seg.start, seg.end, seg.styleId, overrideById, index));
}

function buildRun(
  start: number,
  end: number,
  styleId: number,
  overrideById: ReadonlyMap<number, RawOverrideEntry>,
  index: TokenIndex,
): TextRun {
  if (styleId === 0) {
    return { start, end };
  }
  const override = overrideById.get(styleId);
  if (!override) {
    // Missing override entry — treat as base style. Mirrors the
    // renderer's strict mode for malformed inputs but doesn't throw
    // because the emitter has historically been forgiving here.
    return { start, end };
  }
  return {
    start,
    end,
    color: resolveOverrideColor(override, index),
    fontFamily: override.fontName?.family,
    fontStyle: override.fontName?.style,
    fontSize: override.fontSize,
    lineHeight: override.lineHeight,
    letterSpacing: override.letterSpacing,
  };
}

function resolveOverrideColor(override: RawOverrideEntry, index: TokenIndex): string | undefined {
  // Inline fillPaints have priority for the emitter — the override
  // table's `styleIdForFill` is already pre-resolved by `loadFigSource`'s
  // `resolveTree` walk against the file's style registry, so by the
  // time we look here `override.fillPaints` reflects the live colour
  // when one was bound to a style proxy.
  const paints = override.fillPaints;
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    // `paint.type` is a Kiwi enum value (`{ value, name }`) on raw
    // FigNodes; comparing the object to the string `"SOLID"` always
    // fails and silently drops every override colour. Read the
    // enum's `.name`.
    const typeName = typeof paint.type === "string" ? paint.type : (paint.type as { readonly name?: string } | undefined)?.name;
    if (typeName !== "SOLID") {
      // Gradient / image fills inside a text run are unusual and
      // would need `background-clip: text` machinery; skip to base.
      continue;
    }
    const tokenId = index.colorIdForPaint(paint);
    if (tokenId) {
      return `var(--${tokenId})`;
    }
    return colorToCss(paint);
  }
  return undefined;
}

function colorToCss(paint: FigPaint): string | undefined {
  const typeName = typeof paint.type === "string" ? paint.type : (paint.type as { readonly name?: string } | undefined)?.name;
  if (typeName !== "SOLID") {
    return undefined;
  }
  const solid = paint as { readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }; readonly opacity?: number };
  const opacity = typeof solid.opacity === "number" ? solid.opacity : 1;
  const a = solid.color.a * opacity;
  const r = Math.round(solid.color.r * 255);
  const g = Math.round(solid.color.g * 255);
  const b = Math.round(solid.color.b * 255);
  if (a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * True when at least one resolved run carries an override field —
 * i.e., the node has runs that actually deviate from the base. The
 * single-span emit path can short-circuit when this is false even
 * if `characterStyleIDs` is non-trivial (every run resolves back to
 * the base style, so the multi-span machinery would just split the
 * string for no visual benefit).
 */
export function hasOverrides(runs: readonly TextRun[]): boolean {
  for (const run of runs) {
    if (run.color !== undefined) return true;
    if (run.fontFamily !== undefined) return true;
    if (run.fontStyle !== undefined) return true;
    if (run.fontSize !== undefined) return true;
    if (run.lineHeight !== undefined) return true;
    if (run.letterSpacing !== undefined) return true;
  }
  return false;
}
