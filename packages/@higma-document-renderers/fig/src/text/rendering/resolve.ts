/**
 * @file resolveTextRendering — SoT resolver for TEXT nodes
 *
 * Given a Figma TEXT node and a minimal rendering context, this resolves the
 * full, backend-agnostic `TextRendering` shape. Every text-capable renderer
 * (SVG, React, WebGL) goes through this function, eliminating the duplicated
 * "check derivedTextData? fall back to font? extract props?" ladder that
 * previously lived in each renderer.
 */

import type { FigBlob, FigStyleRegistry, TextStyleOverride } from "@higma-document-models/fig/domain";
import { EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";
import type { DerivedTextData } from "@higma-document-models/fig/domain";
import type { KiwiEnumValue, FigDerivedTextData, FigFontMetaData, FigPaint, FigGuid } from "@higma-document-models/fig/types";
import { defensiveMark } from "@higma-document-models/fig/diagnostics/defensive";
import { guidToString } from "@higma-document-models/fig/domain";
import { extractTextProps } from "../layout/extract-props";
import type { TextNodeInput } from "../layout/extract-props";
import type { ExtractedTextProps } from "../layout/types";
import { getFillColorAndOpacity } from "../layout/fill";
import { computeTextLayout } from "../layout/compute-layout";
import { extractDerivedTextPathData, hasDerivedGlyphs } from "../paths/derived-paths";
import { extractTextPathData } from "../paths/opentype-paths";
import type { PathContour } from "../paths/types";
import { resolveTextRuns } from "../runs";
import type { TextRun } from "../runs";
import type {
  TextRendering,
  TextRenderingGlyphs,
  TextRenderingLines,
  TextTruncation,
  ResolvedFontMetrics,
  TextFontResolver,
} from "./types";

/** Unicode single-codepoint ellipsis (U+2026). */
const ELLIPSIS_CHAR = "\u2026";

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
  derivedTextData: DerivedTextData | undefined,
): TextTruncation | undefined {
  const mode = typeof textTruncation === "string" ? textTruncation : textTruncation?.name;
  if (mode !== "ENDING") {
    return undefined;
  }
  if (!derivedTextData) {
    return undefined;
  }
  const startIndex = derivedTextData.truncationStartIndex;
  if (typeof startIndex !== "number" || startIndex < 0) {
    return undefined;
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
 * collapse, and wrap points that our heuristic splitter would only
 * approximate.
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
    // A single missing line invalidates the set — don't mix derived & guessed lines.
    defensiveMark("text-resolve:derived-lines:partial-set-invalidated", {
      lineCount: lines.length,
      linesWithCharacters: linesWithCharacters.length,
    });
  }
  return linesWithCharacters;
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
  if (!baseline || typeof baseline.lineAscent !== "number" || baseline.lineAscent <= 0) {
    return undefined;
  }
  return {
    fontFamily: m.key?.family,
    fontWeight: m.fontWeight,
    fontLineHeight: lh,
    ascenderRatio: baseline.lineAscent / (baseline.lineHeight / lh),
  };
}

/**
 * Resolve the ascender ratio from derived metadata or an explicit font resolver.
 */
export function resolveTextAscenderRatio(
  node: TextNodeInput,
  props: ExtractedTextProps,
  ctx: ResolveTextContext,
): number {
  const dtd = node.derivedTextData as FigDerivedTextData | undefined;
  const metrics = resolveFontMetrics(dtd);
  if (metrics) {
    return metrics.ascenderRatio;
  }
  const font = ctx.fontResolver?.(props.font);
  if (font) {
    return font.ascender / font.unitsPerEm;
  }
  throw new Error(`Text layout requires ascender metrics for font "${props.font.family}"`);
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
 * `blobs` is required to decode glyph path commands. When absent, the resolver
 * falls back to the lines strategy even if derivedTextData is present.
 */
export type ResolveTextContext = {
  readonly blobs?: readonly FigBlob[];
  readonly fontResolver?: TextFontResolver;
  /**
   * Document-wide style registry for resolving per-character override
   * `styleIdForFill` references in `textData.styleOverrideTable`. When
   * absent, runs collapse to a single base-fill run; a node carrying
   * `characterStyleIDs` plus override `styleIdForFill` then trips the
   * registry's no-fallback policy.
   */
  readonly styleRegistry?: FigStyleRegistry;
};

/**
 * Read per-character style metadata from a TEXT node, accepting both the
 * domain shape (`FigDesignNode.textData.{characterStyleIDs,styleOverrideTable}`)
 * and the raw Kiwi shape (`FigNode.textData.*`). Returns `undefined` for
 * each field when the node carries no character-level styling.
 */
function readPerCharStyleData(node: TruncatableTextNode): {
  characterStyleIDs: readonly number[] | undefined;
  styleOverrideTable: readonly TextStyleOverride[] | undefined;
} {
  // Both FigDesignNode and FigNode put the data under `textData`. The shape
  // matches our domain `TextStyleOverride[]` for FigDesignNode and the raw
  // FigKiwiTextData for FigNode — the structural overlap (styleID, fillPaints,
  // styleIdForFill) is sufficient for `resolveTextRuns`.
  const textData = (node as { textData?: { characterStyleIDs?: readonly number[]; styleOverrideTable?: readonly unknown[] } }).textData;
  return {
    characterStyleIDs: textData?.characterStyleIDs,
    styleOverrideTable: textData?.styleOverrideTable as readonly TextStyleOverride[] | undefined,
  };
}

/**
 * Diagnostic label for unresolved style references during run resolution.
 *
 * Accepts both FigNode (`.guid`) and FigDesignNode (`.id`) shapes so the
 * locator works at any layer of the conversion pipeline.
 */
function formatTextNodeLocator(node: TruncatableTextNode): string {
  const shaped = node as { guid?: FigGuid; id?: string; name?: string };
  const guidStr = shaped.guid
    ? guidToString(shaped.guid)
    : (typeof shaped.id === "string" && shaped.id.length > 0 ? shaped.id : "<no-guid>");
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
  const pathData = extractTextPathData({
    lines: layout.lines.map((line) => line.text),
    font,
    fontSize: displayProps.fontSize,
    x: firstLine.x,
    baseY: firstLine.y,
    lineHeight: layout.lineHeight,
    align: displayProps.textAlignHorizontal,
    letterSpacing: displayProps.letterSpacing,
    textDecoration: displayProps.textDecoration,
    lineSourceStarts: lineSourceStarts(displayProps.characters, layout.lines),
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
 * Narrow TextNodeInput to the shape that carries textTruncation.
 * Both FigNode and FigDesignNode expose it structurally.
 */
type TruncatableTextNode = TextNodeInput & {
  readonly derivedTextData?: DerivedTextData;
  readonly textTruncation?: KiwiEnumValue | string;
  readonly textData?: TextNodeInput["textData"] & {
    readonly textTruncation?: KiwiEnumValue | string;
  };
};

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
 * The resolver never fails: an empty-text node returns `{ kind: "empty" }`.
 */
export function resolveTextRendering(
  node: TruncatableTextNode,
  ctx: ResolveTextContext,
): TextRendering {
  const props = extractTextProps(node);
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
    locator: () => formatTextNodeLocator(node),
  });

  // Resolve truncation from the node and its derivedTextData. Both FigNode
  // and FigDesignNode may expose `textTruncation` at the top or inside
  // `textData`; either is acceptable.
  const dtd = node.derivedTextData;
  const truncation = resolveTruncation(
    node.textTruncation ?? node.textData?.textTruncation,
    dtd,
  );
  // Font metrics from fontMetaData — used by line-mode to compute accurate
  // baselines when a font loader is absent.
  const fontMetrics = resolveFontMetrics(dtd);
  const ascenderRatio = resolveTextAscenderRatio(node, props, ctx);

  // Glyph-mode when pre-outlined paths are available and we can decode them.
  // Figma has already applied truncation to the glyph positions, so we pass
  // the truncation metadata through unchanged.
  if (ctx.blobs && hasDerivedGlyphs(dtd)) {
    const alignmentOffset = computeDerivedAlignmentOffset(
      dtd?.layoutSize,
      props.size,
      props.textAlignHorizontal,
      props.textAlignVertical,
    );
    const pathData = extractDerivedTextPathData(dtd!, ctx.blobs, alignmentOffset);
    if (pathData.glyphContours.length > 0 || pathData.decorations.length > 0) {
      const layout = computeTextLayout({ props, ascenderRatio });
      const glyphs: TextRenderingGlyphs = {
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
      return glyphs;
    }
  }

  // Lines mode source: if truncation applies, rewrite characters before
  // layout so renderers emit the cut-and-ellipsized string directly.
  const displayProps = resolveDisplayProps(props, truncation);

  // Prefer Figma's own per-line breakdown when available — more accurate
  // than the heuristic splitter in compute-layout. Skip when truncation
  // applied because we already rewrote characters.
  const explicitLines = truncation ? undefined : derivedLineStrings(dtd);
  const layout = computeTextLayout({
    props: displayProps,
    lines: explicitLines,
    ascenderRatio,
  });

  const fontGlyphs = resolveFontGlyphRendering({
    displayProps,
    layout,
    runs,
    fillColor,
    fillOpacity,
    truncation,
    fontResolver: ctx.fontResolver,
  });
  if (fontGlyphs) {
    return fontGlyphs;
  }

  const lines: TextRenderingLines = {
    kind: "lines",
    layout,
    runs,
    fillColor,
    fillOpacity,
    transform: displayProps.transform,
    opacity: displayProps.opacity,
    props: displayProps,
    truncation,
    fontMetrics,
  };
  return lines;
}
