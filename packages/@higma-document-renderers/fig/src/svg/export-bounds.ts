/**
 * @file Compute the SVG-export viewBox for a root FigNode the same way
 * Figma's own exporter does.
 *
 * The exported viewBox is the union of three contributions:
 *
 *  1. The node's intrinsic `size`, padded by its outward effect halo
 *     (DROP_SHADOW offset+radius+spread, LAYER_BLUR radius, etc.) — see
 *     `effect-bounds.ts`.
 *
 *  2. The bounding box of every visible descendant, transformed back
 *     into the root's local frame, BUT only when the node is a frame
 *     whose content is NOT clipped (raw `frameMaskDisabled === true`,
 *     i.e. clipsContent=false in Figma UI terms). This is why the
 *     App Store "Apps" SYMBOL (stored at 402×296 with `frameMaskDisabled:
 *     true` and a 772-wide grid child) exports as `viewBox="0 0 772 306"`
 *     instead of `0 0 402 306`.
 *
 *     The same recursion applies inside descendants: a clipsContent=true
 *     descendant only contributes its own padded box; a clipsContent=false
 *     descendant additionally contributes its own descendants' boxes.
 *
 *  3. After unioning everything, the resulting width/height is rounded
 *     UP to the next integer (the extra sub-pixel goes to the
 *     right/bottom edge). This is also Figma exporter behaviour — an
 *     icon stored at 26.26×24.03 exports as `viewBox="0 0 27 25"`.
 *
 * Transforms are reduced to translation only — m02/m12 — which is
 * sufficient for the typical Figma layout where m00/m11=1 and m01/m10=0.
 * A node with a non-trivial 2D rotation/scale would need the full
 * transformed-corner-bbox computation; the simple model documented here
 * stays general enough that introducing that later does not change the
 * shape of the helper.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import { computeNodeEffectExpansion } from "./effect-bounds";

/**
 * Local-space export box for a single FigNode.
 *
 * `x`/`y` may be negative when an effect halo (or, for clipsContent=false
 * frames, an overflowing child placed at a negative offset) extends past
 * the node's local origin. `width`/`height` are always non-negative.
 *
 * The returned box is in the node's OWN local coordinate system. To
 * compute world-space (canvas-space) bounds, callers must add the chain
 * of ancestor transforms — this helper deliberately stays at the local
 * level so it can be composed recursively without re-walking the tree.
 */
export type FigExportBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Options for `computeFigExportBounds`.
 */
export type ComputeFigExportBoundsOptions = {
  /**
   * Round the final width/height up to the next integer. Defaults to
   * `true`, matching Figma's SVG exporter. Set to `false` when sub-pixel
   * accuracy is required (e.g. for a WebGL renderer that does its own
   * pixel snapping).
   *
   * Note: only `width`/`height` are rounded; `x`/`y` are kept exact so
   * the caller can still pin the original origin precisely. The extra
   * sub-pixel goes to the right/bottom edge.
   */
  readonly ceilIntegers?: boolean;
};

const DEFAULT_OPTIONS: Required<ComputeFigExportBoundsOptions> = {
  ceilIntegers: true,
};

/**
 * Negate while preserving `+0` instead of producing `-0`. The latter
 * survives object equality (`Object.is(-0, 0) === false`) and leaks
 * into Vitest snapshot diffs in a way that obscures real changes.
 */
function negZeroSafe(value: number): number {
  return value === 0 ? 0 : -value;
}

/**
 * Compute the union local-space export box for a node.
 *
 * Recurses into descendants ONLY when the node has
 * `frameMaskDisabled === true` (raw Kiwi field; semantically the
 * inversion of the Figma UI's "Clip content" toggle). Otherwise the
 * box is just the node's intrinsic size + effect halo.
 */
function unionLocalBox(node: FigNode): FigExportBox {
  const effect = computeNodeEffectExpansion(node);
  const sizeX = node.size?.x ?? 0;
  const sizeY = node.size?.y ?? 0;

  let xMin = negZeroSafe(effect.left);
  let yMin = negZeroSafe(effect.top);
  let xMax = sizeX + effect.right;
  let yMax = sizeY + effect.bottom;

  if (node.frameMaskDisabled === true && Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child.visible === false) {
        continue;
      }
      const inner = unionLocalBox(child);
      const tx = child.transform?.m02 ?? 0;
      const ty = child.transform?.m12 ?? 0;
      const cxMin = inner.x + tx;
      const cyMin = inner.y + ty;
      const cxMax = inner.x + inner.width + tx;
      const cyMax = inner.y + inner.height + ty;
      if (cxMin < xMin) { xMin = cxMin; }
      if (cyMin < yMin) { yMin = cyMin; }
      if (cxMax > xMax) { xMax = cxMax; }
      if (cyMax > yMax) { yMax = cyMax; }
    }
  }

  return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin };
}

/**
 * Compute the export viewBox a `FigNode` would receive when sent through
 * Figma's SVG exporter.
 */
export function computeFigExportBounds(
  node: FigNode,
  options?: ComputeFigExportBoundsOptions,
): FigExportBox {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const raw = unionLocalBox(node);
  if (!opts.ceilIntegers) {
    return raw;
  }
  return {
    x: raw.x,
    y: raw.y,
    width: Math.ceil(raw.width),
    height: Math.ceil(raw.height),
  };
}
