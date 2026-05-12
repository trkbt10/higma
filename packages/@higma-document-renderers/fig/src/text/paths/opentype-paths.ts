/**
 * @file Extract glyph outline paths from opentype.js fonts
 *
 * Format-agnostic glyph path extraction that returns PathCommand arrays.
 * Both SVG and WebGL backends consume these.
 */

import type { AbstractFont, AbstractGlyph } from "@higma-document-models/fig/font";
import { convertQuadraticsToCubic } from "@higma-primitives/path";
import type { GlyphContour, PathContour, DecorationRect, TextPathResult } from "./types";
import type { TextAlignHorizontal } from "../layout/types";

type FontForCharacter = (sourceIndex: number) => AbstractFont;

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
  { text, font, fontSize, letterSpacing}: { text: string; font: AbstractFont; fontSize: number; letterSpacing?: number; }
): number {
  return calculateMixedFontTextWidth({
    text,
    fontSize,
    letterSpacing,
    fontForCharacter: () => font,
  });
}

function calculateMixedFontTextWidth(
  { text, fontSize, letterSpacing, fontForCharacter, sourceStart = 0}: { text: string; fontSize: number; letterSpacing?: number; fontForCharacter: FontForCharacter; sourceStart?: number; }
): number {
  const spacing = letterSpacing ?? 0;
  const widthRef = { value: 0 };
  const opszApplied = new Set<AbstractFont>();
  let previousFont: AbstractFont | undefined;
  let previousGlyph: AbstractGlyph | undefined;
  for (let i = 0; i < text.length; i++) {
    const font = fontForCharacter(sourceStart + i);
    if (!opszApplied.has(font)) {
      opszApplied.add(font);
      // Apply optical size before reading glyph metrics so the
      // advance width matches what the path emitter will draw with.
      font.setOpticalSize?.(fontSize);
    }
    const scale = fontSize / font.unitsPerEm;
    const glyph = font.charToGlyph(text[i]);
    const advanceWidth = glyph.advanceWidth ?? 0;
    // Fold the previous/current pair-adjustment into the cursor so the
    // emitted line matches the browser's kerned width — measure stays
    // tied to paint via `extractGlyphPathContours` below.
    widthRef.value += pairAdjustment(previousFont, font, previousGlyph, glyph) * scale;
    widthRef.value += advanceWidth * scale;
    if (i < text.length - 1) {
      widthRef.value += spacing;
    }
    previousFont = font;
    previousGlyph = glyph;
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
  { text, font, fontSize, x, y, align, letterSpacing}: { text: string; font: AbstractFont; fontSize: number; x: number; y: number; align: TextAlignHorizontal; letterSpacing?: number; }
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
  });
  const commands = contours.flatMap((contour) => contour.commands);
  if (commands.length === 0) {
    return null;
  }

  return { commands };
}

function extractGlyphPathContours(
  { text, fontSize, x, y, align, letterSpacing, fontForCharacter, sourceStart}: { text: string; fontSize: number; x: number; y: number; align: TextAlignHorizontal; letterSpacing?: number; fontForCharacter: FontForCharacter; sourceStart: number; }
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
  const totalWidth = calculateMixedFontTextWidth({ text, fontSize, letterSpacing, fontForCharacter, sourceStart });
  const spacing = letterSpacing ?? 0;
  const cursor = { x: getAlignmentOffset(align, totalWidth, x) };
  const contours: GlyphContour[] = [];
  let previousFont: AbstractFont | undefined;
  let previousGlyph: AbstractGlyph | undefined;
  for (let i = 0; i < text.length; i++) {
    const font = fontForCharacter(sourceStart + i);
    const scale = fontSize / font.unitsPerEm;
    const glyph = font.charToGlyph(text[i]);
    // Advance the cursor by the pair-adjustment before stamping the
    // glyph so the painted outline starts at the kerned position
    // (matching what `calculateMixedFontTextWidth` already folded into
    // the total run width).
    cursor.x += pairAdjustment(previousFont, font, previousGlyph, glyph) * scale;
    const path = glyph.getPath(cursor.x, y, fontSize);
    const commands = convertQuadraticsToCubic(path.commands);
    if (commands.length > 0) {
      contours.push({ commands, firstCharacter: sourceStart + i });
    }
    cursor.x += (glyph.advanceWidth ?? 0) * scale;
    if (i < text.length - 1) {
      cursor.x += spacing;
    }
    previousFont = font;
    previousGlyph = glyph;
  }
  return contours;
}

/**
 * Create underline decoration rectangle
 *
 * Figma positions underline at approximately fontSize * 0.19 below baseline
 * with thickness of approximately fontSize * 0.068.
 */
export function createUnderlineRect(
  { text, font, fontSize, x, y, align, letterSpacing}: { text: string; font: AbstractFont; fontSize: number; x: number; y: number; align: TextAlignHorizontal; letterSpacing?: number; }
): DecorationRect | null {
  if (!text.trim()) {
    return null;
  }

  const totalWidth = calculateTextWidth({ text, font, fontSize, letterSpacing });
  const adjustedX = getAlignmentOffset(align, totalWidth, x);

  const underlineOffset = fontSize * 0.19;
  const underlineThickness = fontSize * 0.068;

  return {
    x: adjustedX,
    y: y + underlineOffset,
    width: totalWidth,
    height: underlineThickness,
  };
}

/**
 * Extract multi-line text path data
 *
 * @param lines - Text lines to render
 * @param font - Abstract font
 * @param fontSize - Font size in pixels
 * @param x - X position
 * @param baseY - Y position of first line baseline
 * @param lineHeight - Line height in pixels
 * @param align - Horizontal alignment
 * @param letterSpacing - Optional letter spacing
 * @param textDecoration - Text decoration type
 * @returns TextPathResult with glyph contours and decorations
 */
export function extractTextPathData(
  { lines, font, fontSize, x, baseY, lineHeight, align, letterSpacing, textDecoration, fontForCharacter, lineSourceStarts }: { lines: readonly string[]; font: AbstractFont; fontSize: number; x: number; baseY: number; lineHeight: number; align: TextAlignHorizontal; letterSpacing?: number; textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH"; fontForCharacter?: FontForCharacter; lineSourceStarts?: readonly number[]; }
): TextPathResult {
  const glyphContours: GlyphContour[] = [];
  const decorations: DecorationRect[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (!lineText) {continue;}

    const y = baseY + i * lineHeight;
    const contours = extractGlyphPathContours({
      text: lineText,
      fontSize,
      x,
      y,
      align,
      letterSpacing,
      fontForCharacter: fontForCharacter ?? (() => font),
      sourceStart: lineSourceStarts?.[i] ?? 0,
    });

    glyphContours.push(...contours);

    if (textDecoration === "UNDERLINE") {
      const rect = createUnderlineRect({
        text: lineText,
        font,
        fontSize,
        x,
        y,
        align,
        letterSpacing,
      });
      if (rect) {
        decorations.push(rect);
      }
    }
  }

  return { glyphContours, decorations };
}
