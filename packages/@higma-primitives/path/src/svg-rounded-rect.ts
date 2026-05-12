/**
 * @file Rounded-rectangle SVG path-`d` builder — single SoT used by the
 * SVG / React / scene-graph render-tree pipelines.
 *
 * The same path-`d` string is consumed by:
 *   - the renderer's SVG scene-renderer (rect fill/stroke shapes)
 *   - render-tree clip-path shape construction
 *   - the React renderer's rect primitive component
 *
 * All consumers MUST produce the same path so that fill, stroke, and
 * clip align to the same sub-pixels. Using SVG `<rect rx>` or `A` arc
 * commands instead of cubic Bézier corners causes resvg-js to
 * rasterise the rounded corner one sub-pixel off from Figma's
 * exporter, producing a ~0.1% AA-only diff at large corner radii.
 *
 * Figma's SVG exporter emits the same Bézier-corner pattern with
 * KAPPA = 0.5522847498307936 (4·(√2−1)/3), so we use the constant
 * exported from `./contours/rect`.
 */

import { KAPPA } from "./contours";

/**
 * Build a rounded rect SVG path d string using cubic Bézier corners.
 *
 * Output verbatim shape (for tl=tr=br=bl=r, origin (X,Y), size (W,H)):
 *
 *   M X+r Y                  (top edge start)
 *   L X+W-r Y
 *   C ... X+W Y+r            (top-right corner)
 *   L X+W Y+H-r
 *   C ... X+W-r Y+H          (bottom-right corner)
 *   L X+r Y+H
 *   C ... X Y+H-r            (bottom-left corner)
 *   L X Y+r
 *   C ... X+r Y              (top-left corner)
 *   Z
 *
 * Origin defaults to (0, 0). A non-zero origin is used by clip-path
 * resolution when the clip is expanded outward by a stroke margin —
 * the expanded rect spans `(-margin, -margin) → (W+margin, H+margin)`.
 */
export function buildRoundedRectPathD(
  w: number,
  h: number,
  radii: readonly [number, number, number, number],
  origin: { x: number; y: number } = { x: 0, y: 0 },
): string {
  const [tl, tr, br, bl] = radii;
  const cTl = tl * (1 - KAPPA);
  const cTr = tr * (1 - KAPPA);
  const cBr = br * (1 - KAPPA);
  const cBl = bl * (1 - KAPPA);
  const x = origin.x;
  const y = origin.y;
  const parts = [
    `M ${x + tl} ${y}`,
    `L ${x + w - tr} ${y}`,
    tr > 0 ? `C ${x + w - cTr} ${y} ${x + w} ${y + cTr} ${x + w} ${y + tr}` : "",
    `L ${x + w} ${y + h - br}`,
    br > 0 ? `C ${x + w} ${y + h - cBr} ${x + w - cBr} ${y + h} ${x + w - br} ${y + h}` : "",
    `L ${x + bl} ${y + h}`,
    bl > 0 ? `C ${x + cBl} ${y + h} ${x} ${y + h - cBl} ${x} ${y + h - bl}` : "",
    `L ${x} ${y + tl}`,
    tl > 0 ? `C ${x} ${y + cTl} ${x + cTl} ${y} ${x + tl} ${y}` : "",
    "Z",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Re-export under the legacy `CORNER_KAPPA` name for renderer callers. */
export const CORNER_KAPPA = KAPPA;
