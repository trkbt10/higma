/**
 * @file Path-based text rendering through the shared TextRendering SoT.
 *
 * This module is kept as the legacy async entry point for callers that need
 * `renderTextNodeAsPath`, but it no longer owns font selection, line layout,
 * or glyph outline extraction. Those decisions live in `text/rendering`.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import type { FigSvgRenderContext } from "../../../types";
import type { FontLoader, AbstractFont } from "@higma-document-models/fig/font";
import { fontHasGlyph } from "@higma-document-models/fig/font";
import { extractTextProps } from "../../../text/layout/extract-props";
import { resolveTextRendering, type TextFontResolver } from "../../../text/rendering";
import { formatTextRenderingToSvg } from "./format-rendering";
import type { SvgString } from "../../primitives";

/** Path render context. */
export type PathRenderContext = FigSvgRenderContext & {
  readonly fontLoader: FontLoader;
};

function visibleCharacters(textValue: string): readonly string[] {
  return [...textValue].filter((char) => char.trim().length > 0);
}

function fontSupportsVisibleText(font: AbstractFont, textValue: string): boolean {
  return visibleCharacters(textValue).every((char) => fontHasGlyph(font, char));
}

async function createTextFontResolver(node: FigNode, fontLoader: FontLoader): Promise<TextFontResolver> {
  const props = extractTextProps(node);
  const loaded = await fontLoader.loadFont(props.font);

  if (!loaded) {
    throw new Error(`Shared text renderer requires primary font ${props.font.family} ${props.font.weight}`);
  }
  if (!fontSupportsVisibleText(loaded.font, props.characters)) {
    throw new Error(`Shared text renderer primary font ${props.font.family} cannot cover text node ${node.id}`);
  }

  return () => loaded.font;
}

/**
 * Render a text node as SVG using the shared text rendering resolver.
 */
export async function renderTextNodeAsPath(node: FigNode, ctx: PathRenderContext): Promise<SvgString> {
  const props = extractTextProps(node);
  if (props.characters.length === 0) {
    return formatTextRenderingToSvg(resolveTextRendering(node, { blobs: ctx.blobs }));
  }

  const fontResolver = await createTextFontResolver(node, ctx.fontLoader);
  const rendering = resolveTextRendering(node, {
    blobs: ctx.blobs,
    fontResolver,
  });

  if (rendering.kind === "lines") {
    throw new Error(`Shared text renderer did not produce glyph contours for text node ${node.id}`);
  }

  return formatTextRenderingToSvg(rendering);
}

/**
 * Batch render multiple text nodes as SVG.
 */
export async function batchRenderTextNodesAsPaths(
  nodes: readonly FigNode[],
  ctx: PathRenderContext,
): Promise<readonly SvgString[]> {
  const results: SvgString[] = [];

  for (const node of nodes) {
    const result = await renderTextNodeAsPath(node, ctx);
    results.push(result);
  }

  return results;
}

/** Get font metrics from a loaded font. */
export function getFontMetricsFromFont(font: AbstractFont): {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
} {
  return {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    lineGap: (font.tables?.hhea?.lineGap as number) ?? 0,
  };
}

/** Calculate baseline offset for proper vertical positioning. */
export function calculateBaselineOffset(
  font: AbstractFont,
  fontSize: number,
  verticalAlign: "TOP" | "CENTER" | "BOTTOM",
): number {
  const scale = fontSize / font.unitsPerEm;
  const ascender = font.ascender * scale;
  const descender = Math.abs(font.descender * scale);
  const lineHeight = ascender + descender;

  switch (verticalAlign) {
    case "TOP":
      return ascender;
    case "CENTER":
      return ascender - lineHeight / 2 + fontSize / 2;
    case "BOTTOM":
      return fontSize - descender;
  }
}
