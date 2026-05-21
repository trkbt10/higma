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
 * Child and root transforms use the full Kiwi affine matrix. This matters
 * for mirrored component exports such as the App Store template's
 * horizontally flipped `Feature Art` symbol: using only `m02/m12` places
 * the rendered surface outside the world-space viewBox.
 */

import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import { pathContoursBoundingBox } from "@higma-primitives/path";
import { decodeGeometryToContours } from "../scene-graph";
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
/**
 * Figma SVG export reserves 40 px around a root SECTION and draws the
 * section surface at `(40, 40)`. The iOS App Store template's
 * `Mockups` SECTION is 3401×1368 in Kiwi and exports as 3481×1448
 * with its first surface path starting at `M40 42...`.
 */
const FIGMA_SECTION_EXPORT_PADDING = 40;

type ResolvedComputeFigExportBoundsOptions = {
  readonly childrenOf: FigChildrenOf;
  readonly blobs: readonly FigBlob[];
  readonly ceilIntegers: boolean;
};

type GeometryExpansionScope = "root-surface" | "unclipped-descendant";
type FigExportExtents = {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
};

function resolveOptions(options: ComputeFigExportBoundsOptions): ResolvedComputeFigExportBoundsOptions {
  return {
    childrenOf: options.childrenOf,
    blobs: options.blobs,
    ceilIntegers: options.ceilIntegers ?? DEFAULT_CEIL_INTEGERS,
  };
}

/**
 * Negate while preserving `+0` instead of producing `-0`. The latter
 * survives object equality (`Object.is(-0, 0) === false`) and leaks
 * into Vitest snapshot diffs in a way that obscures real changes.
 */
function negZeroSafe(value: number): number {
  return value === 0 ? 0 : -value;
}

function transformBox(box: FigExportBox, transform: FigNode["transform"]): FigExportBox {
  const matrix = readKiwiTransform(transform);
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  const points = [
    { x: matrix.m00 * x0 + matrix.m01 * y0 + matrix.m02, y: matrix.m10 * x0 + matrix.m11 * y0 + matrix.m12 },
    { x: matrix.m00 * x1 + matrix.m01 * y0 + matrix.m02, y: matrix.m10 * x1 + matrix.m11 * y0 + matrix.m12 },
    { x: matrix.m00 * x0 + matrix.m01 * y1 + matrix.m02, y: matrix.m10 * x0 + matrix.m11 * y1 + matrix.m12 },
    { x: matrix.m00 * x1 + matrix.m01 * y1 + matrix.m02, y: matrix.m10 * x1 + matrix.m11 * y1 + matrix.m12 },
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const xMin = Math.min(...xs);
  const yMin = Math.min(...ys);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys);
  return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin };
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
  const sectionPadding = rootSurfaceSectionPadding(node, geometryExpansionScope);
  const sizeX = node.size?.x ?? 0;
  const sizeY = node.size?.y ?? 0;
  const surfaceExtents = {
    xMin: negZeroSafe(effect.left + sectionPadding),
    yMin: negZeroSafe(effect.top + sectionPadding),
    xMax: sizeX + effect.right + sectionPadding,
    yMax: sizeY + effect.bottom + sectionPadding,
  };
  const geometry = descendantStrokeGeometryBox(node, options.blobs, geometryExpansionScope);
  const geometryExtents = expandExtentsWithOptionalBox(surfaceExtents, geometry);
  const childExtents = expandExtentsWithUnclippedChildren(node, options, geometryExtents);

  return extentsToBox(childExtents);
}

function expandExtentsWithOptionalBox(extents: FigExportExtents, box: FigExportBox | undefined): FigExportExtents {
  if (box === undefined) {
    return extents;
  }
  return expandExtentsWithBox(extents, box);
}

function expandExtentsWithUnclippedChildren(
  node: FigNode,
  options: ResolvedComputeFigExportBoundsOptions,
  extents: FigExportExtents,
): FigExportExtents {
  if (node.frameMaskDisabled !== true) {
    return extents;
  }
  return options.childrenOf(node).reduce(
    (acc, child) => expandExtentsWithChild(acc, child, options),
    extents,
  );
}

function expandExtentsWithChild(
  extents: FigExportExtents,
  child: FigNode,
  options: ResolvedComputeFigExportBoundsOptions,
): FigExportExtents {
  if (child.visible === false) {
    return extents;
  }
  const inner = unionLocalBox(child, options, "unclipped-descendant");
  const childBox = transformBox(inner, child.transform);
  return expandExtentsWithBox(extents, childBox);
}

function extentsToBox(extents: FigExportExtents): FigExportBox {
  return {
    x: extents.xMin,
    y: extents.yMin,
    width: extents.xMax - extents.xMin,
    height: extents.yMax - extents.yMin,
  };
}

function expandExtentsWithBox(extents: FigExportExtents, box: FigExportBox): FigExportExtents {
  return {
    xMin: Math.min(extents.xMin, box.x),
    yMin: Math.min(extents.yMin, box.y),
    xMax: Math.max(extents.xMax, box.x + box.width),
    yMax: Math.max(extents.yMax, box.y + box.height),
  };
}

function rootSurfaceSectionPadding(
  node: FigNode,
  geometryExpansionScope: GeometryExpansionScope,
): number {
  if (geometryExpansionScope !== "root-surface") {
    return 0;
  }
  if (node.type?.name !== "SECTION") {
    return 0;
  }
  return FIGMA_SECTION_EXPORT_PADDING;
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
  return transformBox(box, node.transform);
}
