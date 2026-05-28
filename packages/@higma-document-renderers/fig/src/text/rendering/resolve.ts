/**
 * @file resolveTextRendering — SoT resolver for TEXT nodes
 *
 * Given a Figma TEXT node and a minimal rendering context, this resolves the
 * full, backend-agnostic `TextRendering` shape. Every text-capable renderer
 * (SVG, React, WebGL) goes through this function, eliminating duplicated
 * text-resolution decisions in backend code.
 */

import type { FigBlob, FigStyleRegistry } from "@higma-document-models/fig/domain";
import { EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";
import type { KiwiEnumValue, FigDerivedGlyph, FigDerivedTextData, FigFontMetaData, FigGuid, FigKiwiVariableModeBySetMap, FigTextStyleOverrideEntry } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import { resolveStyledPaint } from "@higma-document-models/fig/symbols";
import { computeTextLayout, extractTextProps, getFillColorAndOpacity } from "../layout";
import type { ExtractedTextProps, TextLayout, TextLayoutSourceLine, TextNodeInput } from "../layout";
import { extractDerivedTextPathData, extractTextPathData, hasDerivedGlyphs } from "../paths";
import { resolveTextCaseGlyph } from "../paths/small-caps-glyph";
import type { PathContour } from "../paths";
import { resolveTextRuns } from "../runs/resolve";
import type { TextRun } from "@higma-document-renderers/fig/scene-graph";
import type {
  TextRendering,
  TextRenderingEmpty,
  TextRenderingGlyphs,
  TextRenderingLines,
  TextTruncation,
  ResolvedFontMetrics,
  TextFontResolver,
} from "./types";

/** Unicode single-codepoint ellipsis (U+2026). */
const ELLIPSIS_CHAR = "\u2026";

/**
 * Build a `measureCharWidths(text)` callback backed by the resolved
 * font. Used by the line-mode layout to pick wrap break points that
 * match the actual rendered glyph metrics.
 *
 * Returns `undefined` when no resolver is registered or when the
 * resolver returns no font for the paragraph's base font. Callers can
 * still supply Kiwi-derived glyph advances; otherwise layout fails
 * instead of estimating.
 */
function buildLineMeasurer(
  props: ExtractedTextProps,
  ctx: { readonly fontResolver?: TextFontResolver },
): ((text: string) => readonly number[]) | undefined {
  if (ctx.fontResolver === undefined) {
    return undefined;
  }
  const family = props.font.family;
  const weight = props.font.weight;
  const style = props.font.style;
  const fontSize = props.fontSize;
  if (!family || !Number.isFinite(fontSize) || fontSize <= 0) {
    return undefined;
  }
  const font = ctx.fontResolver({ family, weight, style });
  if (font === undefined) {
    return undefined;
  }
  const textCase = props.textCase;
  return (text: string): readonly number[] => {
    // Variable fonts re-derive glyph metrics from `opsz`; sync the
    // axis to the rendered font-size before reading advance widths
    // so wrap decisions and paint metrics agree.
    font.setOpticalSize?.(fontSize);
    const scale = fontSize / font.unitsPerEm;
    const letterSpacing = props.letterSpacing ?? 0;
    const widths: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      // Route per-character glyph lookup through `resolveTextCaseGlyph`
      // so small-caps substitution (smcp / c2sc) and the
      // synthesised-fallback shrink ratio are reflected in the
      // measured advance widths — the layout step's wrap and line-fit
      // arithmetic then sees the same glyph-cell widths the path
      // emitter will draw with, keeping measure and paint coherent.
      const resolved = resolveTextCaseGlyph(font, text[i]!, textCase);
      const advance = (resolved.glyph.advanceWidth ?? 0) * scale * resolved.fontSizeScale;
      // Letter spacing pads the *trailing* edge of each glyph,
      // matching CSS `letter-spacing` semantics. The last character
      // gets no trailing pad \u2014 otherwise the rendered width drifts
      // by one letter-spacing unit.
      const padded = i < text.length - 1 ? advance + letterSpacing : advance;
      widths.push(padded);
    }
    return widths;
  };
}

/**
 * Compute the in-box translation Figma applies when the resolved glyph
 * run (`derivedTextData.layoutSize`) is smaller than the TEXT node's own
 * box, given the node's alignment.
 *
 * The raw `glyph.position` coordinates stored in derivedTextData are in
 * the layout's own top-left-origin coordinate space. Figma's own SVG
 * export translates those into the node box according to text alignment:
 *   LEFT   → +0
 *   CENTER → +(boxSize - layoutSize) / 2
 *   RIGHT  → +(boxSize - layoutSize)
 * (vertical: TOP / CENTER / BOTTOM analogously.)
 *
 * Skipping this offset produces a visible shift for any TEXT node whose
 * rendered run is narrower/shorter than the box (e.g. single SF Symbol
 * glyphs in a 70×70 icon box that resolve to a 44×44 layout).
 *
 * When `layoutSize` is missing or matches the box, the offset is (0,0)
 * and this is a no-op.
 */
function computeDerivedAlignmentOffset(
  layoutSize: { readonly x: number; readonly y: number } | undefined,
  boxSize: { readonly width: number; readonly height: number } | undefined,
  textAlignH: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" | undefined,
  textAlignV: "TOP" | "CENTER" | "BOTTOM" | undefined,
): { x: number; y: number } {
  if (!layoutSize || !boxSize) {
    return { x: 0, y: 0 };
  }
  const dx = boxSize.width - layoutSize.x;
  const dy = boxSize.height - layoutSize.y;
  // Only shift when the box is larger than the resolved run. A smaller box
  // than the run means the run overflows; Figma's raw glyph positions in
  // that case already reflect the clipped layout, so don't add an offset.
  const offsetX = computeHorizontalAlignmentOffset(dx, textAlignH);
  const offsetY = computeVerticalAlignmentOffset(dy, textAlignV);
  return { x: offsetX, y: offsetY };
}

function computeHorizontalAlignmentOffset(
  delta: number,
  textAlignH: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" | undefined,
): number {
  if (delta <= 0) { return 0; }
  if (textAlignH === "CENTER") { return delta / 2; }
  if (textAlignH === "RIGHT") { return delta; }
  return 0;
}

function computeVerticalAlignmentOffset(
  delta: number,
  textAlignV: "TOP" | "CENTER" | "BOTTOM" | undefined,
): number {
  if (delta <= 0) { return 0; }
  if (textAlignV === "CENTER") { return delta / 2; }
  if (textAlignV === "BOTTOM") { return delta; }
  return 0;
}

/**
 * Resolve a text truncation directive from a FigNode.
 *
 * Figma stores textTruncation at the node level and, when truncation was
 * actually applied, includes `truncationStartIndex >= 0` inside the node's
 * derivedTextData. Without derivedTextData we cannot know where to cut, so
 * we return undefined and let the renderer emit the full characters.
 */
function resolveTruncation(
  textTruncation: KiwiEnumValue | string | undefined,
  derivedTextData: FigDerivedTextData | undefined,
): TextTruncation | undefined {
  const mode = typeof textTruncation === "string" ? textTruncation : textTruncation?.name;
  if (!derivedTextData) {
    return undefined;
  }
  const startIndex = derivedTextData.truncationStartIndex;
  if (typeof startIndex !== "number" || startIndex < 0) {
    return undefined;
  }
  if (mode !== undefined && mode !== "ENDING") {
    throw new Error(`TEXT derivedTextData truncationStartIndex conflicts with textTruncation=${mode}`);
  }
  const mh = derivedTextData.truncatedHeight;
  return {
    mode: "ENDING",
    startIndex,
    ellipsis: ELLIPSIS_CHAR,
    maxHeight: typeof mh === "number" && mh >= 0 ? mh : undefined,
  };
}

/**
 * Extract the per-line character strings from Figma's derivedLines, if present.
 *
 * Figma's text layout engine stores each resolved line's source text in
 * `derivedLines[i].characters`. When this is available, we trust it as the
 * canonical breakdown — it already reflects BIDI reordering, whitespace
 * collapse, and wrap points from Figma's text engine.
 */
function derivedLineStrings(dtd: FigDerivedTextData | undefined): readonly string[] | undefined {
  const lines = dtd?.derivedLines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return undefined;
  }
  const linesWithCharacters = lines.flatMap((line) => {
    if (typeof line.characters !== "string") {
      return [];
    }
    return [line.characters];
  });
  if (linesWithCharacters.length === 0) {
    return undefined;
  }
  if (linesWithCharacters.length !== lines.length) {
    // A single missing line invalidates the whole set: returning the
    // partial set here would let the downstream layout mix Figma's
    // resolved characters with locally split lines that do not share
    // BIDI / whitespace-collapse / wrap semantics with Figma's
    // resolver. Fail-fast: an input that mixes
    // present and absent `characters` on `derivedLines` violates the
    // SoT contract — either ALL lines must carry characters or NONE
    // should.
    throw new Error(
      `text-resolve:derived-lines:partial-set-invalidated: ${linesWithCharacters.length} of ${lines.length} ` +
      `derivedLines carry characters. Either every line must declare its characters or none should — mixing the two ` +
      `would silently feed locally split lines to a layout the renderer expects to be authoritative.`,
    );
  }
  return linesWithCharacters;
}

function baselineLineStrings(
  dtd: FigDerivedTextData | undefined,
  characters: string,
): readonly string[] | undefined {
  const baselines = dtd?.baselines;
  if (!Array.isArray(baselines) || baselines.length === 0) {
    return undefined;
  }
  const paragraphStarts = paragraphStartOffsets(characters);
  return baselines.map((baseline) => {
    const range = readBaselineCharacterRange(baseline);
    const sourceRange = sourceRangeForCharacterRange(characters, range);
    const paragraphStart = paragraphStarts[sourceRange.paragraphIndex];
    if (paragraphStart === undefined) {
      throw new Error("text-resolve:baseline-line-metrics:missing-paragraph-start");
    }
    return characters.slice(
      paragraphStart + sourceRange.sourceStart,
      paragraphStart + sourceRange.sourceEnd,
    );
  });
}

function sumWidths(widths: readonly number[]): number {
  return widths.reduce((sum, width) => sum + width, 0);
}

type BaselineCharacterRange = {
  readonly firstCharacter: number;
  readonly endCharacter: number;
};

type SourceCharacterRange = {
  readonly paragraphIndex: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
};

type BaselineSourceLineBase = {
  readonly text: string;
  readonly paragraphIndex: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly absoluteSourceStart: number;
  readonly absoluteSourceEnd: number;
  readonly width: number;
  readonly baselineX: number;
  readonly baselineY: number;
};

function readBaselineCharacterRange(
  baseline: NonNullable<FigDerivedTextData["baselines"]>[number],
): BaselineCharacterRange {
  if (typeof baseline.firstCharacter !== "number" || typeof baseline.endCharacter !== "number") {
    throw new Error("text-resolve:baseline-line-metrics:invalid-character-range");
  }
  if (baseline.firstCharacter < 0 || baseline.endCharacter < baseline.firstCharacter) {
    throw new Error("text-resolve:baseline-line-metrics:invalid-character-range");
  }
  return {
    firstCharacter: baseline.firstCharacter,
    endCharacter: baseline.endCharacter,
  };
}

function paragraphEndForStart(
  characters: string,
  paragraphStarts: readonly number[],
  paragraphIndex: number,
): number {
  const nextStart = paragraphStarts[paragraphIndex + 1];
  if (nextStart === undefined) {
    return characters.length;
  }
  return nextStart - 1;
}

function paragraphIndexForCharacter(
  paragraphStarts: readonly number[],
  firstCharacter: number,
): number {
  const followingIndex = paragraphStarts.findIndex((start) => start > firstCharacter);
  if (followingIndex === -1) {
    return paragraphStarts.length - 1;
  }
  return followingIndex - 1;
}

function sourceRangeForCharacterRange(
  characters: string,
  range: BaselineCharacterRange,
): SourceCharacterRange {
  const paragraphStarts = paragraphStartOffsets(characters);
  const paragraphIndex = paragraphIndexForCharacter(paragraphStarts, range.firstCharacter);
  const paragraphStart = paragraphStarts[paragraphIndex];
  if (paragraphStart === undefined) {
    throw new Error("text-resolve:baseline-line-metrics:missing-paragraph-start");
  }
  const paragraphEnd = paragraphEndForStart(characters, paragraphStarts, paragraphIndex);
  const lineEnd = baselineLineEndExcludingParagraphTerminator(characters, range.endCharacter, paragraphEnd);
  if (lineEnd > paragraphEnd) {
    throw new Error("text-resolve:baseline-line-metrics:range-crosses-paragraph");
  }
  return {
    paragraphIndex,
    sourceStart: range.firstCharacter - paragraphStart,
    sourceEnd: lineEnd - paragraphStart,
  };
}

function baselineLineEndExcludingParagraphTerminator(
  characters: string,
  endCharacter: number,
  paragraphEnd: number,
): number {
  if (endCharacter === paragraphEnd + 1 && characters[paragraphEnd] === "\n") {
    return paragraphEnd;
  }
  return endCharacter;
}

function requireFiniteBaselineMetric(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`text-resolve:baseline-line-metrics:invalid-${field}`);
  }
  return value;
}

function resolveBaselineLineWidth(
  dtd: FigDerivedTextData,
  baseline: NonNullable<FigDerivedTextData["baselines"]>[number],
  index: number,
): number {
  const derivedWidth = dtd.derivedLines?.[index]?.width;
  if (derivedWidth !== undefined) {
    return requireFiniteBaselineMetric(derivedWidth, "derived-width");
  }
  return requireFiniteBaselineMetric(baseline.width, "width");
}

function baselineSourceLineBase(params: {
  readonly dtd: FigDerivedTextData;
  readonly characters: string;
  readonly text: string;
  readonly index: number;
}): BaselineSourceLineBase | undefined {
  const baselines = params.dtd.baselines;
  if (!Array.isArray(baselines) || baselines.length === 0) {
    return undefined;
  }
  const baseline = baselines[params.index];
  if (baseline === undefined) {
    throw new Error("text-resolve:derived-line-metrics:missing-baseline");
  }
  const range = readBaselineCharacterRange(baseline);
  const sourceRange = sourceRangeForCharacterRange(params.characters, range);
  return {
    text: params.text,
    paragraphIndex: sourceRange.paragraphIndex,
    sourceStart: sourceRange.sourceStart,
    sourceEnd: sourceRange.sourceEnd,
    absoluteSourceStart: range.firstCharacter,
    absoluteSourceEnd: range.firstCharacter + sourceRange.sourceEnd - sourceRange.sourceStart,
    width: resolveBaselineLineWidth(params.dtd, baseline, params.index),
    baselineX: requireFiniteBaselineMetric(baseline.position?.x, "position-x"),
    baselineY: requireFiniteBaselineMetric(baseline.position?.y, "position-y"),
  };
}

function sourceLineFromBaselineBase(base: BaselineSourceLineBase): TextLayoutSourceLine {
  return {
    text: base.text,
    paragraphIndex: base.paragraphIndex,
    sourceStart: base.sourceStart,
    sourceEnd: base.sourceEnd,
    width: base.width,
    baselineX: base.baselineX,
    baselineY: base.baselineY,
  };
}

function measuredSourceLine(params: {
  readonly text: string;
  readonly paragraphIndex: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly charWidths: readonly number[];
  readonly width?: number;
  readonly baselineX?: number;
  readonly baselineY?: number;
}): TextLayoutSourceLine {
  if (params.charWidths.length !== params.text.length) {
    throw new Error("text-resolve:line-metrics:character-width-length-mismatch");
  }
  for (const width of params.charWidths) {
    if (!Number.isFinite(width) || width < 0) {
      throw new Error("text-resolve:line-metrics:invalid-character-width");
    }
  }
  return {
    text: params.text,
    paragraphIndex: params.paragraphIndex,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    width: params.width ?? sumWidths(params.charWidths),
    charWidths: params.charWidths,
    baselineX: params.baselineX,
    baselineY: params.baselineY,
  };
}

function derivedGlyphPositionBySourceIndex(dtd: FigDerivedTextData): ReadonlyMap<number, FigDerivedGlyph> | undefined {
  const glyphs = dtd.glyphs;
  if (!Array.isArray(glyphs) || glyphs.length === 0) {
    return undefined;
  }
  const positions = new Map<number, FigDerivedGlyph>();
  for (const glyph of glyphs) {
    if (typeof glyph.firstCharacter !== "number") {
      continue;
    }
    if (
      typeof glyph.position?.x !== "number" ||
      !Number.isFinite(glyph.position.x) ||
      typeof glyph.position.y !== "number" ||
      !Number.isFinite(glyph.position.y)
    ) {
      throw new Error("text-resolve:derived-glyph:invalid-position");
    }
    positions.set(glyph.firstCharacter, glyph);
  }
  return positions;
}

function derivedLineWidthsFromGlyphs(
  dtd: FigDerivedTextData,
  characters: string,
  lineTexts: readonly string[],
): readonly TextLayoutSourceLine[] | undefined {
  const glyphsBySourceIndex = derivedGlyphPositionBySourceIndex(dtd);
  if (glyphsBySourceIndex === undefined) {
    return undefined;
  }
  return lineTexts.map((text, index) => {
    const baseline = dtd.baselines?.[index];
    if (baseline === undefined) {
      throw new Error("text-resolve:derived-line-metrics:missing-baseline");
    }
    const base = baselineSourceLineBase({
      dtd,
      characters,
      text,
      index,
    });
    if (base === undefined) {
      throw new Error("text-resolve:derived-line-metrics:missing-baseline");
    }
    const charWidths = derivedGlyphClusterWidthsForLine({
      glyphsBySourceIndex,
      lineWidth: base.width,
      baselineX: base.baselineX,
      lineSourceStart: base.absoluteSourceStart,
      lineSourceEnd: base.absoluteSourceEnd,
    });
    return measuredSourceLine({
      text,
      paragraphIndex: base.paragraphIndex,
      sourceStart: base.sourceStart,
      sourceEnd: base.sourceEnd,
      charWidths,
      width: base.width,
      baselineX: base.baselineX,
      baselineY: base.baselineY,
    });
  });
}

function sourceIndexesForRange(start: number, end: number): readonly number[] {
  if (end < start) {
    throw new Error("text-resolve:derived-line-metrics:invalid-source-range");
  }
  return Array.from({ length: end - start }, (_item, offset) => start + offset);
}

type DerivedGlyphClusterStart = {
  readonly sourceIndex: number;
  readonly glyph: FigDerivedGlyph;
};

function glyphStartsForLine(input: {
  readonly glyphsBySourceIndex: ReadonlyMap<number, FigDerivedGlyph>;
  readonly lineSourceStart: number;
  readonly lineSourceEnd: number;
}): readonly DerivedGlyphClusterStart[] {
  if (input.lineSourceStart === input.lineSourceEnd) {
    return [];
  }
  return sourceIndexesForRange(input.lineSourceStart, input.lineSourceEnd)
    .flatMap((sourceIndex) => {
      const glyph = input.glyphsBySourceIndex.get(sourceIndex);
      if (glyph === undefined) {
        return [];
      }
      return [{ sourceIndex, glyph }];
    });
}

function nextClusterSourceIndexOrLineEnd(
  glyphStarts: readonly DerivedGlyphClusterStart[],
  index: number,
  lineSourceEnd: number,
): number {
  const next = glyphStarts[index + 1]?.sourceIndex;
  if (next === undefined) {
    return lineSourceEnd;
  }
  return next;
}

function leadingGlyphClusterWidths(input: {
  readonly first: DerivedGlyphClusterStart;
  readonly lineSourceStart: number;
  readonly baselineX: number;
}): readonly number[] {
  if (input.first.sourceIndex === input.lineSourceStart) {
    return [];
  }
  return glyphClusterCharacterWidths(
    input.first.sourceIndex - input.lineSourceStart,
    requireDerivedGlyphWidth(input.first.glyph.position.x - input.baselineX),
  );
}

function glyphWidthsFromAdvanceClusters(input: {
  readonly glyphStarts: readonly DerivedGlyphClusterStart[];
  readonly lineSourceEnd: number;
}): readonly number[] {
  return input.glyphStarts.flatMap((entry, index) => {
    const nextSourceIndex = nextClusterSourceIndexOrLineEnd(input.glyphStarts, index, input.lineSourceEnd);
    return glyphClusterCharacterWidths(
      nextSourceIndex - entry.sourceIndex,
      requireDerivedGlyphWidth(entry.glyph.advance),
    );
  });
}

function glyphClusterCharacterWidths(clusterLength: number, width: number): readonly number[] {
  if (clusterLength < 1) {
    throw new Error("text-resolve:derived-line-metrics:invalid-glyph-cluster");
  }
  return Array.from({ length: clusterLength }, (_item, index) => {
    if (index === 0) {
      return width;
    }
    return 0;
  });
}

function derivedGlyphClusterWidthsForLine(input: {
  readonly glyphsBySourceIndex: ReadonlyMap<number, FigDerivedGlyph>;
  readonly lineWidth: number;
  readonly baselineX: number;
  readonly lineSourceStart: number;
  readonly lineSourceEnd: number;
}): readonly number[] {
  if (input.lineSourceStart === input.lineSourceEnd) {
    return [];
  }
  const glyphStarts = glyphStartsForLine(input);
  if (glyphStarts.length === 0) {
    return glyphClusterCharacterWidths(input.lineSourceEnd - input.lineSourceStart, input.lineWidth);
  }
  const first = glyphStarts[0];
  if (first === undefined) {
    throw new Error("text-resolve:derived-line-metrics:missing-glyph-position");
  }
  const leadingWidths = leadingGlyphClusterWidths({
    first,
    lineSourceStart: input.lineSourceStart,
    baselineX: input.baselineX,
  });
  const glyphWidths = glyphWidthsFromAdvanceClusters({ glyphStarts, lineSourceEnd: input.lineSourceEnd });
  return [...leadingWidths, ...glyphWidths];
}

function requireDerivedGlyphWidth(width: number): number {
  if (!Number.isFinite(width) || width < 0) {
    throw new Error("text-resolve:derived-line-metrics:invalid-glyph-width");
  }
  return width;
}

function lineMetricsFromMeasurer(
  dtd: FigDerivedTextData,
  characters: string,
  lineTexts: readonly string[],
  measureCharWidths: (text: string) => readonly number[],
): readonly TextLayoutSourceLine[] {
  return lineTexts.map((text, index) => {
    const base = baselineSourceLineBase({ dtd, characters, text, index });
    if (base !== undefined) {
      return measuredSourceLine({
        text,
        paragraphIndex: base.paragraphIndex,
        sourceStart: base.sourceStart,
        sourceEnd: base.sourceEnd,
        charWidths: measureCharWidths(text),
        width: base.width,
        baselineX: base.baselineX,
        baselineY: base.baselineY,
      });
    }
    return measuredSourceLine({
      text,
      paragraphIndex: index,
      sourceStart: 0,
      sourceEnd: text.length,
      charWidths: measureCharWidths(text),
    });
  });
}

function lineMetricsFromBaselines(
  dtd: FigDerivedTextData,
  characters: string,
  lineTexts: readonly string[],
): readonly TextLayoutSourceLine[] | undefined {
  const baselines = dtd.baselines;
  if (!Array.isArray(baselines) || baselines.length === 0) {
    return undefined;
  }
  return lineTexts.map((text, index) => {
    const base = baselineSourceLineBase({ dtd, characters, text, index });
    if (base === undefined) {
      throw new Error("text-resolve:derived-line-metrics:missing-baseline");
    }
    return sourceLineFromBaselineBase(base);
  });
}

function resolveDerivedLayoutLines(
  dtd: FigDerivedTextData | undefined,
  props: ExtractedTextProps,
  measureCharWidths: ((text: string) => readonly number[]) | undefined,
): readonly TextLayoutSourceLine[] | undefined {
  const lineTexts = derivedLineStrings(dtd) ?? baselineLineStrings(dtd, props.characters);
  if (lineTexts === undefined) {
    return undefined;
  }
  if (dtd === undefined) {
    return undefined;
  }
  const derivedLines = derivedLineWidthsFromGlyphs(dtd, props.characters, lineTexts);
  if (derivedLines !== undefined) {
    return derivedLines;
  }
  if (measureCharWidths !== undefined) {
    return lineMetricsFromMeasurer(dtd, props.characters, lineTexts, measureCharWidths);
  }
  const baselineLines = lineMetricsFromBaselines(dtd, props.characters, lineTexts);
  if (baselineLines !== undefined) {
    return baselineLines;
  }
  throw new Error("text-resolve:derived-line-metrics:requires-font-or-glyph-advances");
}

function shouldUseKiwiDerivedLayoutLinesForTruncatedText(dtd: FigDerivedTextData | undefined): boolean {
  return Array.isArray(dtd?.baselines) && dtd.baselines.length > 0;
}

function resolveExplicitTextLayoutLines(params: {
  readonly dtd: FigDerivedTextData | undefined;
  readonly props: ExtractedTextProps;
  readonly displayProps: ExtractedTextProps;
  readonly truncation: TextTruncation | undefined;
  readonly measureCharWidths: ((text: string) => readonly number[]) | undefined;
}): readonly TextLayoutSourceLine[] | undefined {
  if (params.truncation === undefined) {
    return resolveDerivedLayoutLines(params.dtd, params.displayProps, params.measureCharWidths);
  }
  if (shouldUseKiwiDerivedLayoutLinesForTruncatedText(params.dtd)) {
    return resolveDerivedLayoutLines(params.dtd, params.props, params.measureCharWidths);
  }
  return undefined;
}

/**
 * Resolve font metrics from Figma's fontMetaData.
 *
 * Figma records `fontLineHeight` (em-relative multiplier) alongside font
 * identity for every TEXT node whose derivedTextData was exported. When
 * multiple font entries exist (e.g. mixed runs), the first entry is the
 * dominant one for the line; more sophisticated per-run metrics could be
 * added later. Returns undefined when no metadata is available.
 */
function resolveFontMetrics(dtd: FigDerivedTextData | undefined): ResolvedFontMetrics | undefined {
  const list = dtd?.fontMetaData;
  if (!Array.isArray(list) || list.length === 0) {
    return undefined;
  }
  const m: FigFontMetaData = list[0];
  const lh = readPositiveFontLineHeight(m.fontLineHeight);
  if (lh === undefined) {
    return undefined;
  }
  const baseline = dtd?.baselines?.[0];
  if (!baseline) {
    return undefined;
  }
  const lineAscent = readDerivedBaselineLineAscent(baseline);
  if (lineAscent === undefined) {
    return undefined;
  }
  return {
    fontFamily: m.key?.family,
    fontWeight: m.fontWeight,
    fontLineHeight: lh,
    ascenderRatio: lineAscent / (baseline.lineHeight / lh),
  };
}

function readDerivedBaselineLineAscent(
  baseline: NonNullable<FigDerivedTextData["baselines"]>[number],
): number | undefined {
  if (typeof baseline.lineAscent === "number" && Number.isFinite(baseline.lineAscent) && baseline.lineAscent > 0) {
    return baseline.lineAscent;
  }
  if (
    typeof baseline.position?.y !== "number" ||
    !Number.isFinite(baseline.position.y) ||
    typeof baseline.lineY !== "number" ||
    !Number.isFinite(baseline.lineY)
  ) {
    return undefined;
  }
  const lineAscent = baseline.position.y - baseline.lineY;
  if (!Number.isFinite(lineAscent) || lineAscent <= 0) {
    return undefined;
  }
  return lineAscent;
}

function readDerivedMetricEmSize(
  dtd: FigDerivedTextData | undefined,
  props: ExtractedTextProps,
): number | undefined {
  const baseline = dtd?.baselines?.[0];
  const fontLineHeight = readPositiveFontLineHeight(dtd?.fontMetaData?.[0]?.fontLineHeight);
  if (
    fontLineHeight !== undefined &&
    typeof baseline?.lineHeight === "number" &&
    Number.isFinite(baseline.lineHeight) &&
    baseline.lineHeight > 0
  ) {
    return baseline.lineHeight / fontLineHeight;
  }
  if (Number.isFinite(props.fontSize) && props.fontSize > 0) {
    return props.fontSize;
  }
  return undefined;
}

function resolveDerivedAscenderRatio(
  dtd: FigDerivedTextData | undefined,
  props: ExtractedTextProps,
): number | undefined {
  const baseline = dtd?.baselines?.[0];
  if (baseline === undefined) {
    return undefined;
  }
  const lineAscent = readDerivedBaselineLineAscent(baseline);
  const emSize = readDerivedMetricEmSize(dtd, props);
  if (lineAscent === undefined || emSize === undefined || emSize <= 0) {
    return undefined;
  }
  return lineAscent / emSize;
}

/**
 * Resolve the ascender ratio from derived metadata or an explicit font resolver.
 */
function resolveTextAscenderRatio(
  node: TextNodeInput,
  props: ExtractedTextProps,
  ctx: ResolveTextContext,
): number {
  const dtd = node.derivedTextData as FigDerivedTextData | undefined;
  const metrics = resolveFontMetrics(dtd);
  if (metrics) {
    return metrics.ascenderRatio;
  }
  const derivedAscenderRatio = resolveDerivedAscenderRatio(dtd, props);
  if (derivedAscenderRatio !== undefined) {
    return derivedAscenderRatio;
  }
  const font = ctx.fontResolver?.(props.font);
  if (font) {
    return typoAscenderUnits(font) / font.unitsPerEm;
  }
  throw new Error(`Text layout requires ascender metrics for font "${props.font.family}"`);
}

/**
 * Resolve the descender ratio (|descender| / unitsPerEm).
 *
 * Like `resolveTextAscenderRatio` this prefers `OS/2.sTypoDescender`
 * over the legacy `hhea` value so the content-area height matches what
 * modern browsers compute per CSS Inline L3.
 */
function resolveTextDescenderRatio(
  node: TextNodeInput,
  props: ExtractedTextProps,
  ctx: ResolveTextContext,
): number {
  const dtd = node.derivedTextData as FigDerivedTextData | undefined;
  const derivedDescenderRatio = resolveDerivedDescenderRatio(dtd, props);
  if (derivedDescenderRatio !== undefined) {
    return derivedDescenderRatio;
  }
  const font = ctx.fontResolver?.(props.font);
  if (font) {
    // Convert the descender (negative in font units) to a positive
    // ratio against unitsPerEm. The metric matches what the measure
    // provider exposes through `FontMetrics.descender`.
    return Math.abs(typoDescenderUnits(font)) / font.unitsPerEm;
  }
  throw new Error(`Text layout requires descender metrics for font "${props.font.family}"`);
}

function resolveDerivedDescenderRatio(
  dtd: FigDerivedTextData | undefined,
  props: ExtractedTextProps,
): number | undefined {
  const baseline = dtd?.baselines?.[0];
  if (baseline === undefined) {
    return undefined;
  }
  const lineAscent = readDerivedBaselineLineAscent(baseline);
  if (
    lineAscent === undefined ||
    typeof baseline.lineHeight !== "number" ||
    !Number.isFinite(baseline.lineHeight) ||
    baseline.lineHeight <= 0
  ) {
    return undefined;
  }
  const derivedDescent = baseline.lineHeight - lineAscent;
  if (!Number.isFinite(derivedDescent) || derivedDescent < 0) {
    return undefined;
  }
  const emSize = readDerivedMetricEmSize(dtd, props);
  if (emSize === undefined || emSize <= 0) {
    return undefined;
  }
  return derivedDescent / emSize;
}

/**
 * `OS/2.fsSelection` bit 7 — the spec-defined `USE_TYPO_METRICS`
 * opt-in. Per CSS Inline L3 §5.5 the renderer must consult
 * `sTypoAscender`/`sTypoDescender` only when this bit is set;
 * otherwise the legacy `hhea.ascender`/`hhea.descender` pair drives
 * line layout. Pulled into a named constant so the bit-test reads
 * the same in both ascender and descender helpers.
 */
const OS2_USE_TYPO_METRICS_MASK = 0x80;

/**
 * Whether the font opts into CSS Inline L3 typo metrics. A font with
 * the bit clear (or with no OS/2 table at all) keeps the legacy hhea
 * pair — critical for CJK faces like Noto Sans JP that ship a tight
 * sTypoAscender (880u) but a tall hhea ascender (1160u) sized to
 * match the larger CJK glyph extents. Browsers and Figma's SVG
 * exporter both follow the same rule, so matching them here removes
 * the 1px first-line baseline drift the unconditional sTypo path
 * leaves behind on those fonts.
 */
function fontUsesTypoMetrics(font: { readonly tables?: { readonly os2?: { readonly fsSelection?: number } } }): boolean {
  const fsSelection = font.tables?.os2?.fsSelection;
  if (typeof fsSelection !== "number") {
    return false;
  }
  return (fsSelection & OS2_USE_TYPO_METRICS_MASK) !== 0;
}

/**
 * Read the typographic ascender from an `AbstractFont`. Uses
 * `OS/2.sTypoAscender` only when the font opts into typo metrics via
 * `fsSelection` bit 7 (`USE_TYPO_METRICS`); otherwise falls back to
 * `hhea.ascender` (exposed via `font.ascender` in opentype.js) — the
 * CSS Inline L3 §5.5 fallback that browsers and Figma both honour.
 * The legacy `font.ascender` itself remains the final fallback for
 * fonts that ship no OS/2 table at all.
 */
function typoAscenderUnits(font: { readonly ascender: number; readonly tables?: { readonly hhea?: { readonly ascender?: number }; readonly os2?: { readonly sTypoAscender?: number; readonly fsSelection?: number } } }): number {
  if (fontUsesTypoMetrics(font)) {
    const typo = font.tables?.os2?.sTypoAscender;
    if (typeof typo === "number") {
      return typo;
    }
  }
  const hhea = font.tables?.hhea?.ascender;
  if (typeof hhea === "number") {
    return hhea;
  }
  return font.ascender;
}

/**
 * Read the typographic descender (negative in font units). Same
 * `USE_TYPO_METRICS`-gated precedence as `typoAscenderUnits`: the
 * sTypoDescender wins only when the font sets `fsSelection` bit 7;
 * otherwise `hhea.descender` (then the legacy `font.descender`).
 */
function typoDescenderUnits(font: { readonly descender: number; readonly tables?: { readonly hhea?: { readonly descender?: number }; readonly os2?: { readonly sTypoDescender?: number; readonly fsSelection?: number } } }): number {
  if (fontUsesTypoMetrics(font)) {
    const typo = font.tables?.os2?.sTypoDescender;
    if (typeof typo === "number") {
      return typo;
    }
  }
  const hhea = font.tables?.hhea?.descender;
  if (typeof hhea === "number") {
    return hhea;
  }
  return font.descender;
}

/**
 * Apply a truncation directive to a source string.
 *
 * The source is sliced at the codepoint index `truncation.startIndex` and
 * appended with the ellipsis. This matches Figma's tail-ellipsis behavior:
 * the final visible glyph may be part of the ellipsis, not of the original
 * text. The slice is by codepoints (not UTF-16 units) so SF Symbols / emoji
 * are cut cleanly.
 */
function applyTruncation(source: string, truncation: TextTruncation): string {
  const cps = [...source];
  if (truncation.startIndex >= cps.length) {
    return source;
  }
  return cps.slice(0, truncation.startIndex).join("") + truncation.ellipsis;
}

function resolveDisplayProps(
  props: ExtractedTextProps,
  truncation: TextTruncation | undefined,
): ExtractedTextProps {
  if (!truncation) { return props; }
  return { ...props, characters: applyTruncation(props.characters, truncation) };
}

function readPositiveFontLineHeight(fontLineHeight: unknown): number | undefined {
  if (typeof fontLineHeight === "number" && fontLineHeight > 0) {
    return fontLineHeight;
  }
  return undefined;
}

/**
 * Minimal context needed to resolve a TEXT node.
 *
 * `blobs` is required to decode glyph path commands.
 */
export type ResolveTextContext = {
  readonly blobs?: readonly FigBlob[];
  readonly fontResolver?: TextFontResolver;
  /**
   * Document-wide style registry for resolving TEXT `styleIdForFill`
   * and per-character override `styleIdForFill` references. Rendering
   * a styled TEXT without this registry is invalid because the
   * registry is the file-level paint SoT.
   */
  readonly styleRegistry?: FigStyleRegistry;
  readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
};

export type TextLayoutResolution = {
  readonly props: ExtractedTextProps;
  readonly displayProps: ExtractedTextProps;
  readonly layout: TextLayout;
  readonly truncation: TextTruncation | undefined;
  readonly fontMetrics: ResolvedFontMetrics | undefined;
  readonly ascenderRatio: number;
  readonly descenderRatio: number;
};

/**
 * Read per-character style metadata from a raw TEXT node. Returns
 * `undefined` for each field when the node carries no character-level
 * styling.
 */
function readPerCharStyleData(node: TruncatableTextNode): {
  characterStyleIDs: readonly number[] | undefined;
  styleOverrideTable: readonly FigTextStyleOverrideEntry[] | undefined;
} {
  const textData = (node as { textData?: { characterStyleIDs?: readonly number[]; styleOverrideTable?: readonly unknown[] } }).textData;
  return {
    characterStyleIDs: textData?.characterStyleIDs,
    styleOverrideTable: textData?.styleOverrideTable as readonly FigTextStyleOverrideEntry[] | undefined,
  };
}

/**
 * Diagnostic label for unresolved style references during run resolution.
 *
 * Uses the Kiwi node GUID for diagnostics.
 */
function pickGuidString(shaped: { guid?: FigGuid }): string {
  if (shaped.guid) { return guidToString(shaped.guid); }
  return "<no-guid>";
}

function formatTextNodeLocator(node: TruncatableTextNode): string {
  const shaped = node as { guid?: FigGuid; name?: string };
  const guidStr = pickGuidString(shaped);
  const name = shaped.name ?? "?";
  return `text node ${guidStr} (${name})`;
}

/**
 * Build decoration contours from axis-aligned rectangles.
 *
 * Kept local to this module (vs. scene-graph/convert/text.ts) so the SoT
 * depends only on `text/` internals and the domain types.
 */
function decorationsToContours(
  rects: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[],
): PathContour[] {
  return rects.map((r) => ({
    commands: [
      { type: "M" as const, x: r.x, y: r.y },
      { type: "L" as const, x: r.x + r.width, y: r.y },
      { type: "L" as const, x: r.x + r.width, y: r.y + r.height },
      { type: "L" as const, x: r.x, y: r.y + r.height },
      { type: "Z" as const },
    ],
  }));
}

function resolveFontGlyphRendering(params: {
  readonly displayProps: ReturnType<typeof extractTextProps>;
  readonly layout: ReturnType<typeof computeTextLayout>;
  readonly runs: readonly TextRun[];
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly truncation: TextTruncation | undefined;
  readonly fontResolver: TextFontResolver | undefined;
}): TextRenderingGlyphs | undefined {
  const { displayProps, layout, runs, fillColor, fillOpacity, truncation, fontResolver } = params;
  if (!fontResolver) {
    return undefined;
  }
  const firstLine = layout.lines[0];
  if (!firstLine) {
    return undefined;
  }
  const font = fontResolver(displayProps.font);
  if (!font) {
    return undefined;
  }
  const sourceStarts = lineSourceStarts(displayProps.characters, layout.lines);
  const positionedLines = layout.lines.map((line, index) => ({
    text: line.text,
    x: line.x,
    y: line.y,
    sourceStart: sourceStarts[index] ?? 0,
  }));
  const pathData = extractTextPathData({
    lines: positionedLines,
    font,
    fontSize: displayProps.fontSize,
    align: displayProps.textAlignHorizontal,
    letterSpacing: displayProps.letterSpacing,
    textDecoration: displayProps.textDecoration,
    textCase: displayProps.textCase,
    fontForCharacter: (sourceIndex) => {
      const run = runForCharacter(runs, sourceIndex);
      if (run?.font === undefined) {
        return font;
      }
      const runFont = fontResolver(run.font);
      if (!runFont) {
        throw new Error(`Text rendering requires preloaded run font "${run.font.family}" for character index ${sourceIndex}`);
      }
      return runFont;
    },
  });
  if (pathData.glyphContours.length === 0 && pathData.decorations.length === 0) {
    return undefined;
  }
  return {
    kind: "glyphs",
    glyphContours: pathData.glyphContours,
    decorationContours: decorationsToContours(pathData.decorations),
    runs,
    fillColor,
    fillOpacity,
    transform: displayProps.transform,
    opacity: displayProps.opacity,
    props: displayProps,
    layout,
    truncation,
  };
}

function runForCharacter(runs: readonly TextRun[], sourceIndex: number): TextRun | undefined {
  return runs.find((run) => sourceIndex >= run.start && sourceIndex < run.end);
}

function lineSourceStarts(characters: string, lines: ReturnType<typeof computeTextLayout>["lines"]): readonly number[] {
  const paragraphStarts = paragraphStartOffsets(characters);
  return lines.map((line) => {
    const paragraphStart = paragraphStarts[line.paragraphIndex];
    if (paragraphStart === undefined) {
      throw new Error(`Text rendering line references missing paragraph ${line.paragraphIndex}`);
    }
    return paragraphStart + line.sourceStart;
  });
}

function paragraphStartOffsets(characters: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < characters.length; index++) {
    if (characters[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

/**
 * Narrow TextNodeInput to the raw shape that carries textTruncation.
 */
type TruncatableTextNode = TextNodeInput & {
  readonly derivedTextData?: FigDerivedTextData;
  readonly textTruncation?: KiwiEnumValue | string;
  readonly textData?: TextNodeInput["textData"] & {
    readonly textTruncation?: KiwiEnumValue | string;
  };
};

function resolveTextLayoutFromProps(
  node: TruncatableTextNode,
  props: ExtractedTextProps,
  ctx: ResolveTextContext,
): TextLayoutResolution {
  const dtd = node.derivedTextData;
  const truncation = resolveTruncation(
    node.textTruncation ?? node.textData?.textTruncation,
    dtd,
  );
  const fontMetrics = resolveFontMetrics(dtd);
  const ascenderRatio = resolveTextAscenderRatio(node, props, ctx);
  const descenderRatio = resolveTextDescenderRatio(node, props, ctx);
  const displayProps = resolveDisplayProps(props, truncation);
  const measureCharWidths = buildLineMeasurer(displayProps, ctx);
  const explicitLines = resolveExplicitTextLayoutLines({
    dtd,
    props,
    displayProps,
    truncation,
    measureCharWidths,
  });
  const rawLayout = computeTextLayout({
    props: displayProps,
    lines: explicitLines,
    ascenderRatio,
    descenderRatio,
    measureCharWidths,
  });
  // Fallback height-based truncation: Figma's `truncationStartIndex` is
  // only present when the file passed through the editor (which runs
  // layout + truncation before persisting). Builder-authored `.fig`s
  // ship with `textTruncation=ENDING` but no resolved start index, so
  // the renderer has to compute the cut itself.
  const layout = applyHeightTruncationFallback(
    rawLayout,
    node.textTruncation ?? node.textData?.textTruncation,
    displayProps,
    dtd,
  );
  return {
    props,
    displayProps,
    layout,
    truncation,
    fontMetrics,
    ascenderRatio,
    descenderRatio,
  };
}

/**
 * Truncate the laid-out lines to what fits inside the text box's
 * declared height when `textTruncation=ENDING` is authored on the node
 * but `derivedTextData.truncationStartIndex` is absent (builder-
 * authored `.fig` — Figma's editor would have written the index but
 * the builder pipeline has no layout step that does so).
 *
 * The trim is line-count based, not character based: `lineHeight`
 * defines the visible row height, so `floor(size.height / lineHeight)`
 * lines remain visible. An ellipsis (`U+2026`) is appended to the
 * last surviving line's text — the path emitter then renders the
 * marker as part of that line's glyph stream.
 */
function applyHeightTruncationFallback(
  layout: ReturnType<typeof computeTextLayout>,
  textTruncation: KiwiEnumValue | string | undefined,
  displayProps: ExtractedTextProps,
  dtd: FigDerivedTextData | undefined,
): ReturnType<typeof computeTextLayout> {
  const mode = typeof textTruncation === "string" ? textTruncation : textTruncation?.name;
  if (mode !== "ENDING") { return layout; }
  if (typeof dtd?.truncationStartIndex === "number" && dtd.truncationStartIndex >= 0) {
    return layout;
  }
  const size = displayProps.size;
  if (!size || size.height <= 0) { return layout; }
  if (layout.lineHeight <= 0) { return layout; }
  const maxLines = Math.max(1, Math.floor(size.height / layout.lineHeight));
  if (layout.lines.length <= maxLines) { return layout; }
  const keep = layout.lines.slice(0, maxLines);
  const lastIndex = keep.length - 1;
  const last = keep[lastIndex];
  const truncatedLines = keep.map((line, idx) => (
    idx === lastIndex ? { ...line, text: `${last.text}${ELLIPSIS_CHAR}` } : line
  ));
  return { ...layout, lines: truncatedLines };
}

/** Resolve the canonical text layout used by renderers and editor overlays. */
export function resolveTextLayout(
  node: TruncatableTextNode,
  ctx: ResolveTextContext,
): TextLayoutResolution {
  const props = resolveTextProps(node, ctx);
  return resolveTextLayoutFromProps(node, props, ctx);
}

/**
 * Resolve a TEXT node to its final renderable form.
 *
 * Strategy selection:
 *   1. If `blobs` + `derivedTextData.glyphs` available → `glyphs` strategy
 *      (pixel-perfect, survives missing fonts / SF Symbols).
 *   2. Otherwise → `lines` strategy (system font / opentype.js paths),
 *      with tail-ellipsis truncation applied to the source characters
 *      when Figma's layout engine has pre-computed a truncationStartIndex.
 *
 * Missing required sources still fail-fast: an empty-text node is the only
 * case that returns `{ kind: "empty" }` without resolving metrics.
 */
export function resolveTextRendering(
  node: TruncatableTextNode,
  ctx: ResolveTextContext,
): TextRendering {
  const props = resolveTextProps(node, ctx);
  if (props.characters.length === 0) {
    return { kind: "empty" };
  }

  const { color: fillColor, opacity: fillOpacity } = getFillColorAndOpacity(props.fillPaints);

  // Resolve per-character fill runs through the shared SoT. The base run's
  // colour matches `fillColor` above; additional runs come from
  // `textData.characterStyleIDs` + `textData.styleOverrideTable`. The
  // registry is consulted lazily — only nodes with overrides referencing
  // shared styles actually require it.
  const { characterStyleIDs, styleOverrideTable } = readPerCharStyleData(node);
  const runs = resolveTextRuns({
    characters: props.characters,
    baseFillPaints: props.fillPaints,
    characterStyleIDs,
    styleOverrideTable,
    styleRegistry: ctx.styleRegistry ?? EMPTY_FIG_STYLE_REGISTRY,
    variableModeBySetMap: ctx.variableModeBySetMap,
    locator: () => formatTextNodeLocator(node),
  });

  const dtd = node.derivedTextData;
  const layoutResolution = resolveTextLayoutFromProps(node, props, ctx);

  // Glyph-mode when pre-outlined paths are available and we can decode them.
  // Figma has already applied truncation to the glyph positions, so we pass
  // the truncation metadata through unchanged.
  if (hasDerivedGlyphs(dtd) && ctx.blobs === undefined) {
    throw new Error("Text glyph rendering requires blobs when derived glyphs are present");
  }
  const derivedGlyphRendering = resolveDerivedGlyphRendering({
    dtd,
    props,
    ctx,
    runs,
    fillColor,
    fillOpacity,
    layout: layoutResolution.layout,
    truncation: layoutResolution.truncation,
  });
  if (derivedGlyphRendering !== undefined) {
    return derivedGlyphRendering;
  }

  const fontGlyphs = resolveFontGlyphRendering({
    displayProps: layoutResolution.displayProps,
    layout: layoutResolution.layout,
    runs,
    fillColor,
    fillOpacity,
    truncation: layoutResolution.truncation,
    fontResolver: ctx.fontResolver,
  });
  if (fontGlyphs) {
    return fontGlyphs;
  }

  const lines: TextRenderingLines = {
    kind: "lines",
    layout: layoutResolution.layout,
    runs,
    fillColor,
    fillOpacity,
    transform: layoutResolution.displayProps.transform,
    opacity: layoutResolution.displayProps.opacity,
    props: layoutResolution.displayProps,
    truncation: layoutResolution.truncation,
    fontMetrics: layoutResolution.fontMetrics,
  };
  return lines;
}

function resolveTextProps(
  node: TruncatableTextNode,
  ctx: ResolveTextContext,
): ExtractedTextProps {
  const styleRegistry = requireTextStyleRegistry(node, ctx);
  const fillPaints = resolveStyledPaint(node.styleIdForFill, node.fillPaints, styleRegistry, {
    variableModeBySetMap: ctx.variableModeBySetMap,
  });
  if (fillPaints === node.fillPaints) {
    return extractTextProps(node);
  }
  return extractTextProps({ ...node, fillPaints });
}

function requireTextStyleRegistry(
  node: TruncatableTextNode,
  ctx: ResolveTextContext,
): FigStyleRegistry {
  if (ctx.styleRegistry !== undefined) {
    return ctx.styleRegistry;
  }
  if (node.styleIdForFill !== undefined) {
    throw new Error("Text rendering requires styleRegistry for TEXT styleIdForFill");
  }
  return EMPTY_FIG_STYLE_REGISTRY;
}

type DerivedGlyphRenderingInput = {
  readonly dtd: FigDerivedTextData | undefined;
  readonly props: ExtractedTextProps;
  readonly ctx: ResolveTextContext;
  readonly runs: readonly TextRun[];
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly layout: TextLayout;
  readonly truncation: TextTruncation | undefined;
};

function resolveDerivedGlyphRendering(input: DerivedGlyphRenderingInput): TextRenderingGlyphs | TextRenderingEmpty | undefined {
  const { dtd, props, ctx, runs, fillColor, fillOpacity, layout, truncation } = input;
  if (dtd === undefined || !hasDerivedGlyphs(dtd) || ctx.blobs === undefined) {
    return undefined;
  }
  const alignmentOffset = computeDerivedAlignmentOffset(
    dtd?.layoutSize,
    props.size,
    props.textAlignHorizontal,
    props.textAlignVertical,
  );
  const pathData = extractDerivedTextPathData(dtd, ctx.blobs, alignmentOffset);
  if (pathData.glyphContours.length === 0 && pathData.decorations.length === 0) {
    return isDerivedGlyphPlaceholderText(props.characters, dtd) ? { kind: "empty" } : undefined;
  }
  return {
    kind: "glyphs",
    glyphContours: pathData.glyphContours,
    decorationContours: decorationsToContours(pathData.decorations),
    runs,
    fillColor,
    fillOpacity,
    transform: props.transform,
    opacity: props.opacity,
    props,
    layout,
    truncation,
  };
}

function isDerivedGlyphPlaceholderText(characters: string, derivedTextData: FigDerivedTextData | undefined): boolean {
  if (!hasDerivedGlyphs(derivedTextData)) {
    return false;
  }
  const codepoints = Array.from(characters);
  if (codepoints.length === 0) {
    return false;
  }
  return codepoints.every((char) => char === "\uFFFC");
}
