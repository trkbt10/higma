/**
 * @file Scene graph builder
 *
 * Converts Kiwi FigNode values to a format-agnostic scene graph.
 * The resulting scene graph can be consumed by both SVG and WebGL backends.
 *
 * This builder accepts Kiwi FigNode directly and must not route through
 * another document shape.
 */

import type { FigStyleRegistry } from "@higma-document-models/fig/domain";
import type { FigFillGeometry, FigKiwiVariableModeBySetMap, FigMaskType, FigNode, FigPaint, FigStyleId } from "@higma-document-models/fig/types";
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import {
  formatNodeLocator,
  mergeVariableModeBySetMap,
  resolveStyledEffects,
  resolveStyledPaint,
  isVariantSetFrame,
  type SymbolResolver,
} from "@higma-document-models/fig/symbols";
import { IDENTITY_MATRIX } from "@higma-document-models/fig/matrix";
import type {
  SceneGraph, SceneNode, GroupNode, FrameNode, RectNode, EllipseNode, PathNode, TextNode, SceneNodeId, ClipShape } from "@higma-document-renderers/fig/scene-graph";
import { createNodeId } from "@higma-document-renderers/fig/scene-graph";
import {
  convertEffectsToScene,
  convertPaintsToFills,
  convertStrokeToSceneStroke,
  convertTextNode,
  convertVectorPathsToContours,
  decodeGeometryToContours,
  type DecodedContour,
} from "./convert";
import { reconstructStrokeCenterline } from "@higma-primitives/path";
import {
  generateEllipseContour, generateLineContour, generatePolygonContour, generateRectContour, generateStarContour, parseSvgPathD, } from "@higma-primitives/path";
import type { Fill, PathContour, ArcData } from "@higma-document-renderers/fig/scene-graph";
import { convertFigmaNodeBlendMode } from "@higma-document-renderers/fig/scene-graph";
import type { TextAutoResize } from "@higma-document-renderers/fig/scene-graph";
import { TEXT_AUTO_RESIZE_OMITTED_DEFAULT, kiwiEnumName } from "@higma-document-models/fig/constants";
import type { TextFontResolver } from "../text";
import { evaluateBooleanPathResult, type BooleanPathInput } from "@higma-primitives/path";
import { resolveBooleanOperationType } from "@higma-document-models/fig/boolean-operation";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import { resolveClipsContent as resolveGeometryClipsContent } from "@higma-document-models/fig/geometry-interpret";
import { resolveAuthoredAutoLayoutFrameStretch } from "@higma-document-models/fig/symbols/autolayout-solver";
import type { AffineMatrix, CornerRadius, PathCommand } from "@higma-primitives/path";

/**
 * Figma stores a component variant set as a Kiwi FRAME with
 * `isStateGroup === true` and VARIANT component properties. The
 * exported component-set chrome is a purple 10/5 dashed inside stroke
 * even when Kiwi does not carry an explicit dash array for that FRAME.
 */
const FIGMA_VARIANT_SET_FRAME_STROKE_DASH_PATTERN = [10, 5] as const;

function convertKiwiTransform(
  matrix: { m00?: number; m01?: number; m02?: number; m10?: number; m11?: number; m12?: number } | undefined,
): AffineMatrix {
  if (!matrix) { return IDENTITY_MATRIX; }
  return {
    m00: matrix.m00 ?? 1,
    m01: matrix.m01 ?? 0,
    m02: matrix.m02 ?? 0,
    m10: matrix.m10 ?? 0,
    m11: matrix.m11 ?? 1,
    m12: matrix.m12 ?? 0,
  };
}

function extractKiwiCornerRadius(node: FigNode): CornerRadius | undefined {
  const radii = node.rectangleCornerRadii;
  if (radii !== undefined && radii.length === 4) {
    return normalizeCornerRadiusTuple(radii[0], radii[1], radii[2], radii[3]);
  }
  const individual = extractKiwiIndividualCornerRadius(node);
  if (individual !== undefined) {
    return individual;
  }
  return node.cornerRadius;
}

function extractKiwiIndividualCornerRadius(node: FigNode): CornerRadius | undefined {
  const topLeft = node.rectangleTopLeftCornerRadius;
  const topRight = node.rectangleTopRightCornerRadius;
  const bottomRight = node.rectangleBottomRightCornerRadius;
  const bottomLeft = node.rectangleBottomLeftCornerRadius;
  if (
    topLeft === undefined &&
    topRight === undefined &&
    bottomRight === undefined &&
    bottomLeft === undefined
  ) {
    return undefined;
  }
  if (node.rectangleCornerRadiiIndependent === true) {
    return normalizeCornerRadiusTuple(
      topLeft ?? 0,
      topRight ?? 0,
      bottomRight ?? 0,
      bottomLeft ?? 0,
    );
  }
  return normalizeCornerRadiusTuple(
    topLeft ?? requireKiwiCornerRadiusField(node, "rectangleTopLeftCornerRadius"),
    topRight ?? requireKiwiCornerRadiusField(node, "rectangleTopRightCornerRadius"),
    bottomRight ?? requireKiwiCornerRadiusField(node, "rectangleBottomRightCornerRadius"),
    bottomLeft ?? requireKiwiCornerRadiusField(node, "rectangleBottomLeftCornerRadius"),
  );
}

function requireKiwiCornerRadiusField(
  node: FigNode,
  field: "rectangleTopLeftCornerRadius" | "rectangleTopRightCornerRadius" | "rectangleBottomRightCornerRadius" | "rectangleBottomLeftCornerRadius",
): number {
  if (node.cornerRadius !== undefined) {
    return node.cornerRadius;
  }
  throw new Error(`buildSceneGraph: Kiwi node "${node.name ?? "(unnamed)"}" has ${field} omitted while using individual corner radius fields`);
}

function normalizeCornerRadiusTuple(
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
): CornerRadius | undefined {
  if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
    return topLeft || undefined;
  }
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function resolveKiwiClipsContent(node: FigNode): boolean {
  if (node.clipsContent !== undefined) { return node.clipsContent; }
  return resolveGeometryClipsContent(undefined, node.frameMaskDisabled, getNodeType(node));
}

function resolveFrameSurfaceShape(
  node: FigNode,
  ctx: BuildContext,
  size: NonNullable<FigNode["size"]>,
  cornerRadius: CornerRadius | undefined,
  cornerSmoothing: number | undefined,
  fills: readonly Fill[],
  effects: SceneNode["effects"],
): ClipShape {
  if (shouldUseParametricSmoothedSurface(node, ctx, fills, effects)) {
    return { type: "rect", width: size.x, height: size.y, cornerRadius, cornerSmoothing };
  }
  const contours = decodeGeometryToContours(node.fillGeometry, ctx.blobs);
  if (contours.length > 0) {
    return { type: "path", contours };
  }
  return { type: "rect", width: size.x, height: size.y, cornerRadius, cornerSmoothing };
}

function resolveFrameClipShape(
  surfaceShape: ClipShape,
  clipsContent: boolean,
): ClipShape | undefined {
  if (!clipsContent) {
    return undefined;
  }
  return surfaceShape;
}

type FramePaintSource = {
  readonly paints: readonly FigPaint[] | undefined;
  readonly styleRef: FigStyleId | undefined;
};

function frameBackgroundStyleRef(node: FigNode): FigStyleId | undefined {
  if (node.inheritFillStyleIDForBackground === undefined) {
    return undefined;
  }
  return { guid: node.inheritFillStyleIDForBackground };
}

function resolveFramePaintSource(node: FigNode): FramePaintSource {
  if (node.backgroundPaints !== undefined) {
    return {
      paints: node.backgroundPaints,
      styleRef: frameBackgroundStyleRef(node),
    };
  }
  return {
    paints: node.fillPaints,
    styleRef: node.styleIdForFill,
  };
}

// =============================================================================
// Mask Detection
// =============================================================================

/** Check if a FigNode acts as a mask for subsequent siblings. */
function isMaskNode(node: FigNode): boolean {
  return node.mask === true;
}

function resolveKiwiMaskType(node: FigNode): FigMaskType {
  const maskType = kiwiEnumName<FigMaskType>(node.maskType, "maskType");
  if (maskType !== undefined) {
    return maskType;
  }
  // Kiwi enum fields encode their zero value by omission. MaskType value
  // 0 is ALPHA in the schema, so an omitted maskType is not a renderer
  // choice; it is the decoded form of Kiwi's enum default.
  return "ALPHA";
}

/** Select fill paints based on whether stroke geometry is being used */
function selectPaintsForFills(
  isStrokeGeometry: boolean,
  paints: { strokePaints: readonly FigPaint[] | undefined; fillPaints: readonly FigPaint[] | undefined },
  images: ReadonlyMap<string, FigPackageImage>,
  subject: string,
): Fill[] {
  const source = isStrokeGeometry ? paints.strokePaints : paints.fillPaints;
  return convertPaintsToFills(source, images, subject);
}

function resolveScalarStrokeWeight(strokeWeight: FigNode["strokeWeight"] | undefined): number {
  if (typeof strokeWeight === "number") {
    return strokeWeight;
  }
  if (strokeWeight !== undefined) {
    return Math.max(strokeWeight.top, strokeWeight.right, strokeWeight.bottom, strokeWeight.left);
  }
  return 0;
}

function resolveVectorFills(
  reconstructed: boolean,
  treatAsFill: boolean,
  strokePaints: readonly FigPaint[] | undefined,
  fillPaints: readonly FigPaint[] | undefined,
  images: ReadonlyMap<string, FigPackageImage>,
  subject: string,
): Fill[] {
  if (reconstructed) { return []; }
  return selectPaintsForFills(treatAsFill, { strokePaints, fillPaints }, images, subject);
}

function resolveVectorStroke(
  treatAsFill: boolean,
  strokePaints: readonly FigPaint[] | undefined,
  strokeWeight: FigNode["strokeWeight"] | undefined,
  strokeCap: FigNode["strokeCap"],
  strokeJoin: FigNode["strokeJoin"],
  strokeDashes: readonly number[] | undefined,
  strokeAlign: FigNode["strokeAlign"],
) {
  if (treatAsFill) { return undefined; }
  return convertStrokeToSceneStroke(strokePaints, strokeWeight, { strokeCap, strokeJoin, dashPattern: strokeDashes, strokeAlign });
}

function resolveKiwiStrokeDashPattern(node: FigNode): readonly number[] | undefined {
  const authored = node.strokeDashes ?? node.dashPattern;
  if (authored !== undefined && authored.length > 0) {
    return authored;
  }
  if (isVariantSetFrame(node)) {
    return FIGMA_VARIANT_SET_FRAME_STROKE_DASH_PATTERN;
  }
  return authored;
}

function resolveNodeFillPaints(node: FigNode, fillPaints: readonly FigPaint[] | undefined, ctx: BuildContext): readonly FigPaint[] | undefined {
  return resolveStyledPaint(node.styleIdForFill, fillPaints, ctx.styleRegistry, {
    variableModeBySetMap: ctx.variableModeBySetMap,
  });
}

function resolveNodeStrokePaints(node: FigNode, strokePaints: readonly FigPaint[] | undefined, ctx: BuildContext): readonly FigPaint[] | undefined {
  return resolveStyledPaint(node.styleIdForStrokeFill, strokePaints, ctx.styleRegistry, {
    variableModeBySetMap: ctx.variableModeBySetMap,
  });
}

function resolveFrameFillPaints(node: FigNode, ctx: BuildContext): readonly FigPaint[] | undefined {
  const source = resolveFramePaintSource(node);
  return resolveStyledPaint(source.styleRef, source.paints, ctx.styleRegistry, {
    variableModeBySetMap: ctx.variableModeBySetMap,
  });
}

function resolveNodeEffects(node: FigNode, ctx: BuildContext): FigNode["effects"] {
  return resolveStyledEffects(node.styleIdForEffect, node.effects, ctx.styleRegistry);
}

function paintSubject(node: FigNode, field: "fillPaints" | "strokePaints" | "backgroundPaints" | "vectorData.styleOverrideTable"): string {
  return `${formatNodeLocator(node)}.${field}`;
}

function framePaintField(node: FigNode): "fillPaints" | "backgroundPaints" {
  return node.backgroundPaints !== undefined ? "backgroundPaints" : "fillPaints";
}

// =============================================================================
// Build Context
// =============================================================================

/**
 * Configuration for building a scene graph.
 *
 * Symbol resolution operates on Kiwi FigNode values.
 */
/**
 * Configuration for `buildSceneGraph`. Every field is required: the builder
 * does not invent defaults. If an input is genuinely absent for a call
 * site (e.g. a document without INSTANCE nodes still needs a resolver over
 * the document index), the caller passes the explicit "empty" value (`[]`,
 * `EMPTY_FIG_STYLE_
 * REGISTRY`, `false`) so intent is visible at the call site and never
 * hidden inside the builder.
 */
export type BuildSceneGraphOptions = {
  /** Binary blobs from .fig file. Pass `[]` if the tree has no path data. */
  readonly blobs: readonly FigBlob[];
  /** Image lookup map. Pass `new Map()` if no IMAGE paints are present. */
  readonly images: ReadonlyMap<string, FigPackageImage>;
  /** Canvas size. */
  readonly canvasSize: { width: number; height: number };
  /** World-space region to render into the output canvas. */
  readonly viewport: { x: number; y: number; width: number; height: number };
  /** Source document object reference for renderer resource invalidation. */
  readonly sourceDocumentReference: object;
  /** Monotonic source document revision used by renderer resource caches. */
  readonly sourceRevision: number;
  /** Symbol resolver for INSTANCE resolution. */
  readonly symbolResolver: SymbolResolver;
  /** Parent/child view over the Kiwi document. */
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  /** Whether to include nodes with `visible: false`. */
  readonly showHiddenNodes: boolean;
  /**
   * Style registry for per-path style overrides (vectorData
   * styleOverrideTable → styleIdForFill/styleIdForStrokeFill resolution).
   * Pass `EMPTY_FIG_STYLE_REGISTRY` when the tree carries no shared styles.
   */
  readonly styleRegistry: FigStyleRegistry;
  /**
   * Mutable array for warnings emitted during construction (missing
   * INSTANCE symbols, unknown node types, etc.). Pass a fresh `[]` to
   * collect, or a shared array to aggregate across multiple builds.
   */
  readonly warnings: string[];
  /**
   * Optional preloaded font resolver for converting line text to glyph
   * outlines. Pass `undefined` when the caller has no synchronous font cache.
   */
  readonly textFontResolver: TextFontResolver | undefined;
  /** Source FigNodes whose cached SceneNodes must not be reused for this build. */
  readonly cacheInvalidatedSources?: WeakSet<FigNode>;
};

/**
 * Internal build context for Kiwi FigNode rendering.
 */
type BuildContext = {
  readonly blobs: readonly FigBlob[];
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly symbolResolver: SymbolResolver;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  readonly styleRegistry: FigStyleRegistry;
  readonly showHiddenNodes: boolean;
  readonly warnings: string[];
  readonly textFontResolver: TextFontResolver | undefined;
  readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  readonly previousCache?: SceneGraphBuildCache;
  readonly cacheInvalidatedSources?: WeakSet<FigNode>;
  readonly nextNodesBySource: WeakMap<FigNode, SceneNode>;
  /**
   * Identity set of render-surface root FigNodes. It starts with the
   * top-level nodes passed to `buildSceneGraph`; resolved INSTANCE
   * roots are added as SymbolResolver materializes them. Root geometry
   * consumes Kiwi's authored smoothed path data, while ordinary nested
   * FRAME / RECT children with non-zero `cornerSmoothing` still emit
   * as `<rect rx>`.
   */
  readonly exportRoots: WeakSet<FigNode>;
  nodeCounter: number;
};

export type SceneGraphBuildCache = {
  readonly nodesBySource: WeakMap<FigNode, SceneNode>;
  readonly root: GroupNode;
};

export type BuildSceneGraphResult = {
  readonly sceneGraph: SceneGraph;
  readonly cache: SceneGraphBuildCache;
};

// =============================================================================
// Node Type & ID functions
// =============================================================================

/**
 * Generate a SceneNodeId from a FigNode.
 *
 * Kiwi node GUID is the document identity SoT. Scene graph ids are derived
 * from that GUID only; a source node without GUID is an invalid render input.
 */
function getNodeId(node: FigNode): SceneNodeId {
  if (node.guid === undefined) {
    throw new Error(`Cannot build scene graph for node "${node.name ?? "(unnamed)"}" without Kiwi guid.`);
  }
  return createNodeId(guidToString(node.guid));
}

const IDENTITY: AffineMatrix = IDENTITY_MATRIX;

function requireNodeSize(node: FigNode, operationName: string): NonNullable<FigNode["size"]> {
  const size = node.size;
  if (size === undefined) {
    throw new Error(`${operationName}: Kiwi node "${node.name ?? "(unnamed)"}" is missing size`);
  }
  return size;
}

// =============================================================================
// Node Builders
// =============================================================================

function resolveGroupClipShape(node: FigNode, ctx: BuildContext): ClipShape | undefined {
  const contours = decodeGeometryToContours(node.fillGeometry, ctx.blobs);
  if (contours.length === 0) {
    return undefined;
  }
  return { type: "path", contours };
}

function buildGroupNode(node: FigNode, ctx: BuildContext, children: readonly SceneNode[]): GroupNode {
  return {
    type: "group",
    id: getNodeId(node),
    name: node.name,
    transform: convertKiwiTransform(node.transform),
    opacity: node.opacity ?? 1,
    visible: node.visible ?? true,
    effects: convertEffectsToScene(resolveNodeEffects(node, ctx)),
    blendMode: convertFigmaNodeBlendMode(node.blendMode),
    clip: resolveGroupClipShape(node, ctx),
    children,
  };
}

function buildFrameNode(node: FigNode, ctx: BuildContext, children: readonly SceneNode[]): FrameNode {
  const size = requireNodeSize(node, "buildFrameNode");
  const cornerRadius = extractKiwiCornerRadius(node);
  const cornerSmoothing = resolveCornerSmoothing(node, ctx);
  const clipsContent = resolveKiwiClipsContent(node);
  const fills = convertPaintsToFills(resolveFrameFillPaints(node, ctx), ctx.images, paintSubject(node, framePaintField(node)));
  const effects = convertEffectsToScene(resolveNodeEffects(node, ctx));
  const surfaceShape = resolveFrameSurfaceShape(node, ctx, size, cornerRadius, cornerSmoothing, fills, effects);

  return {
    type: "frame",
    id: getNodeId(node),
    name: node.name,
    transform: convertKiwiTransform(node.transform),
    opacity: node.opacity ?? 1,
    visible: node.visible ?? true,
    effects,
    blendMode: convertFigmaNodeBlendMode(node.blendMode),
    width: size.x,
    height: size.y,
    surfaceShape,
    cornerRadius,
    cornerSmoothing,
    fills,
    stroke: convertStrokeToSceneStroke(resolveNodeStrokePaints(node, node.strokePaints, ctx), node.strokeWeight, {
      strokeCap: node.strokeCap,
      strokeJoin: node.strokeJoin,
      dashPattern: resolveKiwiStrokeDashPattern(node),
      strokeAlign: node.strokeAlign,
    }),
    individualStrokeWeights: node.individualStrokeWeights,
    clipsContent,
    children,
    clip: resolveFrameClipShape(surfaceShape, clipsContent),
  };
}

function buildRectNode(node: FigNode, ctx: BuildContext): RectNode {
  const size = requireNodeSize(node, "buildRectNode");
  const cornerRadius = extractKiwiCornerRadius(node);
  const cornerSmoothing = resolveCornerSmoothing(node, ctx);
  const fills = convertPaintsToFills(resolveNodeFillPaints(node, node.fillPaints, ctx), ctx.images, paintSubject(node, "fillPaints"));
  const effects = convertEffectsToScene(resolveNodeEffects(node, ctx));

  return {
    type: "rect",
    id: getNodeId(node),
    name: node.name,
    transform: convertKiwiTransform(node.transform),
    opacity: node.opacity ?? 1,
    visible: node.visible ?? true,
    effects,
    blendMode: convertFigmaNodeBlendMode(node.blendMode),
    width: size.x,
    height: size.y,
    cornerRadius,
    cornerSmoothing,
    fills,
    stroke: convertStrokeToSceneStroke(resolveNodeStrokePaints(node, node.strokePaints, ctx), node.strokeWeight, {
      strokeCap: node.strokeCap,
      strokeJoin: node.strokeJoin,
      dashPattern: resolveKiwiStrokeDashPattern(node),
      strokeAlign: node.strokeAlign,
    }),
    individualStrokeWeights: node.individualStrokeWeights,
  };
}

/**
 * Pick up Figma's `cornerSmoothing` on export-surface nodes. Figma's
 * SVG exporter applies smoothing to the exported root and to the
 * resolved INSTANCE root returned by SymbolResolver. Ordinary nested
 * single-paint FRAME/RECTANGLE children with non-zero `cornerSmoothing`
 * still emit as sharp `<rect rx>` so the SVG bytes match Figma's
 * output exactly. Without this gate, applying smoothing universally
 * over-darkens the AA at every inner-frame corner (calibration:
 * Feature cell regressed 0.00% -> 0.01%).
 *
 * Additionally, the SVG exporter falls back to a sharp `<rect rx>` even
 * on the export-root when the node carries a visible effect
 * (DROP_SHADOW / INNER_SHADOW / FOREGROUND_BLUR / BACKGROUND_BLUR). Figma
 * wraps the content in `<g filter="url(...)">` and emits the fill plus
 * its `<clipPath>` companion as a sharp `<rect>` regardless of the
 * source cornerSmoothing — the pre-computed `fillGeometry` blob still
 * carries the smoothed path, so this is a SVG-exporter quirk rather
 * than missing source geometry. Calibration: Event Card (cs=0.6,
 * DROP_SHADOW) emits `<rect x="12" y="8" width="362" height="296"
 * rx="20"/>` while Event Details Card (same cs=0.6, no effects) emits
 * the smoothed `M0 38.4C0 24.9587...` path.
 *
 * Returns `undefined` for the common case so the field stays absent
 * from the scene-graph and callers can short-circuit on the
 * quarter-circle path.
 */
function resolveCornerSmoothing(node: FigNode, ctx: BuildContext): number | undefined {
  if (!ctx.exportRoots.has(node)) { return undefined; }
  const s = node.cornerSmoothing;
  if (typeof s !== "number" || s <= 0) { return undefined; }
  if (hasVisibleEffect(node)) { return undefined; }
  return s;
}

function hasVisibleEffect(node: FigNode): boolean {
  const effects = node.effects;
  if (!Array.isArray(effects)) { return false; }
  for (const e of effects) {
    if (!e) { continue; }
    if (e.visible === false) { continue; }
    return true;
  }
  return false;
}

function hasFigmaBlurEffect(effects: ReadonlyArray<SceneNode["effects"][number]>): boolean {
  return effects.some((effect) => effect.type === "background-blur" || effect.type === "layer-blur");
}

function kiwiSurfaceGeometryIsAuthoritative(
  fills: readonly Fill[],
  effects: ReadonlyArray<SceneNode["effects"][number]>,
): boolean {
  return fills.length > 1 || hasFigmaBlurEffect(effects);
}

function buildEllipseNode(node: FigNode, ctx: BuildContext): EllipseNode {
  const size = requireNodeSize(node, "buildEllipseNode");

  return {
    type: "ellipse",
    id: getNodeId(node),
    name: node.name,
    transform: convertKiwiTransform(node.transform),
    opacity: node.opacity ?? 1,
    visible: node.visible ?? true,
    effects: convertEffectsToScene(resolveNodeEffects(node, ctx)),
    blendMode: convertFigmaNodeBlendMode(node.blendMode),
    cx: size.x / 2,
    cy: size.y / 2,
    rx: size.x / 2,
    ry: size.y / 2,
    fills: convertPaintsToFills(resolveNodeFillPaints(node, node.fillPaints, ctx), ctx.images, paintSubject(node, "fillPaints")),
    stroke: convertStrokeToSceneStroke(resolveNodeStrokePaints(node, node.strokePaints, ctx), node.strokeWeight, {
      strokeCap: node.strokeCap,
      strokeJoin: node.strokeJoin,
      dashPattern: resolveKiwiStrokeDashPattern(node),
      strokeAlign: node.strokeAlign,
    }),
    arcData: extractArcData(node),
  };
}

/**
 * Extract arc data from an ellipse node (partial arcs and donuts).
 *
 * When a `fillGeometry` (or `strokeGeometry`) blob is present it wins
 * over `arcData` — the blob is the SoT for the node's painted shape,
 * mirroring Figma's own SVG exporter which writes the blob path and
 * ignores `arcData` even when both are set. Without this gate, an
 * ellipse with a "full circle" blob plus stale `arcData` would render
 * as a pie slice while Figma's export shows a full ellipse.
 */
function extractArcData(node: FigNode): ArcData | undefined {
  const arcData = node.arcData;
  if (!arcData) { return undefined; }
  if (hasKiwiShapeGeometry(node)) { return undefined; }
  const startingAngle = arcData.startingAngle ?? 0;
  const endingAngle = arcData.endingAngle ?? Math.PI * 2;
  const innerRadius = arcData.innerRadius ?? 0;
  // Full circle with no hole = default ellipse, no arcData needed
  if (Math.abs(endingAngle - startingAngle - Math.PI * 2) < 1e-6 && innerRadius === 0) {
    return undefined;
  }
  return { startingAngle, endingAngle, innerRadius };
}

/**
 * Synthesize contours from parametric shape properties when no
 * pre-computed geometry blobs exist (e.g., builder-generated documents).
 */
function synthesizeContours(node: FigNode): DecodedContour[] {
  const typeName = getNodeType(node);
  const w = node.size?.x ?? 0;
  const h = node.size?.y ?? 0;

  switch (typeName) {
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return [generateRectContour(w, h, extractKiwiCornerRadius(node))];
    case "ELLIPSE":
      return [generateEllipseContour(w, h)];
    case "STAR":
      return [generateStarContour({
        width: w,
        height: h,
        // Kiwi schema field is `count`; `pointCount` is the legacy
        // alias kept on the type for builder compatibility. Real
        // Figma exports always populate `count`. The fallback to
        // `pointCount` keeps any hand-rolled FigNode that wrote to
        // the alias working until it's migrated.
        pointCount: node.count ?? node.pointCount ?? 5,
        // starInnerScale (newer format) takes precedence over starInnerRadius
        innerRadiusRatio: node.starInnerScale ?? node.starInnerRadius ?? 0.382,
      })];
    case "REGULAR_POLYGON":
      // Same `count` vs `pointCount` priority as STAR — Figma's wire
      // format populates `count`; the alias is only there for
      // backwards compatibility.
      return [generatePolygonContour(w, h, node.count ?? node.pointCount ?? 3)];
    case "LINE":
      return [generateLineContour(w)];
    default:
      return [];
  }
}

function hasKiwiShapeGeometry(node: FigNode): boolean {
  return (
    (node.fillGeometry !== undefined && node.fillGeometry.length > 0) ||
    (node.strokeGeometry !== undefined && node.strokeGeometry.length > 0)
  );
}

function hasKiwiVectorPaths(node: FigNode): boolean {
  return node.vectorPaths !== undefined && node.vectorPaths.length > 0;
}

function shouldUseParametricSmoothedSurface(
  node: FigNode,
  ctx: BuildContext,
  fills: readonly Fill[],
  effects: ReadonlyArray<SceneNode["effects"][number]>,
): boolean {
  const s = node.cornerSmoothing;
  if (typeof s !== "number" || s <= 0) { return false; }
  if (kiwiSurfaceGeometryIsAuthoritative(fills, effects)) { return false; }
  return resolveCornerSmoothing(node, ctx) === undefined;
}

function shouldUseParametricRoundedRectangle(node: FigNode, ctx: BuildContext): boolean {
  if (getNodeType(node) !== "ROUNDED_RECTANGLE") { return false; }
  const fills = convertPaintsToFills(resolveNodeFillPaints(node, node.fillPaints, ctx), ctx.images, paintSubject(node, "fillPaints"));
  const effects = convertEffectsToScene(resolveNodeEffects(node, ctx));
  return shouldUseParametricSmoothedSurface(node, ctx, fills, effects);
}

/**
 * Resolve the effective fill paints for a vector per-path style override entry.
 *
 * Delegates to the styled-paint SoT: registry wins when
 * `styleIdForFill` resolves; otherwise the entry's inline `fillPaints`
 * is the SoT. An empty inline list means the entry authors no paint.
 */
function resolveOverrideEntryPaints(
  entry: {
    readonly fillPaints?: readonly FigPaint[];
    readonly styleIdForFill?: {
      readonly guid?: { readonly sessionID: number; readonly localID: number };
      readonly assetRef?: { readonly key: string };
    };
  },
  ctx: BuildContext,
): readonly FigPaint[] | undefined {
  const resolved = resolveStyledPaint(entry.styleIdForFill, entry.fillPaints, ctx.styleRegistry, {
    variableModeBySetMap: ctx.variableModeBySetMap,
  });
  if (resolved && resolved.length > 0) { return resolved; }
  return undefined;
}

/**
 * Apply per-path style overrides from vectorData.styleOverrideTable.
 * Maps each contour's geometryStyleId to a fill override.
 *
 * Resolves both inline fillPaints and styleIdForFill references
 * (via style registry) — matching the old SVG renderer's behavior.
 */
function applyStyleOverrides(
  contours: readonly DecodedContour[],
  node: FigNode,
  ctx: BuildContext,
): PathContour[] {
  const overrideTable = node.vectorData?.styleOverrideTable;

  if (!overrideTable || overrideTable.length === 0) {
    return stripGeometryStyleIds(contours);
  }

  const overrideMap = new Map<number, Fill>();
  for (const entry of overrideTable) {
    const paints = resolveOverrideEntryPaints(entry, ctx);
    if (paints === undefined) {
      continue;
    }
    const fills = convertPaintsToFills(paints, ctx.images, paintSubject(node, "vectorData.styleOverrideTable"));
    if (fills.length === 0) {
      continue;
    }
    overrideMap.set(entry.styleID, fills[fills.length - 1]);
  }

  return contours.map(({ geometryStyleId, ...rest }) => {
    if (geometryStyleId !== undefined && overrideMap.has(geometryStyleId)) {
      return { ...rest, fillOverride: overrideMap.get(geometryStyleId)! };
    }
    return rest;
  });
}

function stripGeometryStyleIds(contours: readonly DecodedContour[]): PathContour[] {
  return contours.map(({ geometryStyleId: _geometryStyleId, ...rest }) => rest);
}

/**
 * Translate every path command's y coordinate by `dy`. The shift is
 * applied in the contour's local coordinate space — when the contour
 * is later rendered through a rotation transform, the shift rotates
 * with it. Used for LINE nodes so the centerline lands at
 * `m12 - strokeWeight/2` to match Figma's SVG export convention.
 */
function shiftContoursY(contours: readonly DecodedContour[], dy: number): DecodedContour[] {
  return contours.map((contour) => ({
    ...contour,
    commands: contour.commands.map((cmd) => shiftPathCommandY(cmd, dy)),
  }));
}

function shiftPathCommandY(cmd: PathCommand, dy: number): PathCommand {
  switch (cmd.type) {
    case "M":
    case "L":
      return { ...cmd, y: cmd.y + dy };
    case "C":
      return { ...cmd, y1: cmd.y1 + dy, y2: cmd.y2 + dy, y: cmd.y + dy };
    case "Q":
      return { ...cmd, y1: cmd.y1 + dy, y: cmd.y + dy };
    case "A":
      return { ...cmd, y: cmd.y + dy };
    case "Z":
      return cmd;
  }
}

function reconstructThinCenterline(
  contours: Parameters<typeof reconstructStrokeCenterline>[0],
  isStrokeGeometry: boolean,
  strokeAlign: FigNode["strokeAlign"],
  scalarWeight: number,
): ReturnType<typeof reconstructStrokeCenterline> {
  const align = kiwiEnumName(strokeAlign, "FigNode.strokeAlign");
  if (!isStrokeGeometry || align !== "CENTER" || scalarWeight <= 0 || scalarWeight > 1.5) {
    return undefined;
  }
  return reconstructStrokeCenterline(contours, scalarWeight);
}

function resolveVectorStrokeContours(
  strokeGeometryContours: readonly DecodedContour[],
  contoursAreStrokeGeometry: boolean,
  reconstructedStrokeGeometry: boolean,
): readonly PathContour[] | undefined {
  if (strokeGeometryContours.length === 0) {
    return undefined;
  }
  if (contoursAreStrokeGeometry || reconstructedStrokeGeometry) {
    return undefined;
  }
  return stripGeometryStyleIds(strokeGeometryContours);
}

function buildVectorNode(node: FigNode, ctx: BuildContext): PathNode {
  const vectorPaths = node.vectorPaths;

  const contoursRef = { value: convertVectorPathsToContours(vectorPaths) };
  const strokeGeometryContours = decodeGeometryToContours(node.strokeGeometry, ctx.blobs);
  const isStrokeGeometryRef = { value: false };
  if (contoursRef.value.length === 0) {
    contoursRef.value = decodeGeometryToContours(node.fillGeometry, ctx.blobs);
  }
  if (contoursRef.value.length === 0) {
    contoursRef.value = strokeGeometryContours;
    isStrokeGeometryRef.value = contoursRef.value.length > 0;
  }

  // Last resort: synthesize geometry from parametric shape definition
  if (contoursRef.value.length === 0) {
    contoursRef.value = synthesizeContours(node);
  }

  // For thin (≈≤1.5px) center-aligned strokes the pre-expanded outline
  // rasterizes with subtly different antialiasing than a centerline stroke.
  // Figma's SVG exporter emits the centerline directly, so we reverse the
  // expansion when the strokeGeometry matches the documented thin-stroke
  // pattern. Falls back to fill-the-outline when reconstruction fails.
  const scalarWeight = resolveScalarStrokeWeight(node.strokeWeight);
  const reconstructedRef = { value: false };
  const centerline = reconstructThinCenterline(contoursRef.value, isStrokeGeometryRef.value, node.strokeAlign, scalarWeight);
  if (centerline !== undefined) {
    contoursRef.value = centerline;
    reconstructedRef.value = true;
  }

  // LINE nodes have a Figma-specific position convention: the node's
  // `transform.m12` is the BOTTOM of the stroke envelope (largest y in
  // y-down coords), not the centerline. The centerline therefore sits
  // at `m12 - strokeWeight/2`. To match Figma's SVG export of LINE
  // (`<line y1=y2=centerline ...>`), shift the local-coord contour up
  // by `strokeWeight/2` — the node transform will rotate this shift
  // into the perpendicular-to-line direction in render space.
  const isLine = getNodeType(node) === "LINE";
  if (isLine && scalarWeight > 0) {
    contoursRef.value = shiftContoursY(contoursRef.value, -scalarWeight / 2);
  }

  // Apply per-path style overrides from vectorData
  const resolvedContours = applyStyleOverrides(contoursRef.value, node, ctx);

  // strokeGeometry is Figma's pre-expanded outline of a stroke.
  // It should be *filled* with the stroke colour, not stroked again —
  // unless we successfully reconstructed the centerline above, in which
  // case the strokeGeometry is gone and we render the centerline as a
  // proper stroke.
  //
  // LINE nodes are the exception: a LINE has no fill region, so its
  // `strokeGeometry` carries the centerline path (single M..L), not a
  // pre-expanded outline. Filling that open path renders zero pixels.
  // Figma's own SVG exporter emits `<line ... stroke=... stroke-width=...>`
  // for LINE — match that by routing the centerline through the stroke
  // pipeline instead of the fill pipeline.
  const treatAsFill = isStrokeGeometryRef.value && !reconstructedRef.value && !isLine;
  const resolvedFillPaints = resolveNodeFillPaints(node, node.fillPaints, ctx);
  const resolvedStrokePaints = resolveNodeStrokePaints(node, node.strokePaints, ctx);
  const fills = resolveVectorFills(
    reconstructedRef.value,
    treatAsFill,
    resolvedStrokePaints,
    resolvedFillPaints,
    ctx.images,
    paintSubject(node, treatAsFill ? "strokePaints" : "fillPaints"),
  );
  const stroke = resolveVectorStroke(treatAsFill, resolvedStrokePaints, node.strokeWeight, node.strokeCap, node.strokeJoin, resolveKiwiStrokeDashPattern(node), node.strokeAlign);
  const strokeContours = resolveVectorStrokeContours(
    strokeGeometryContours,
    isStrokeGeometryRef.value,
    reconstructedRef.value,
  );

  const size = node.size;
  // Carry source rect-shape parameters through to PathNode so the
  // stroke resolver can route INSIDE/OUTSIDE-aligned smoothed strokes
  // through `kind: "rect"` strokeShape. See PathNode docs in
  // @higma-document-renderers/fig/scene-graph/types and the resolve.ts
  // strokeShape branch.
  const cornerRadius = extractKiwiCornerRadius(node);
  const cornerSmoothingRaw = node.cornerSmoothing;
  const cornerSmoothing = typeof cornerSmoothingRaw === "number" && cornerSmoothingRaw > 0 ? cornerSmoothingRaw : undefined;
  return {
    type: "path",
    id: getNodeId(node),
    name: node.name,
    transform: convertKiwiTransform(node.transform),
    opacity: node.opacity ?? 1,
    visible: node.visible ?? true,
    effects: convertEffectsToScene(resolveNodeEffects(node, ctx)),
    blendMode: convertFigmaNodeBlendMode(node.blendMode),
    contours: resolvedContours,
    strokeContours,
    fills,
    stroke,
    width: size !== undefined && size.x > 0 ? size.x : undefined,
    height: size !== undefined && size.y > 0 ? size.y : undefined,
    cornerRadius,
    cornerSmoothing,
  };
}

function extractEnumName(value: unknown): string | undefined {
  return kiwiEnumName(value, "Kiwi text enum");
}

function resolveTextAutoResize(rawAutoResize: unknown): TextAutoResize {
  const name = extractEnumName(rawAutoResize);
  if (name === "NONE" || name === "WIDTH_AND_HEIGHT" || name === "HEIGHT" || name === "TRUNCATE") {
    return name;
  }
  // Kiwi binary's "omitted field = first enum value" semantic.
  // Schema declares TextAutoResize starting with NONE=0, so a missing
  // textAutoResize must read back as NONE — "fixed bounds, wrap inside
  // the authored box". The previous WIDTH_AND_HEIGHT default meant
  // "grow to content, no wrap" and silently inverted the box behaviour
  // wherever the field was omitted (e.g. CPA-driven text whose
  // derivedTextData was discarded slipped through here and stopped
  // wrapping).
  return TEXT_AUTO_RESIZE_OMITTED_DEFAULT;
}

function buildTextNode(node: FigNode, ctx: BuildContext): TextNode {
  const textData = convertTextNode(node, {
    blobs: ctx.blobs,
    fontResolver: ctx.textFontResolver,
    styleRegistry: ctx.styleRegistry,
    variableModeBySetMap: ctx.variableModeBySetMap,
  });

  // Resolve textAutoResize from domain textData
  const rawAutoResize = node.textData?.textAutoResize;
  const textAutoResize = resolveTextAutoResize(rawAutoResize);

  return {
    type: "text",
    id: getNodeId(node),
    name: node.name,
    transform: convertKiwiTransform(node.transform),
    opacity: node.opacity ?? 1,
    visible: node.visible ?? true,
    effects: convertEffectsToScene(resolveNodeEffects(node, ctx)),
    // Figma's exporter does not project TEXT-level blendMode onto the
    // text wrapper. Text paint blend remains represented by
    // textData.fills/runs, which is the paint SoT for glyph rendering.
    blendMode: undefined,
    width: node.size?.x ?? 0,
    height: node.size?.y ?? 0,
    textAutoResize,
    textTruncation: textData.truncation?.mode ?? extractEnumName(node.textData?.textTruncation),
    textTruncationClipHeight: textData.truncation?.maxHeight,
    leadingTrim: extractEnumName(node.textData?.leadingTrim),
    hyperlink: node.textData?.hyperlink?.url,
    glyphContours: textData.glyphContours,
    decorationContours: textData.decorationContours,
    runs: textData.runs,
    fills: textData.fills,
    textLineLayout: textData.textLineLayout,
  };
}

// =============================================================================
// Boolean Operation Computation
// =============================================================================

/**
 * Apply a 2x3 affine transform to an SVG path d-string by transforming coordinates.
 */
function applyTransformToPathD(d: string, m: AffineMatrix): string {
  if (m.m00 === 1 && m.m01 === 0 && m.m02 === 0 && m.m10 === 0 && m.m11 === 1 && m.m12 === 0) {
    return d;
  }
  // Use simple regex-based transform for M/L/C/Q/Z commands
  return d.replace(/([MLCQZ])\s*([^MLCQZ]*)/gi, (_, cmd: string, args: string) => {
    if (cmd.toUpperCase() === "Z") { return "Z"; }
    const nums = args.trim().split(/[\s,]+/).map(Number);
    const transformed: number[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      if (i + 1 < nums.length) {
        const x = nums[i], y = nums[i + 1];
        transformed.push(m.m00 * x + m.m01 * y + m.m02);
        transformed.push(m.m10 * x + m.m11 * y + m.m12);
      }
    }
    return `${cmd}${transformed.join(" ")}`;
  });
}

/**
 * Collect path d-strings from children of a BOOLEAN_OPERATION node,
 * transforming each to the parent's coordinate system.
 */
function collectChildPathsForBoolean(
  children: readonly FigNode[],
  ctx: BuildContext,
): BooleanPathInput[] {
  const result: BooleanPathInput[] = [];

  for (const child of children) {
    if (child.visible === false && !ctx.showHiddenNodes) {
      continue;
    }

    const typeName = getNodeType(child);
    const childTransform = convertKiwiTransform(child.transform);

    // Nested BOOLEAN_OPERATION: recurse
    if (typeName === "BOOLEAN_OPERATION") {
      appendNestedBooleanResult(result, child, childTransform, ctx);
      continue;
    }

    // Extract geometry
    const contours = resolveBooleanInputContours(child, child.fillGeometry, child.strokeGeometry, ctx);

    for (const contour of contours) {
      const d = contour.commands.map((cmd) => {
        switch (cmd.type) {
          case "M": return `M${cmd.x} ${cmd.y}`;
          case "L": return `L${cmd.x} ${cmd.y}`;
          case "C": return `C${cmd.x1} ${cmd.y1} ${cmd.x2} ${cmd.y2} ${cmd.x} ${cmd.y}`;
          case "Q": return `Q${cmd.x1} ${cmd.y1} ${cmd.x} ${cmd.y}`;
          case "A": return `A${cmd.rx} ${cmd.ry} ${cmd.rotation} ${cmd.largeArc ? 1 : 0} ${cmd.sweep ? 1 : 0} ${cmd.x} ${cmd.y}`;
          case "Z": return "Z";
        }
      }).join("");

      const td = applyTransformToPathD(d, childTransform);
      result.push({ d: td, windingRule: contour.windingRule });
    }
  }

  return result;
}

function appendNestedBooleanResult(
  result: BooleanPathInput[],
  child: FigNode,
  childTransform: AffineMatrix,
  ctx: BuildContext,
): void {
  const nestedResult = computeBooleanResultFromNode(child, ctx);
  if (nestedResult === undefined) {
    return;
  }
  for (const d of nestedResult) {
    const td = applyTransformToPathD(d, childTransform);
    result.push({ d: td, windingRule: "nonzero" });
  }
}

function resolveBooleanInputContours(
  child: FigNode,
  fillGeometry: readonly FigFillGeometry[] | undefined,
  strokeGeometry: readonly FigFillGeometry[] | undefined,
  ctx: BuildContext,
): DecodedContour[] {
  const fillContours = decodeGeometryToContours(fillGeometry, ctx.blobs);
  if (fillContours.length > 0) {
    return fillContours;
  }
  const vectorContours = convertVectorPathsToContours(child.vectorPaths);
  if (vectorContours.length > 0) {
    return vectorContours;
  }
  const strokeContours = decodeGeometryToContours(strokeGeometry, ctx.blobs);
  if (strokeContours.length > 0) {
    return strokeContours;
  }
  return synthesizeContours(child);
}

/**
 * Compute boolean operation result for a BOOLEAN_OPERATION node.
 * Returns SVG path d-strings or undefined if no boolean input exists.
 * Evaluation failures are thrown so callers and tests can observe them.
 */
function computeBooleanResultFromNode(
  node: FigNode,
  ctx: BuildContext,
): readonly string[] | undefined {
  const children = ctx.childrenOf(node);
  const childPaths = collectChildPathsForBoolean(children, ctx);
  const result = evaluateBooleanPathResult(childPaths, resolveBooleanOperationType(node.booleanOperation));
  if (result.ok) {
    return result.paths;
  }
  if (result.error.reason === "NO_INPUT_PATHS") {
    return undefined;
  }
  throw new Error(`Boolean operation '${node.name}' failed: ${result.error.message}`);
}

/**
 * Build a PathNode from boolean operation result paths.
 */
function buildBooleanOperationNode(
  node: FigNode,
  ctx: BuildContext,
  resultPaths: readonly string[],
): PathNode {
  const contours: PathContour[] = resultPaths.map((d) => ({
    commands: parseSvgPathDToCommands(d),
    windingRule: "evenodd" as const,
  }));

  return {
    type: "path",
    id: getNodeId(node),
    name: node.name,
    transform: convertKiwiTransform(node.transform),
    opacity: node.opacity ?? 1,
    visible: node.visible ?? true,
    effects: convertEffectsToScene(resolveNodeEffects(node, ctx)),
    blendMode: convertFigmaNodeBlendMode(node.blendMode),
    contours,
    fills: convertPaintsToFills(resolveNodeFillPaints(node, node.fillPaints, ctx), ctx.images, paintSubject(node, "fillPaints")),
    stroke: convertStrokeToSceneStroke(resolveNodeStrokePaints(node, node.strokePaints, ctx), node.strokeWeight, {
      strokeCap: node.strokeCap,
      strokeJoin: node.strokeJoin,
      dashPattern: resolveKiwiStrokeDashPattern(node),
      strokeAlign: node.strokeAlign,
    }),
  };
}

/**
 * Parse SVG path d-string into PathCommand array for boolean results.
 */
function parseSvgPathDToCommands(d: string): PathContour["commands"][number][] {
  return parseSvgPathD(d);
}

function cacheBuiltNode<T extends SceneNode>(source: FigNode, sceneNode: T, ctx: BuildContext): T {
  ctx.nextNodesBySource.set(source, sceneNode);
  return sceneNode;
}

function withChildrenOf(ctx: BuildContext, childrenOf: (node: FigNode) => readonly FigNode[]): BuildContext {
  return { ...ctx, childrenOf };
}

function withNodeVariableModeBySetMap(ctx: BuildContext, node: FigNode): BuildContext {
  const variableModeBySetMap = mergeVariableModeBySetMap(ctx.variableModeBySetMap, node.variableModeBySetMap);
  if (variableModeBySetMap === ctx.variableModeBySetMap) {
    return ctx;
  }
  return { ...ctx, variableModeBySetMap };
}

// =============================================================================
// Recursive Builder
// =============================================================================

function buildNode(node: FigNode, ctx: BuildContext): SceneNode | null {
  const cached = ctx.previousCache?.nodesBySource.get(node);
  if (cached && !ctx.cacheInvalidatedSources?.has(node)) {
    ctx.nextNodesBySource.set(node, cached);
    return cached;
  }

  // Skip hidden nodes unless explicitly shown
  if (node.visible === false && !ctx.showHiddenNodes) {
    return null;
  }

  const nodeCtx = withNodeVariableModeBySetMap(ctx, node);
  const typeName = getNodeType(node);
  const children = nodeCtx.childrenOf(node);

  switch (typeName) {
    case "DOCUMENT":
    case "CANVAS": {
      const childNodes = buildChildren(children, nodeCtx);
      return cacheBuiltNode(node, buildGroupNode(node, nodeCtx, childNodes), ctx);
    }

    case "FRAME":
    case "SECTION":
    case "SLIDE":
    case "SYMBOL": {
      const layoutResolved = resolveAuthoredAutoLayoutFrameStretch(node, children);
      const childNodes = buildChildren(layoutResolved.children, nodeCtx);
      return cacheBuiltNode(node, buildFrameNode(layoutResolved.parent, nodeCtx, childNodes), ctx);
    }

    case "INSTANCE": {
      const resolved = nodeCtx.symbolResolver.resolveInstance(node, {
        variableModeBySetMap: nodeCtx.variableModeBySetMap,
      });
      nodeCtx.exportRoots.add(resolved.node);
      const resolvedCtx = withChildrenOf(nodeCtx, nodeCtx.symbolResolver.childrenOfResolvedNode);
      const childNodes = buildChildren(resolved.children, resolvedCtx);
      return cacheBuiltNode(node, buildFrameNode(resolved.node, nodeCtx, childNodes), ctx);
    }

    case "GROUP": {
      const childNodes = buildChildren(children, nodeCtx);
      return cacheBuiltNode(node, buildGroupNode(node, nodeCtx, childNodes), ctx);
    }

    case "BOOLEAN_OPERATION": {
      // 1. Pre-computed fillGeometry (set by Figma export)
      const hasMergedGeometry =
        (node.fillGeometry !== undefined && node.fillGeometry.length > 0) ||
        (node.strokeGeometry !== undefined && node.strokeGeometry.length > 0);
      if (hasMergedGeometry) {
        return cacheBuiltNode(node, buildVectorNode(node, nodeCtx), ctx);
      }
      // 2. Compute boolean operation from child geometries using path-bool
      const resultPaths = computeBooleanResultFromNode(node, nodeCtx);
      if (resultPaths && resultPaths.length > 0) {
        return cacheBuiltNode(node, buildBooleanOperationNode(node, nodeCtx, resultPaths), ctx);
      }
      throw new Error(`Boolean operation  has neither merged geometry nor computable child paths`);
    }

    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      if (hasKiwiVectorPaths(node) || (hasKiwiShapeGeometry(node) && !shouldUseParametricRoundedRectangle(node, nodeCtx))) {
        return cacheBuiltNode(node, buildVectorNode(node, nodeCtx), ctx);
      }
      return cacheBuiltNode(node, buildRectNode(node, nodeCtx), ctx);

    case "ELLIPSE":
      if (hasKiwiVectorPaths(node)) {
        return cacheBuiltNode(node, buildVectorNode(node, nodeCtx), ctx);
      }
      return cacheBuiltNode(node, buildEllipseNode(node, nodeCtx), ctx);

    case "VECTOR":
    case "LINE":
    case "STAR":
    case "REGULAR_POLYGON":
      return cacheBuiltNode(node, buildVectorNode(node, nodeCtx), ctx);

    case "TEXT":
      return cacheBuiltNode(node, buildTextNode(node, nodeCtx), ctx);

    default:
      return buildUnknownNodeTypeGroup(node, children, nodeCtx);
  }
}

function buildUnknownNodeTypeGroup(node: FigNode, children: readonly FigNode[], ctx: BuildContext): SceneNode | null {
  if (children.length === 0) {
    return null;
  }
  const childNodes = buildChildren(children, ctx);
  return cacheBuiltNode(node, buildGroupNode(node, ctx, childNodes), ctx);
}

type MaskBuildState = {
  activeMaskContent: SceneNode | null;
  activeMaskId: SceneNodeId | null;
  activeMaskType: FigMaskType | null;
  maskedChildren: SceneNode[];
};

/**
 * Build scene nodes from a list of FigNode children.
 *
 * Handles mask processing in a single pass: when a child has `mask: true`,
 * it becomes an SVG mask for all subsequent siblings until the next mask
 * node or the end of the list. Masked siblings are wrapped in a GroupNode
 * with the `mask` field set.
 */
function buildChildren(children: readonly FigNode[], ctx: BuildContext): SceneNode[] {
  const result: SceneNode[] = [];

  const maskState: MaskBuildState = {
    activeMaskContent: null,
    activeMaskId: null,
    activeMaskType: null,
    maskedChildren: [],
  };

  for (const child of children) {
    if (child.visible === false && !ctx.showHiddenNodes) {
      continue;
    }

    if (isMaskNode(child)) {
      flushMaskState(result, maskState, ctx);
      startMaskState(maskState, child, ctx);
      continue;
    }
    appendBuiltChild(result, maskState, buildNode(child, ctx));
  }

  flushMaskState(result, maskState, ctx);

  return result;
}

function flushMaskState(result: SceneNode[], maskState: MaskBuildState, ctx: BuildContext): void {
  const maskId = maskState.activeMaskId;
  const maskContent = maskState.activeMaskContent;
  const maskType = maskState.activeMaskType;
  if (maskId === null || maskContent === null || maskType === null || maskState.maskedChildren.length === 0) {
    return;
  }
  result.push(wrapWithMask(maskId, maskType, maskContent, maskState.maskedChildren, ctx));
  maskState.maskedChildren = [];
}

function startMaskState(maskState: MaskBuildState, child: FigNode, ctx: BuildContext): void {
  // The mask source is stored on the group as mask data only; it is not
  // appended as visible content. SVG/WebGL formatting decides how source
  // fill/stroke affect the mask shape from the same RenderTree definition.
  const maskNode = buildNode(child, ctx);
  if (maskNode === null) {
    maskState.activeMaskId = null;
    maskState.activeMaskType = null;
    maskState.activeMaskContent = null;
    return;
  }
  maskState.activeMaskId = maskNode.id;
  maskState.activeMaskType = resolveKiwiMaskType(child);
  maskState.activeMaskContent = maskNode;
}

function appendBuiltChild(result: SceneNode[], maskState: MaskBuildState, node: SceneNode | null): void {
  if (node === null) {
    return;
  }
  if (maskState.activeMaskId !== null) {
    maskState.maskedChildren.push(node);
    return;
  }
  result.push(node);
}

function sceneNodeChildrenEqual(left: readonly SceneNode[], right: readonly SceneNode[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((node, index) => node === right[index]);
}

function buildRootNode(children: readonly SceneNode[], previousCache: SceneGraphBuildCache | undefined): GroupNode {
  const previousRoot = previousCache?.root;
  if (previousRoot !== undefined && sceneNodeChildrenEqual(previousRoot.children, children)) {
    return previousRoot;
  }
  return {
    type: "group",
    id: createNodeId("root"),
    transform: IDENTITY_MATRIX,
    opacity: 1,
    visible: true,
    effects: [],
    children,
  };
}

/**
 * Wrap masked children in a GroupNode with the mask field set.
 */
function wrapWithMask(
  maskId: SceneNodeId,
  maskType: FigMaskType,
  maskContent: SceneNode,
  maskedChildren: readonly SceneNode[],
  ctx: BuildContext,
): GroupNode {
  return {
    type: "group",
    id: createNodeId(`masked-group-${ctx.nodeCounter++}`),
    rendererStructure: { kind: "mask-wrapper" },
    transform: IDENTITY,
    opacity: 1,
    visible: true,
    effects: [],
    mask: { maskId, maskType, maskContent },
    children: maskedChildren,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build a scene graph from FigNode domain objects.
 *
 * @param nodes - Root FigNode nodes to render
 * @param options - Build configuration
 * @returns Format-agnostic scene graph
 */
export function buildSceneGraph(nodes: readonly FigNode[], options: BuildSceneGraphOptions): SceneGraph {
  return buildSceneGraphWithCache(nodes, options, undefined).sceneGraph;
}

/**
 * Build a scene graph and preserve SceneNode references for unchanged
 * immutable FigNode source objects.
 */
export function buildSceneGraphWithCache(
  nodes: readonly FigNode[],
  options: BuildSceneGraphOptions,
  previousCache: SceneGraphBuildCache | undefined,
): BuildSceneGraphResult {
  const nextNodesBySource = new WeakMap<FigNode, SceneNode>();
  const exportRoots = new WeakSet<FigNode>();
  for (const root of nodes) { exportRoots.add(root); }
  const ctx: BuildContext = {
    blobs: options.blobs,
    images: options.images,
    symbolResolver: options.symbolResolver,
    childrenOf: options.childrenOf,
    styleRegistry: options.styleRegistry,
    showHiddenNodes: options.showHiddenNodes,
    warnings: options.warnings,
    textFontResolver: options.textFontResolver,
    previousCache,
    cacheInvalidatedSources: options.cacheInvalidatedSources,
    nextNodesBySource,
    exportRoots,
    nodeCounter: 0,
  };

  const children = buildChildren(nodes, ctx);

  const root = buildRootNode(children, previousCache);

  return {
    sceneGraph: {
      width: options.canvasSize.width,
      height: options.canvasSize.height,
      viewport: options.viewport,
      root,
      sourceDocumentReference: options.sourceDocumentReference,
      version: options.sourceRevision,
    },
    cache: { nodesBySource: nextNodesBySource, root },
  };
}
