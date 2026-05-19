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
 * Align `rawCIds` with `length` to satisfy the per-character invariant
 * the rest of `resolveTextRuns` relies on:
 *
 *   - Figma's Kiwi encoding omits trailing zeros in characterStyleIDs
 *     (the base-style suffix), so a stored length shorter than
 *     characters is expected for trailing-base text — pad with 0 to
 *     honour the renderer's post-normalise contract.
 *   - A stored length longer than characters is authoring residue
 *     (e.g. style ids beyond an erased tail) — truncate so downstream
 *     run offsets stay in-bounds.
 *
 * Both behaviours mirror what the SVG renderer produces from the same
 * input, keeping the two emit paths in lockstep.
 */
export function normaliseCharacterStyleIDs(rawCIds: readonly number[], length: number): readonly number[] {
  if (rawCIds.length === length) {
    return rawCIds;
  }
  return Array.from({ length }, (_, i) => rawCIds[i] ?? 0);
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
  const rawCIds = td.characterStyleIDs;
  const sot = td.styleOverrideTable;

  // Fast path: no per-character metadata.
  if (!rawCIds || rawCIds.length === 0 || rawCIds.every((id) => id === 0)) {
    return [{ start: 0, end: length }];
  }

  const cIds = normaliseCharacterStyleIDs(rawCIds, length);

  const overrideById = new Map<number, RawOverrideEntry>();
  for (const entry of sot ?? []) {
    if (entry.styleID === 0) {
      continue;
    }
    overrideById.set(entry.styleID, entry);
  }

  // Sweep collapse identical-id runs. The sweep pointer is held in a
  // const-bound ref struct so the no-`let` rule is satisfied without
  // splitting the (deliberately tight) loop into a separate function.
  const segments: { readonly start: number; readonly end: number; readonly styleId: number }[] = [];
  const sweep: { runStart: number; runId: number } = { runStart: 0, runId: cIds[0] };
  for (let i = 1; i < length; i += 1) {
    if (cIds[i] === sweep.runId) {
      continue;
    }
    segments.push({ start: sweep.runStart, end: i, styleId: sweep.runId });
    sweep.runStart = i;
    sweep.runId = cIds[i];
  }
  segments.push({ start: sweep.runStart, end: length, styleId: sweep.runId });

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
  // Inline fillPaints are the only colour payload this run emitter
  // consumes. Style-id expansion is owned by the model style registry
  // before a caller builds token inputs.
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
    // Raw `.fig` files can serialise enum values as either the
    // string literal (`"SOLID"`) or the Kiwi struct (`{ name: "SOLID", value: 0 }`).
    // TypeScript narrows `paint.type` to the string-literal union, so
    // we cast through `unknown` to handle the struct shape that real
    // files surface at runtime without misleading the static checker.
    const typeName = readEnumName(paint.type);
    if (typeName !== "SOLID") {
      // Gradient / image fills inside a text run are unusual and
      // would need `background-clip: text` machinery; skip to base.
      continue;
    }
    // Single-paint lookup goes through the array API. Wrapping the
    // run-override paint in `[paint]` keeps every callsite on the same
    // canonical method per the SoT contract; the resolver returns the
    // token only when the (one-element) stack is itself resolvable,
    // which matches what we want for a per-run colour override.
    const tokenId = index.colorIdForPaints([paint]);
    if (tokenId) {
      return `var(--${tokenId})`;
    }
    return colorToCss(paint);
  }
  return undefined;
}

/**
 * Read a Kiwi enum's `name` field from either the bare string-literal
 * form or the `{ name, value }` struct form. Real `.fig` files
 * surface either; TypeScript only sees the literal form because the
 * domain types pre-narrow most read sites.
 */
function readEnumName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { readonly name?: unknown }).name;
    if (typeof name === "string") {
      return name;
    }
  }
  return undefined;
}

function colorToCss(paint: FigPaint): string | undefined {
  const typeName = readEnumName(paint.type);
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
    if (run.color !== undefined) {
      return true;
    }
    if (run.fontFamily !== undefined) {
      return true;
    }
    if (run.fontStyle !== undefined) {
      return true;
    }
    if (run.fontSize !== undefined) {
      return true;
    }
    if (run.lineHeight !== undefined) {
      return true;
    }
    if (run.letterSpacing !== undefined) {
      return true;
    }
  }
  return false;
}
