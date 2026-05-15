/**
 * @file Convert Figma TEXT nodes to scene graph TextNode data
 *
 * Accepts FigDesignNode (domain object) directly.
 */

import type { FigDesignNode, FigBlob, FigStyleRegistry } from "@higma-document-models/fig/domain";
import { resolveTextRendering, type TextFontResolver, type TextRendering } from "../../text/rendering";
import type { TextRun } from "@higma-document-models/fig/scene-graph";
import type { GlyphContour as PathGlyphContour } from "../../text/paths/types";
import { textAlignHorizontalToAnchor, getAllVisibleSolidFills } from "../../text/layout";
import type { ExtractedTextProps } from "../../text/layout/types";
import type { PathContour, GlyphContour, Color, TextLineLayout } from "@higma-document-models/fig/scene-graph";

/** Map Figma text decoration value to scene graph text decoration string */
function mapTextDecoration(decoration: string | undefined): "underline" | "strikethrough" | undefined {
  if (decoration === "UNDERLINE") {
    return "underline";
  }
  if (decoration === "STRIKETHROUGH") {
    return "strikethrough";
  }
  return undefined;
}

/**
 * Normalize text-path contours into the scene-graph `PathContour`
 * shape — same commands, just stamped with the required winding rule.
 *
 * The text-paths layer and the scene-graph share the same canonical
 * `PathCommand` union (`@higma-primitives/path`) since the SoT
 * consolidation, so this function is now a trivial windingRule
 * stamp. The "bridge" wrapper survives because the scene-graph
 * `PathContour` type also carries an optional fill rule and
 * downstream code keys off the named function call site.
 */
function normalizeContours(
  contours: readonly { readonly commands: readonly PathContour["commands"][number][] }[],
): PathContour[] {
  return contours.map((c) => ({
    commands: c.commands,
    windingRule: "nonzero" as const,
  }));
}

/**
 * Glyph variant of `normalizeContours` that retains each contour's
 * `firstCharacter` annotation so downstream code can group glyphs by
 * `TextRun`. Bridges the text-paths shape (font/types PathCommand) into
 * the scene-graph shape (which adds optional arc commands for general
 * paths but never carries them for text glyphs).
 */
function normalizeGlyphContours(contours: readonly PathGlyphContour[]): GlyphContour[] {
  const base = normalizeContours(contours);
  return base.map((c, i) => ({ ...c, firstCharacter: contours[i].firstCharacter }));
}

/**
 * Parse fill color string to Color
 */
function parseHexColor(hex: string): Color {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return { r, g, b, a: 1 };
}

/**
 * Result of text conversion for scene graph
 */
export type TextConversionResult = {
  /** Glyph outline contours (if derived data available), per-glyph annotated. */
  readonly glyphContours?: readonly GlyphContour[];
  /** Decoration contours (underlines, strikethroughs) */
  readonly decorationContours?: readonly PathContour[];
  /**
   * Per-character fill runs covering `[0, characters.length)`. Single base
   * run when no character-level style overrides are present.
   */
  readonly runs: readonly TextRun[];
  /**
   * Stacked fill paints in source order — mirrors the raw FigNode's
   * `fillPaints` array (the SoT). See `TextNode.fills` for the full
   * stacking rationale. An empty array means the node has no visible
   * SOLID fill.
   */
  readonly fills: readonly { readonly color: Color; readonly opacity: number }[];
  /** Text line layout data for SVG <text> rendering */
  readonly textLineLayout?: TextLineLayout;
};

export type TextConversionOptions = {
  readonly blobs: readonly FigBlob[];
  readonly fontResolver?: TextFontResolver;
  /**
   * Document-wide style registry — required when a TEXT carries
   * `characterStyleIDs` whose override entries reference shared FILL styles
   * via `styleIdForFill`. Without it, run resolution treats the registry
   * as empty and the no-fallback policy throws on unresolved references.
   */
  readonly styleRegistry?: FigStyleRegistry;
};

/**
 * Convert a TEXT FigDesignNode to scene graph text data
 *
 * @param node - FigDesignNode of type TEXT
 * @param blobs - Blob array from .fig file (for derived paths)
 * @returns Text conversion result for scene graph TextNode
 */
/**
 * Convert font variation axes to CSS font-variation-settings value.
 * Figma stores axis tags as 4-byte integers (e.g. 0x77676874 = "wght").
 */
function buildFontVariationSettings(
  variations: readonly { readonly axisTag: number; readonly axisValue: number }[] | undefined,
): string | undefined {
  if (!variations || variations.length === 0) { return undefined; }

  const parts: string[] = [];
  for (const v of variations) {
    // Convert 4-byte integer to 4-char ASCII tag
    const tag = String.fromCharCode(
      (v.axisTag >> 24) & 0xFF,
      (v.axisTag >> 16) & 0xFF,
      (v.axisTag >> 8) & 0xFF,
      v.axisTag & 0xFF,
    );
    parts.push(`'${tag}' ${v.axisValue}`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Convert a TEXT FigDesignNode into scene-graph text rendering data. */
export function convertTextNode(node: FigDesignNode, options: TextConversionOptions): TextConversionResult {
  // Delegate resolution to the unified text rendering SoT. This is the only
  // place (alongside svg/renderer.ts) that decides glyphs-vs-lines strategy.
  const rendering = resolveTextRendering(node, {
    blobs: options.blobs,
    fontResolver: options.fontResolver,
    styleRegistry: options.styleRegistry,
  });
  const fontVariationSettings = buildFontVariationSettings(node.textData?.fontVariations);

  if (rendering.kind === "empty") {
    // Scene-graph downstream expects a textLineLayout even for empty
    // text. Build a minimal, empty line layout so the renderer emits nothing.
    // `fills: []` means "no visible SOLID fill" — line/glyph renderers
    // and decoration painters all skip on empty.
    const empty: TextLineLayout = {
      lines: [],
      fontFamily: "sans-serif",
      fontSize: 16,
      fontWeight: undefined,
      fontStyle: undefined,
      letterSpacing: undefined,
      lineHeight: 16,
      textAnchor: "start",
    };
    return {
      fills: [],
      runs: [],
      textLineLayout: empty,
    };
  }

  const props = rendering.props;
  const textLineLayout: TextLineLayout = buildTextLineLayout(rendering, props, fontVariationSettings);

  // Stacked fillPaints: each visible SOLID paint contributes one full
  // paint pass over the glyphs in source order. The SoT shape is the
  // raw `FigNode.fillPaints` array; we surface every visible SOLID
  // entry here so downstream renderers can mirror Figma's painter's-
  // algorithm composite by emitting one paint pass per entry.
  const fills: readonly { readonly color: Color; readonly opacity: number }[] =
    getAllVisibleSolidFills(props.fillPaints).map((f) => ({
      color: parseHexColor(f.color),
      opacity: f.opacity,
    }));

  if (rendering.kind === "glyphs") {
    const glyphContours = normalizeGlyphContours(rendering.glyphContours);
    const decorationContours = normalizeContours(rendering.decorationContours);
    return {
      glyphContours,
      decorationContours: decorationContours.length > 0 ? decorationContours : undefined,
      runs: rendering.runs,
      fills,
      textLineLayout,
    };
  }

  return {
    runs: rendering.runs,
    fills,
    textLineLayout,
  };
}

/** Build the scene-graph TextLineLayout from a resolved TextRendering. */
function buildTextLineLayout(
  rendering: Exclude<TextRendering, { kind: "empty" }>,
  props: ExtractedTextProps,
  fontVariationSettings: string | undefined,
): TextLineLayout {
  // Unpack the canonical `FontQuery` into the scene-graph layout's CSS-shaped
  // fields. `font.style === "normal"` is left as undefined on the layout so
  // downstream renderers omit the attribute (matches Figma's SVG export).
  const { font } = props;
  return {
    lines: rendering.layout.lines.map((line) => ({
      text: line.text,
      x: line.x,
      y: line.y,
    })),
    fontFamily: font.family,
    fontSize: props.fontSize,
    fontWeight: font.weight,
    fontStyle: font.style !== "normal" ? font.style : undefined,
    letterSpacing: props.letterSpacing,
    lineHeight: rendering.layout.lineHeight,
    textAnchor: textAlignHorizontalToAnchor(props.textAlignHorizontal),
    textDecoration: mapTextDecoration(props.textDecoration),
    fontVariationSettings,
  };
}
