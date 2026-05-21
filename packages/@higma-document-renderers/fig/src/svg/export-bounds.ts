/**
 * @file Compute the SVG-export viewBox for a root FigNode the same way
 * Figma's own exporter does.
 *
 * The exported viewBox is the union of three contributions:
 *
 *  1. The node's intrinsic `size`, padded by its outward effect halo
 *     (DROP_SHADOW offset+radius+spread, FOREGROUND_BLUR radius, etc.) — see
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
 *     descendant contributes its own export surface, while a
 *     clipsContent=false descendant additionally contributes its own
 *     descendants' boxes. Descendant authored strokeGeometry can expand
 *     that descendant surface, but fillGeometry is clipped to the node
 *     surface and the exported root's own geometry does not replace the
 *     root surface bounds.
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
 * shape of the function.
 */

import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { pathContoursBoundingBox } from "@higma-primitives/path";
import { decodeGeometryToContours } from "../scene-graph/convert";
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
 * of ancestor transforms — this function deliberately stays at the local
 * level so it can be composed recursively without re-walking the tree.
 */
export type FigExportBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type FigChildrenOf = (node: FigNode) => readonly FigNode[];

/**
 * Options for `computeFigExportBounds`.
 */
export type ComputeFigExportBoundsOptions = {
  /**
   * Parent/child view over the Kiwi document. Export bounds must walk the
   * same document index the renderer consumes; raw `node.children` is not a
   * second source of truth.
   */
  readonly childrenOf: FigChildrenOf;
  /**
   * Binary geometry blobs from the same Kiwi document. Export bounds are
   * allowed to grow from authored fill/stroke geometry, so callers must
   * provide the same blob table the renderer consumes.
   */
  readonly blobs: readonly FigBlob[];
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

const DEFAULT_CEIL_INTEGERS = true;

type ResolvedComputeFigExportBoundsOptions = {
  readonly childrenOf: FigChildrenOf;
  readonly blobs: readonly FigBlob[];
  readonly ceilIntegers: boolean;
};

type GeometryExpansionScope = "root-surface" | "unclipped-descendant";

function resolveOptions(options: ComputeFigExportBoundsOptions): ResolvedComputeFigExportBoundsOptions {
  return {
    childrenOf: options.childrenOf,
    blobs: options.blobs,
    ceilIntegers: options.ceilIntegers ?? DEFAULT_CEIL_INTEGERS,
  };
}

const IDENTITY_TRANSLATE = 0;

function schemaTranslateX(node: FigNode): number {
  return node.transform?.m02 ?? IDENTITY_TRANSLATE;
}

function schemaTranslateY(node: FigNode): number {
  return node.transform?.m12 ?? IDENTITY_TRANSLATE;
}

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
 * `frameMaskDisabled === true` (Kiwi field; semantically the
 * inversion of the Figma UI's "Clip content" toggle). Otherwise the
 * box is just the node's intrinsic size + effect halo.
 */
function unionLocalBox(
  node: FigNode,
  options: ResolvedComputeFigExportBoundsOptions,
  geometryExpansionScope: GeometryExpansionScope,
): FigExportBox {
  const effect = computeNodeEffectExpansion(node);
  const sizeX = node.size?.x ?? 0;
  const sizeY = node.size?.y ?? 0;

  let xMin = negZeroSafe(effect.left);
  let yMin = negZeroSafe(effect.top);
  let xMax = sizeX + effect.right;
  let yMax = sizeY + effect.bottom;

  const geometry = descendantStrokeGeometryBox(node, options.blobs, geometryExpansionScope);
  if (geometry !== undefined) {
    const gxMax = geometry.x + geometry.width;
    const gyMax = geometry.y + geometry.height;
    if (geometry.x < xMin) { xMin = geometry.x; }
    if (geometry.y < yMin) { yMin = geometry.y; }
    if (gxMax > xMax) { xMax = gxMax; }
    if (gyMax > yMax) { yMax = gyMax; }
  }

  if (node.frameMaskDisabled === true) {
    for (const child of options.childrenOf(node)) {
      if (child.visible === false) {
        continue;
      }
      const inner = unionLocalBox(child, options, "unclipped-descendant");
      const tx = schemaTranslateX(child);
      const ty = schemaTranslateY(child);
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

function descendantStrokeGeometryBox(
  node: FigNode,
  blobs: readonly FigBlob[],
  geometryExpansionScope: GeometryExpansionScope,
): FigExportBox | undefined {
  if (geometryExpansionScope === "root-surface") {
    return undefined;
  }
  return nodeStrokeGeometryBox(node, blobs);
}

function nodeStrokeGeometryBox(
  node: FigNode,
  blobs: readonly FigBlob[],
): FigExportBox | undefined {
  const contours = decodeGeometryToContours(node.strokeGeometry, blobs);
  const box = pathContoursBoundingBox(contours);
  if (box === undefined) {
    return undefined;
  }
  return { x: box.x, y: box.y, width: box.w, height: box.h };
}

/**
 * Compute the export viewBox a `FigNode` would receive when sent through
 * Figma's SVG exporter.
 */
export function computeFigExportBounds(
  node: FigNode,
  options: ComputeFigExportBoundsOptions,
): FigExportBox {
  const opts = resolveOptions(options);
  const raw = unionLocalBox(node, opts, "root-surface");
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

/**
 * Compute the world-space viewport to pass to `renderFigToSvg` when
 * exporting one root node. `computeFigExportBounds` returns a box in the
 * root's local coordinates; the renderer consumes the document's world
 * coordinates, so the root's Kiwi translation is applied exactly once here.
 */
export function computeFigExportViewport(
  node: FigNode,
  options: ComputeFigExportBoundsOptions,
): FigExportBox {
  const box = computeFigExportBounds(node, options);
  return {
    x: schemaTranslateX(node) + box.x,
    y: schemaTranslateY(node) + box.y,
    width: box.width,
    height: box.height,
  };
}
