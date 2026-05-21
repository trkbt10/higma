/**
 * @file Derived path-based text rendering
 *
 * Renders text using pre-computed glyph paths from derivedTextData.
 * This achieves exact visual match (0% diff) with Figma's export because
 * we use the same path data that Figma stores internally.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import type {
  FigDerivedTextData,
  FigDerivedGlyph,
  FigDerivedDecoration,
} from "@higma-document-models/fig/types";
import { decodePathCommands, type FigBlob } from "@higma-document-models/fig/domain";
import type { PathCommand } from "@higma-primitives/path";
import type { FigSvgRenderContext } from "../../../types";
import { path, g, type SvgString, EMPTY_SVG } from "../../primitives";
import { buildTransformAttr } from "../../transform";
import { extractTextProps, getAllVisibleSolidFills } from "../../../text";

/**
 * Render context with blobs for path decoding
 */
export type DerivedPathRenderContext = FigSvgRenderContext & {
  blobs: readonly FigBlob[];
};

/**
 * Transform normalized path commands to screen coordinates
 *
 * The blob paths are stored in normalized coordinates (0-1 range).
 * We need to scale by fontSize and translate to position.
 *
 * Coordinate transformation:
 * - x_screen = position.x + (normalized_x * fontSize)
 * - y_screen = baseline - (normalized_y * fontSize)
 *
 * The y-axis is flipped because in the normalized space, y increases upward
 * (from baseline), but in screen space, y increases downward.
 *
 * The baseline is computed as round(position.y) because Figma's SVG export
 * uses rounded baseline values for better pixel alignment.
 */
function transformPathCommands(
  { commands, position, fontSize, precision = 5 }: { commands: readonly PathCommand[]; position: { x: number; y: number }; fontSize: number; precision?: number; }
): string {
  const parts: string[] = [];

  const roundPrecision = (n: number) => {
    const factor = Math.pow(10, precision);
    return Math.round(n * factor) / factor;
  };

  // Use rounded position.y as baseline for pixel-perfect alignment
  const baselineY = Math.round(position.y);
  const transformX = (x: number) => roundPrecision(position.x + x * fontSize);
  const transformY = (y: number) => roundPrecision(baselineY - y * fontSize);

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        parts.push(`M${transformX(cmd.x)} ${transformY(cmd.y)}`);
        break;
      case "L":
        parts.push(`L${transformX(cmd.x)} ${transformY(cmd.y)}`);
        break;
      case "C":
        parts.push(
          `C${transformX(cmd.x1)} ${transformY(cmd.y1)} ${transformX(cmd.x2)} ${transformY(cmd.y2)} ${transformX(cmd.x)} ${transformY(cmd.y)}`,
        );
        break;
      case "Q":
        parts.push(`Q${transformX(cmd.x1)} ${transformY(cmd.y1)} ${transformX(cmd.x)} ${transformY(cmd.y)}`);
        break;
      case "A":
        // Derived-glyph blobs come from the Kiwi byte stream which
        // has no Arc opcode — the decoder only ever emits M/L/C/Q/Z.
        // The arm exists for exhaustiveness against the canonical
        // PathCommand union; reaching it would mean a caller routed
        // SVG-parsed commands through here, which would silently lose
        // the rx/ry/rotation/flag data when emitted as a glyph d.
        throw new Error(
          "derived-path-render: glyph commands unexpectedly contain an SVG Arc — derived-glyph blobs only emit M/L/C/Q/Z",
        );
      case "Z":
        parts.push("Z");
        break;
    }
  }

  return parts.join("");
}

/**
 * Render decoration rectangles as SVG path
 *
 * Decorations include underlines and strikethroughs.
 * They are stored as simple rectangles in derivedTextData.decorations.
 */
function renderDecorationPaths(decorations: readonly FigDerivedDecoration[] | undefined, precision: number = 5): string {
  if (!decorations || decorations.length === 0) {
    return "";
  }

  const round = (n: number) => {
    const factor = Math.pow(10, precision);
    return Math.round(n * factor) / factor;
  };

  const paths: string[] = [];

  for (const decoration of decorations) {
    for (const rect of decoration.rects) {
      // Convert rectangle to path: M x y H (x+w) V (y+h) H x Z
      const x = round(rect.x);
      const y = round(rect.y);
      const x2 = round(rect.x + rect.w);
      const y2 = round(rect.y + rect.h);
      paths.push(`M${x} ${y}H${x2}V${y2}H${x}Z`);
    }
  }

  return paths.join("");
}

/**
 * Render a single glyph as SVG path
 */
function renderGlyphPath(glyph: FigDerivedGlyph, blobs: readonly FigBlob[], precision: number = 5): string | undefined {
  if (glyph.commandsBlob === undefined) {
    return undefined;
  }

  if (glyph.commandsBlob >= blobs.length) {
    throw new Error(`Derived text glyph references missing commands blob ${glyph.commandsBlob}`);
  }

  const blob = blobs[glyph.commandsBlob];
  if (!blob) {
    throw new Error(`Derived text glyph commands blob ${glyph.commandsBlob} is unavailable`);
  }

  // Decode path commands
  const commands = decodePathCommands(blob);
  if (commands.length === 0) {
    throw new Error(`Derived text glyph commands blob ${glyph.commandsBlob} decoded to an empty path`);
  }

  // Transform to screen coordinates
  return transformPathCommands({ commands, position: glyph.position, fontSize: glyph.fontSize, precision });
}

/**
 * Render text node using derived path data
 *
 * This function uses the pre-computed glyph paths from derivedTextData
 * to achieve exact visual match with Figma's export.
 *
 * @param node - Figma TEXT node
 * @param ctx - Render context with blobs
 * @returns SVG string
 */
export function renderTextNodeFromDerivedData(node: FigNode, ctx: DerivedPathRenderContext): SvgString {
  const props = extractTextProps(node);
  const derivedTextData: FigDerivedTextData | undefined = node.derivedTextData;

  if (!derivedTextData?.glyphs || derivedTextData.glyphs.length === 0) {
    return renderEmptyDerivedGlyphData(node, props.characters);
  }

  const transformStr = buildTransformAttr(props.transform);

  // Render all glyphs as a single combined path
  // The baseline is computed as round(position.y) for pixel-perfect alignment
  const glyphPaths: string[] = [];

  for (const glyph of derivedTextData.glyphs) {
    const glyphPath = renderGlyphPath(glyph, ctx.blobs);
    if (glyphPath) {
      glyphPaths.push(glyphPath);
    }
  }

  // Render decoration paths (underlines, strikethroughs)
  const decorationPath = renderDecorationPaths(derivedTextData.decorations);

  if (glyphPaths.length === 0 && !decorationPath) {
    return renderEmptyDerivedPathOutput(node, props.characters);
  }

  // Combine all glyph paths and decoration paths.
  const combinedPath = glyphPaths.join("") + decorationPath;

  // Emit one `<path>` element per visible solid fill, in paint-order, so
  // SVG's painter's-algorithm stacking reproduces Figma's multi-fill
  // composite. A node with `[{black, opacity=0.15}, {black, opacity=1}]`
  // therefore emits two paths — first the faint pass, then the opaque
  // pass on top — yielding solid black after rasterisation. A node with
  // a single fill collapses to one path; a node with no visible solid
  // fill falls back to a single black/opaque path so the glyph still
  // shows (matches `getFillColorAndOpacity`'s historical default).
  const fills = getAllVisibleSolidFills(props.fillPaints);
  const pathElements = buildDerivedTextPathElements(combinedPath, fills);

  // Wrap in group if transform, opacity, OR multiple paint layers need
  // a shared container.
  const needsWrap = transformStr !== "" || props.opacity < 1 || pathElements.length > 1;
  if (needsWrap) {
    return g(
      {
        transform: transformStr || undefined,
        opacity: props.opacity < 1 ? props.opacity : undefined,
      },
      ...pathElements,
    );
  }

  return pathElements[0];
}

function renderEmptyDerivedGlyphData(node: FigNode, characters: string): SvgString {
  if (characters.length > 0) {
    throw new Error(`Derived text renderer requires glyph data for non-empty text node ${node.id}`);
  }
  return EMPTY_SVG;
}

function renderEmptyDerivedPathOutput(node: FigNode, characters: string): SvgString {
  if (characters.trim().length > 0) {
    throw new Error(`Derived text renderer produced no visible paths for non-empty text node ${node.id}`);
  }
  return EMPTY_SVG;
}

function buildDerivedTextPathElements(
  combinedPath: string,
  fills: readonly { readonly color: string; readonly opacity: number }[],
): readonly SvgString[] {
  if (fills.length === 0) {
    return [path({ d: combinedPath, fill: "#000000" })];
  }
  return fills.map((f) => path({
    d: combinedPath,
    fill: f.color,
    "fill-opacity": f.opacity < 1 ? f.opacity : undefined,
  }));
}

/**
 * Check if a text node has derived path data available
 */
export function hasDerivedPathData(node: FigNode): boolean {
  const dtd = node.derivedTextData;
  return !!(dtd?.glyphs && dtd.glyphs.length > 0);
}
