/**
 * @file SVG text attribute building
 *
 * Unpacks the canonical `ExtractedTextProps.font` (FontQuery) into the
 * three flat CSS attributes the SVG `<text>` element accepts. This is the
 * single boundary where the structured query becomes presentation data —
 * other layers continue to speak `FontQuery`.
 */

import type { text } from "../../primitives";
import { getAlignedX, type ExtractedTextProps } from "../../../text";
import { getTextAnchor } from "./alignment";

/**
 * SVG text element attributes
 */
export type SvgTextAttrs = Parameters<typeof text>[0];

/**
 * Build SVG text attributes from extracted props
 *
 * Creates the attribute object for an SVG <text> element
 * including position, font, color, and alignment.
 *
 * @param props - Extracted text properties
 * @param fillColor - Resolved fill color (hex)
 * @param fillOpacity - Fill opacity (0-1)
 * @returns Attributes for SVG text element
 */
export function buildTextAttrs(
  { props, fillColor, fillOpacity }: { props: ExtractedTextProps; fillColor: string; fillOpacity: number; }
): SvgTextAttrs {
  const textAnchor = getTextAnchor(props.textAlignHorizontal);
  const x = getAlignedX(props.textAlignHorizontal, props.size?.width);
  const { font } = props;

  return {
    x,
    fill: fillColor,
    "fill-opacity": fillOpacity < 1 ? fillOpacity : undefined,
    "font-family": font.family,
    "font-size": props.fontSize,
    "font-weight": font.weight,
    "font-style": font.style !== "normal" ? font.style : undefined,
    "letter-spacing": props.letterSpacing,
    "text-anchor": textAnchor !== "start" ? textAnchor : undefined,
  };
}
