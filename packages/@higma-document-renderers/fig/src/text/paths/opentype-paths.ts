/**
 * @file Extract glyph outline paths from opentype.js fonts
 *
 * Format-agnostic glyph path extraction that returns PathCommand arrays.
 * Both SVG and WebGL backends consume these.
 */

import type { AbstractFont, AbstractGlyph } from "@higma-document-models/fig/font";
import { convertQuadraticsToCubic } from "@higma-primitives/path";
import type { GlyphContour, PathContour, DecorationRect, TextPathResult } from "./types";
import type { TextAlignHorizontal, TextCase } from "../layout";
import { resolveTextCaseGlyph } from "./small-caps-glyph";

type FontForCharacter = (sourceIndex: number) => AbstractFont;
type TextDecoration = "NONE" | "UNDERLINE" | "STRIKETHROUGH" | undefined;

/**
 * Pair-adjustment lookup between two adjacent glyphs in the same
 * font. Mixed-font runs return `0` because kerning is a single-font
 * concept — there is no defined pair adjustment between two glyphs
 * that live in different files. Returns 0 for fonts whose driver does
 * not surface `getKerningValue`, so the renderer simply skips
 * pair-adjustment for those fonts rather than failing.
 */
function pairAdjustment(
  previousFont: AbstractFont | undefined,
  currentFont: AbstractFont,
  previousGlyph: AbstractGlyph | undefined,
  currentGlyph: AbstractGlyph,
): number {
  if (previousFont !== currentFont || previousGlyph === undefined) {
    return 0;
  }
  if (typeof currentFont.getKerningValue !== "function") {
    return 0;
  }
  return currentFont.getKerningValue(previousGlyph, currentGlyph);
}

/**
 * Calculate width of text using font metrics
 */
export function calculateTextWidth(
  { text, font, fontSize, letterSpacing, textCase}: { text: string; font: AbstractFont; fontSize: number; letterSpacing?: number; textCase?: TextCase; }
): number {
  return calculateMixedFontTextWidth({
    text,
    fontSize,
    letterSpacing,
    fontForCharacter: () => font,
    textCase,
  });
}

function calculateMixedFontTextWidth(
  { text, fontSize, letterSpacing, fontForCharacter, sourceStart = 0, textCase = "ORIGINAL" }: { text: string; fontSize: number; letterSpacing?: number; fontForCharacter: FontForCharacter; sourceStart?: number; textCase?: TextCase; }
): number {
  const spacing = letterSpacing ?? 0;
  const widthRef = { value: 0 };
  const opszApplied = new Set<AbstractFont>();
  const previousFontRef = { value: undefined as AbstractFont | undefined };
  const previousGlyphRef = { value: undefined as AbstractGlyph | undefined };
  for (let i = 0; i < text.length; i++) {
    const font = fontForCharacter(sourceStart + i);
    if (!opszApplied.has(font)) {
      opszApplied.add(font);
      // Apply optical size before reading glyph metrics so the
      // advance width matches what the path emitter will draw with.
      font.setOpticalSize?.(fontSize);
    }
    const resolved = resolveTextCaseGlyph(font, text[i], textCase);
    const glyph = resolved.glyph;
    // The per-glyph `fontSizeScale` folds the small-caps synthesis
    // shrink directly into the advance — the measurer never reaches
    // for an alternate font-size; the scale already encodes the
    // shrunken cap-cell width relative to the run's authored size.
    const scale = (fontSize * resolved.fontSizeScale) / font.unitsPerEm;
    const advanceWidth = glyph.advanceWidth ?? 0;
    // Fold the previous/current pair-adjustment into the cursor so the
    // emitted line matches the browser's kerned width — measure stays
    // tied to paint via `extractGlyphPathContours` below.
    widthRef.value += pairAdjustment(previousFontRef.value, font, previousGlyphRef.value, glyph) * scale;
    widthRef.value += advanceWidth * scale;
    if (i < text.length - 1) {
      widthRef.value += spacing;
    }
    previousFontRef.value = font;
    previousGlyphRef.value = glyph;
  }
  return widthRef.value;
}

/**
 * Calculate x offset for alignment
 */
function getAlignmentOffset(
  align: TextAlignHorizontal,
  totalWidth: number,
  x: number
): number {
  switch (align) {
    case "CENTER":
      return x - totalWidth / 2;
    case "RIGHT":
      return x - totalWidth;
    default:
      return x;
  }
}

/**
 * Extract glyph outline path commands from font for a single line of text
 *
 * @param text - Text string to extract paths for
 * @param font - Abstract font interface
 * @param fontSize - Font size in pixels
 * @param x - X position
 * @param y - Y baseline position
 * @param align - Horizontal alignment
 * @param letterSpacing - Optional letter spacing
 * @returns Path contour with all glyphs combined, or null if empty
 */
export function extractLinePathCommands(
  { text, font, fontSize, x, y, align, letterSpacing, textCase}: { text: string; font: AbstractFont; fontSize: number; x: number; y: number; align: TextAlignHorizontal; letterSpacing?: number; textCase?: TextCase; }
): PathContour | null {
  const contours = extractGlyphPathContours({
    text,
    fontSize,
    x,
    y,
    align,
    letterSpacing,
    fontForCharacter: () => font,
    sourceStart: 0,
    textCase,
  });
  const commands = contours.flatMap((contour) => contour.commands);
  if (commands.length === 0) {
    return null;
  }

  return { commands };
}

function extractGlyphPathContours(
  { text, fontSize, x, y, align, letterSpacing, fontForCharacter, sourceStart, textCase = "ORIGINAL" }: { text: string; fontSize: number; x: number; y: number; align: TextAlignHorizontal; letterSpacing?: number; fontForCharacter: FontForCharacter; sourceStart: number; textCase?: TextCase; }
): GlyphContour[] {
  // Tune variable-font `opsz` once per text run before we walk the
  // characters — `calculateMixedFontTextWidth` below reads glyph
  // advance widths, which the variation view re-derives from the
  // current optical-size point. Doing this here keeps the width
  // measurement and the path emit in sync.
  const fontSet = new Set<AbstractFont>();
  for (let i = 0; i < text.length; i++) {
    const font = fontForCharacter(sourceStart + i);
    if (!fontSet.has(font)) {
      fontSet.add(font);
      font.setOpticalSize?.(fontSize);
    }
  }
  const totalWidth = calculateMixedFontTextWidth({ text, fontSize, letterSpacing, fontForCharacter, sourceStart, textCase });
  const spacing = letterSpacing ?? 0;
  const cursor = { x: getAlignmentOffset(align, totalWidth, x) };
  const contours: GlyphContour[] = [];
  const previousFontRef = { value: undefined as AbstractFont | undefined };
  const previousGlyphRef = { value: undefined as AbstractGlyph | undefined };
  for (let i = 0; i < text.length; i++) {
    const font = fontForCharacter(sourceStart + i);
    const resolved = resolveTextCaseGlyph(font, text[i], textCase);
    const glyph = resolved.glyph;
    const perGlyphFontSize = fontSize * resolved.fontSizeScale;
    const scale = perGlyphFontSize / font.unitsPerEm;
    // Advance the cursor by the pair-adjustment before stamping the
    // glyph so the painted outline starts at the kerned position
    // (matching what `calculateMixedFontTextWidth` already folded into
    // the total run width).
    cursor.x += pairAdjustment(previousFontRef.value, font, previousGlyphRef.value, glyph) * scale;
    // Pass the float `y` straight into opentype.js — the font-backed
    // emitter does NOT share the derived-glyph integer-rounding
    // projection (`figmaTextOutlineBaselineY`). Figma's outlined SVG
    // export materialises paths at the full-precision baseline, and
    // multi-frame layouts with `halfLeading = 0.5` (cjk Noto Sans JP
    // fontSize=14) need that half-pixel preserved so wrapped lines
    // don't accumulate a 1px drift per line.
    const path = glyph.getPath(cursor.x, y, perGlyphFontSize);
    const commands = convertQuadraticsToCubic(path.commands);
    if (commands.length > 0) {
      contours.push({ commands, firstCharacter: sourceStart + i });
    }
    cursor.x += (glyph.advanceWidth ?? 0) * scale;
    if (i < text.length - 1) {
      cursor.x += spacing;
    }
    previousFontRef.value = font;
    previousGlyphRef.value = glyph;
  }
  return contours;
}

/**
 * Fallback ratios used when the font ships no `post.underlinePosition`
 * / `post.underlineThickness` metrics. The position ratio is the
 * thickness-centre-of-the-bar distance below the baseline; the
 * thickness ratio sets the bar height. Both keep the
 * legacy-fallback rectangle close to the centre of the descender slot.
 */
const UNDERLINE_POSITION_FALLBACK_RATIO = 0.15;
const UNDERLINE_THICKNESS_FALLBACK_RATIO = 0.05;

/**
 * Create the underline decoration rectangle for a single line.
 *
 * Figma's SVG exporter draws the underline at
 * `baseline + |post.underlinePosition| × fontSize / unitsPerEm`
 * (with the post-table sign convention where a negative position
 * means "below baseline"), centred on a band whose height comes from
 * `post.underlineThickness`. The rectangle's TOP edge therefore lands
 * at `baseline - underlinePositionPx + underlineThicknessPx / 2` —
 * see the `text-decoration` fixture for the bit-for-bit verification.
 * Fonts that omit `post` fall back to canonical ratios.
 */
export function createUnderlineRect(
  { text, font, fontSize, x, y, align, letterSpacing, textCase}: { text: string; font: AbstractFont; fontSize: number; x: number; y: number; align: TextAlignHorizontal; letterSpacing?: number; textCase?: TextCase; }
): DecorationRect | null {
  if (!text.trim()) {
    return null;
  }

  const totalWidth = calculateTextWidth({ text, font, fontSize, letterSpacing, textCase });
  const adjustedX = getAlignmentOffset(align, totalWidth, x);

  const post = font.tables?.post;
  const positionUnits = typeof post?.underlinePosition === "number" ? post.underlinePosition : undefined;
  const thicknessUnits = typeof post?.underlineThickness === "number" ? post.underlineThickness : undefined;
  // `post.underlinePosition` is the centerline distance from the
  // baseline in font units, with negative values indicating "below
  // baseline". The renderer needs the distance in screen pixels with
  // a positive sign, so flip the magnitude.
  const positionPx = positionUnits !== undefined
    ? Math.abs(positionUnits) * fontSize / font.unitsPerEm
    : fontSize * UNDERLINE_POSITION_FALLBACK_RATIO;
  const heightPx = thicknessUnits !== undefined
    ? thicknessUnits * fontSize / font.unitsPerEm
    : fontSize * UNDERLINE_THICKNESS_FALLBACK_RATIO;

  return {
    x: adjustedX,
    // Empirically verified against the `text-decoration` Noto Sans JP
    // fixture: Figma's SVG export places the rectangle top at
    // `baseline + |post.underlinePosition| + thickness / 2`, NOT at
    // `baseline + |position| − thickness / 2`. The spec's
    // "underlinePosition is the suggested position of the top of the
    // underline" wording is ambiguous about whether the value is the
    // upper edge or a half-thickness-offset reference; Figma resolves
    // to the latter — the bar's TOP sits half a thickness below the
    // metric value, which means the BOTTOM lands at
    // `baseline + |position| + 3 × thickness / 2`. Without this
    // offset the rendered underline floats ~0.5 px above Figma's
    // export and the diff baseline picks up the drift on every line.
    y: y + positionPx + heightPx / 2,
    width: totalWidth,
    height: heightPx,
  };
}

/**
 * Ratios used when the font lacks `OS/2.yStrikeoutPosition` /
 * `yStrikeoutSize`. Tuned so a missing-metrics font still produces a
 * visible strike near the centre of the x-height — the values match
 * the relative position the Inter and Noto Sans JP files we ship
 * actually carry, so they double as a defensible default.
 */
const STRIKETHROUGH_POSITION_FALLBACK_RATIO = 0.325;
const STRIKETHROUGH_THICKNESS_FALLBACK_RATIO = 0.05;

/**
 * Create the strikethrough decoration rectangle for a single line.
 *
 * Figma's SVG exporter places the strike at
 * `baseline - yStrikeoutPosition × fontSize / unitsPerEm` (the
 * centerline), with `yStrikeoutSize` setting the thickness. When the
 * font ships no OS/2 strike metrics, fall back to a fraction of
 * `fontSize` that lands the rectangle near the x-height centre.
 */
export function createStrikethroughRect(
  { text, font, fontSize, x, y, align, letterSpacing, textCase}: { text: string; font: AbstractFont; fontSize: number; x: number; y: number; align: TextAlignHorizontal; letterSpacing?: number; textCase?: TextCase; }
): DecorationRect | null {
  if (!text.trim()) {
    return null;
  }
  const totalWidth = calculateTextWidth({ text, font, fontSize, letterSpacing, textCase });
  const adjustedX = getAlignmentOffset(align, totalWidth, x);

  const os2 = font.tables?.os2;
  const positionUnits = typeof os2?.yStrikeoutPosition === "number" ? os2.yStrikeoutPosition : undefined;
  const sizeUnits = typeof os2?.yStrikeoutSize === "number" ? os2.yStrikeoutSize : undefined;
  const positionPx = positionUnits !== undefined
    ? positionUnits * fontSize / font.unitsPerEm
    : fontSize * STRIKETHROUGH_POSITION_FALLBACK_RATIO;
  const heightPx = sizeUnits !== undefined
    ? sizeUnits * fontSize / font.unitsPerEm
    : fontSize * STRIKETHROUGH_THICKNESS_FALLBACK_RATIO;

  return {
    x: adjustedX,
    // Empirically verified against the `text-decoration` Noto Sans JP
    // fixture: Figma's SVG export anchors the strike rectangle's TOP
    // at exactly `baseline − yStrikeoutPosition`, treating the OS/2
    // value as the TOP-edge distance above the baseline (not the
    // centerline as the OpenType spec wording suggests). The same
    // file's underline shows the symmetric idiom on the other side
    // (`baseline + underlinePosition + thickness/2`) — see
    // `createUnderlineRect` above. Without this, the strike rendered
    // at the spec-centerline-derived position floats half a thickness
    // above Figma's output.
    y: y - positionPx,
    width: totalWidth,
    height: heightPx,
  };
}

/**
 * One positioned text line. The path emitter consumes per-line `x`/`y`
 * directly so the caller can encode paragraph-level offsets
 * (`paragraphSpacing` adds dy, `paragraphIndent` adds dx) into the
 * line positions without the path emitter having to know about them.
 */
export type PositionedTextLine = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly sourceStart?: number;
};

/**
 * Extract multi-line text path data using per-line positions.
 *
 * Per-line `x` and `y` are the authoritative position source — the
 * emitter no longer reconstructs them as `baseY + i * lineHeight`,
 * which silently dropped any paragraph-level adjustments the layout
 * step had baked into individual lines.
 */
export function extractTextPathData(
  { lines, font, fontSize, align, letterSpacing, textDecoration, fontForCharacter, textCase }: { lines: readonly PositionedTextLine[]; font: AbstractFont; fontSize: number; align: TextAlignHorizontal; letterSpacing?: number; textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH"; fontForCharacter?: FontForCharacter; textCase?: TextCase; }
): TextPathResult {
  const glyphContours: GlyphContour[] = [];
  const decorations: DecorationRect[] = [];

  for (const line of lines) {
    if (!line.text) { continue; }
    const contours = extractGlyphPathContours({
      text: line.text,
      fontSize,
      x: line.x,
      y: line.y,
      align,
      letterSpacing,
      fontForCharacter: fontForCharacter ?? (() => font),
      sourceStart: line.sourceStart ?? 0,
      textCase,
    });

    glyphContours.push(...contours);

    appendTextDecoration({
      decorations,
      textDecoration,
      text: line.text,
      font,
      fontSize,
      x: line.x,
      y: line.y,
      align,
      letterSpacing,
      textCase,
    });
  }

  return { glyphContours, decorations };
}

/**
 * Append one text-decoration rectangle to `decorations` based on the
 * run's `textDecoration` enum. `UNDERLINE` routes through
 * `createUnderlineRect` (below-baseline placement at the canonical
 * 0.19×/0.068× ratios); `STRIKETHROUGH` routes through
 * `createStrikethroughRect`, which reads `OS/2.yStrikeoutPosition` /
 * `yStrikeoutSize` for above-baseline placement (with a font-fallback
 * ratio when the font ships no strike metrics). `NONE` / `undefined`
 * short-circuit without emitting a rectangle.
 */
function appendTextDecoration(params: {
  readonly decorations: DecorationRect[];
  readonly textDecoration: TextDecoration;
  readonly text: string;
  readonly font: AbstractFont;
  readonly fontSize: number;
  readonly x: number;
  readonly y: number;
  readonly align: TextAlignHorizontal;
  readonly letterSpacing?: number;
  readonly textCase?: TextCase;
}): void {
  if (params.textDecoration === "UNDERLINE") {
    const rect = createUnderlineRect(params);
    if (rect !== null) {
      params.decorations.push(rect);
    }
    return;
  }
  if (params.textDecoration === "STRIKETHROUGH") {
    const rect = createStrikethroughRect(params);
    if (rect !== null) {
      params.decorations.push(rect);
    }
    return;
  }
}
