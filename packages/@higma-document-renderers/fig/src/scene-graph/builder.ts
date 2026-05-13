/**
 * @file Scene graph builder
 *
 * Converts a FigDesignNode tree (domain objects) to a format-agnostic scene graph.
 * The resulting scene graph can be consumed by both SVG and WebGL backends.
 *
 * This builder accepts FigDesignNode directly — no intermediate conversion
 * from the raw parser type (FigNode) is needed. This ensures the renderer
 * stays in sync with the domain model by construction.
 */

import type { FigDesignNode, MutableFigDesignNode, FigStyleRegistry } from "@higma-document-models/fig/domain";
import type { FigFillGeometry, FigPaint } from "@higma-document-models/fig/types";
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import { resolveStyledPaint } from "@higma-document-models/fig/symbols";
import { IDENTITY_MATRIX } from "@higma-document-models/fig/matrix";
import {
  extractBaseProps, extractSizeProps, extractPaintProps, extractGeometryProps, extractEffectsProps, } from "@higma-document-models/fig/symbols/extract";
import { resolveAutoLayoutFrame, type PrimaryAxisChild, type PrimaryAxisParent } from "@higma-document-models/fig/symbols/autolayout-primary";
import type {
  SceneGraph, SceneNode, GroupNode, FrameNode, RectNode, EllipseNode, PathNode, TextNode, SceneNodeId } from "@higma-document-models/fig/scene-graph";
import { createNodeId } from "@higma-document-models/fig/scene-graph";
import { convertPaintsToFills } from "./convert/fill";
import { convertStrokeToSceneStroke } from "./convert/stroke";
import { convertEffectsToScene } from "./convert/effects";
import { decodeGeometryToContours, convertVectorPathsToContours, type DecodedContour } from "./convert/path";
import { reconstructStrokeCenterline } from "@higma-primitives/path";
import {
  generateEllipseContour, generateLineContour, generatePolygonContour, generateRectContour, generateStarContour, parseSvgPathD, } from "@higma-primitives/path";
import { convertTextNode } from "./convert/text";
import type { Fill, PathContour, BlendMode, ArcData } from "@higma-document-models/fig/scene-graph";
import { convertFigmaBlendMode } from "@higma-document-models/fig/scene-graph/blend-mode";
import type { TextAutoResize } from "@higma-document-models/fig/scene-graph";
import type { TextFontResolver } from "../text/rendering";
import { evaluateBooleanPathResult, type BooleanPathInput } from "@higma-primitives/path";
import { resolveBooleanOperationType } from "@higma-document-models/fig/boolean-operation";
import {
  convertDesignTransform,
  deepCloneDesignNode,
  extractDesignCornerRadius,
  getDesignNodeTypeName,
  resolveDesignClipsContent,
} from "@higma-document-models/fig/symbols/design-node-helpers";
import { resolveDesignInstance } from "@higma-document-models/fig/symbols/design-instance-resolver";
import type { AffineMatrix } from "@higma-primitives/path";

function convertBlendMode(node: FigDesignNode): BlendMode | undefined {
  return convertFigmaBlendMode(node.blendMode);
}

// =============================================================================
// Mask Detection
// =============================================================================

/**
 * Check if a FigDesignNode acts as a mask for subsequent siblings.
 * Figma's mask property is stored on the raw node data.
 */
function isMaskNode(node: FigDesignNode): boolean {
  return node.mask === true;
}

/** Select fill paints based on whether stroke geometry is being used */
function selectPaintsForFills(
  isStrokeGeometry: boolean,
  paints: { strokePaints: readonly FigPaint[] | undefined; fillPaints: readonly FigPaint[] | undefined },
  images: ReadonlyMap<string, FigPackageImage>
): Fill[] {
  const source = isStrokeGeometry ? paints.strokePaints : paints.fillPaints;
  return convertPaintsToFills(source, images);
}

function resolveScalarStrokeWeight(strokeWeight: FigDesignNode["strokeWeight"] | undefined): number {
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
): Fill[] {
  if (reconstructed) { return []; }
  return selectPaintsForFills(treatAsFill, { strokePaints, fillPaints }, images);
}

function resolveVectorStroke(
  treatAsFill: boolean,
  strokePaints: readonly FigPaint[] | undefined,
  strokeWeight: FigDesignNode["strokeWeight"] | undefined,
  strokeCap: FigDesignNode["strokeCap"],
  strokeJoin: FigDesignNode["strokeJoin"],
  strokeDashes: FigDesignNode["strokeDashes"],
  strokeAlign: FigDesignNode["strokeAlign"],
) {
  if (treatAsFill) { return undefined; }
  return convertStrokeToSceneStroke(strokePaints, strokeWeight, { strokeCap, strokeJoin, dashPattern: strokeDashes, strokeAlign });
}

// =============================================================================
// Build Context
// =============================================================================

/**
 * Configuration for building a scene graph.
 *
 * symbolMap uses FigDesignNode (domain type) — symbol resolution operates
 * on domain objects, not raw parser types.
 */
/**
 * Configuration for `buildSceneGraph`. Every field is required: the builder
 * does not invent defaults. If an input is genuinely absent for a call
 * site (e.g. a tree without INSTANCE nodes needs no symbolMap), the caller
 * passes the explicit "empty" value (`new Map()`, `[]`, `EMPTY_FIG_STYLE_
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
  /** World-space window to render into the output canvas. */
  readonly viewport: { x: number; y: number; width: number; height: number };
  /** Symbol map for INSTANCE resolution. Pass `new Map()` when absent. */
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
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
};

/**
 * Internal build context — pure-domain. The scene-graph builder does
 * not read raw FigNode, does not translate override guid paths, and
 * does not perform GUID translation. All such work is the
 * responsibility of the domain-convert layer
 * (`@higma-document-models/fig/domain`).
 *
 * The shape is a superset of `InstanceResolveDesignContext` from
 * `@higma-document-models/fig/symbols/design-instance-resolver`, so
 * `ctx` is passed through structurally when the builder delegates
 * INSTANCE resolution.
 */
type BuildContext = {
  readonly blobs: readonly FigBlob[];
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly showHiddenNodes: boolean;
  readonly warnings: string[];
  readonly textFontResolver: TextFontResolver | undefined;
  readonly previousCache?: SceneGraphBuildCache;
  readonly nextNodesBySource: WeakMap<FigDesignNode, SceneNode>;
  nodeCounter: number;
};

export type SceneGraphBuildCache = {
  readonly nodesBySource: WeakMap<FigDesignNode, SceneNode>;
};

export type BuildSceneGraphResult = {
  readonly sceneGraph: SceneGraph;
  readonly cache: SceneGraphBuildCache;
};

// =============================================================================
// Node Type & ID helpers
// =============================================================================

/**
 * Generate a SceneNodeId from a FigDesignNode.
 *
 * FigDesignNode.id is a branded string "sessionID:localID",
 * which is already unique — use it directly as the SceneNodeId.
 */
function getNodeId(node: FigDesignNode, ctx: BuildContext): SceneNodeId {
  if (node.id) {
    return createNodeId(node.id);
  }
  return createNodeId(`node-${ctx.nodeCounter++}`);
}

const IDENTITY: AffineMatrix = IDENTITY_MATRIX;


// =============================================================================
// Node Builders
// =============================================================================

function buildGroupNode(node: FigDesignNode, ctx: BuildContext, children: readonly SceneNode[]): GroupNode {
  const base = extractBaseProps(node);
  const { effects } = extractEffectsProps(node);
  return {
    type: "group",
    id: getNodeId(node, ctx),
    name: node.name,
    transform: convertDesignTransform(base.transform),
    opacity: base.opacity,
    visible: base.visible,
    effects: convertEffectsToScene(effects),
    blendMode: convertBlendMode(node),
    children,
  };
}

function buildFrameNode(node: FigDesignNode, ctx: BuildContext, children: readonly SceneNode[]): FrameNode {
  const base = extractBaseProps(node);
  const { size } = extractSizeProps(node);
  const { fillPaints, strokePaints, strokeWeight, strokeCap, strokeJoin, strokeDashes, strokeAlign } = extractPaintProps(node);
  const { effects } = extractEffectsProps(node);
  const cornerRadius = extractDesignCornerRadius(node);
  const clipsContent = resolveDesignClipsContent(node);

  return {
    type: "frame",
    id: getNodeId(node, ctx),
    name: node.name,
    transform: convertDesignTransform(base.transform),
    opacity: base.opacity,
    visible: base.visible,
    effects: convertEffectsToScene(effects),
    blendMode: convertBlendMode(node),
    width: size.x,
    height: size.y,
    cornerRadius,
    fills: convertPaintsToFills(fillPaints, ctx.images),
    stroke: convertStrokeToSceneStroke(strokePaints, strokeWeight, { strokeCap, strokeJoin, dashPattern: strokeDashes, strokeAlign }),
    individualStrokeWeights: node.individualStrokeWeights,
    clipsContent,
    children,
    clip: clipsContent ? { type: "rect", width: size.x, height: size.y, cornerRadius } : undefined,
  };
}

function buildRectNode(node: FigDesignNode, ctx: BuildContext): RectNode {
  const base = extractBaseProps(node);
  const { size } = extractSizeProps(node);
  const { fillPaints, strokePaints, strokeWeight, strokeCap, strokeJoin, strokeDashes, strokeAlign } = extractPaintProps(node);
  const { effects } = extractEffectsProps(node);
  const cornerRadius = extractDesignCornerRadius(node);

  return {
    type: "rect",
    id: getNodeId(node, ctx),
    name: node.name,
    transform: convertDesignTransform(base.transform),
    opacity: base.opacity,
    visible: base.visible,
    effects: convertEffectsToScene(effects),
    blendMode: convertBlendMode(node),
    width: size.x,
    height: size.y,
    cornerRadius,
    fills: convertPaintsToFills(fillPaints, ctx.images),
    stroke: convertStrokeToSceneStroke(strokePaints, strokeWeight, { strokeCap, strokeJoin, dashPattern: strokeDashes, strokeAlign }),
    individualStrokeWeights: node.individualStrokeWeights,
  };
}

function buildEllipseNode(node: FigDesignNode, ctx: BuildContext): EllipseNode {
  const base = extractBaseProps(node);
  const { size } = extractSizeProps(node);
  const { fillPaints, strokePaints, strokeWeight, strokeCap, strokeJoin, strokeDashes, strokeAlign } = extractPaintProps(node);
  const { effects } = extractEffectsProps(node);

  return {
    type: "ellipse",
    id: getNodeId(node, ctx),
    name: node.name,
    transform: convertDesignTransform(base.transform),
    opacity: base.opacity,
    visible: base.visible,
    effects: convertEffectsToScene(effects),
    blendMode: convertBlendMode(node),
    cx: size.x / 2,
    cy: size.y / 2,
    rx: size.x / 2,
    ry: size.y / 2,
    fills: convertPaintsToFills(fillPaints, ctx.images),
    stroke: convertStrokeToSceneStroke(strokePaints, strokeWeight, { strokeCap, strokeJoin, dashPattern: strokeDashes, strokeAlign }),
    arcData: extractArcData(node),
  };
}

/**
 * Extract arc data from an ellipse node (partial arcs and donuts).
 */
function extractArcData(node: FigDesignNode): ArcData | undefined {
  const arcData = node.arcData;
  if (!arcData) { return undefined; }
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
function synthesizeContours(node: FigDesignNode): DecodedContour[] {
  const typeName = getDesignNodeTypeName(node);
  const w = node.size?.x ?? 0;
  const h = node.size?.y ?? 0;

  switch (typeName) {
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return [generateRectContour(w, h, extractDesignCornerRadius(node))];
    case "ELLIPSE":
      return [generateEllipseContour(w, h)];
    case "STAR":
      return [generateStarContour({
        width: w,
        height: h,
        pointCount: node.pointCount ?? 5,
        // starInnerScale (newer format) takes precedence over starInnerRadius
        innerRadiusRatio: node.starInnerScale ?? node.starInnerRadius ?? 0.382,
      })];
    case "REGULAR_POLYGON":
      return [generatePolygonContour(w, h, node.pointCount ?? 3)];
    case "LINE":
      return [generateLineContour(w)];
    default:
      return [];
  }
}

function hasRenderablePathGeometry(node: FigDesignNode): boolean {
  if (node.vectorPaths?.some((path) => path.data !== undefined && path.data.length > 0)) {
    return true;
  }
  const { fillGeometry, strokeGeometry } = extractGeometryProps(node);
  return (fillGeometry !== undefined && fillGeometry.length > 0)
    || (strokeGeometry !== undefined && strokeGeometry.length > 0);
}

function shouldRenderInteractiveSlideElementAsPath(node: FigDesignNode, children: readonly FigDesignNode[]): boolean {
  return children.length === 0 && hasRenderablePathGeometry(node);
}

/**
 * Resolve the effective fill paints for a vector per-path style override entry.
 *
 * Delegates to the styled-paint SoT: registry wins when
 * `styleIdForFill` resolves; otherwise the entry's inline `fillPaints`
 * is the SoT. An empty inline list is treated as "no paint authored
 * here, use the base fill" so it is normalised to `undefined`.
 */
function resolveOverrideEntryPaints(
  entry: {
    readonly fillPaints?: readonly FigPaint[];
    readonly styleIdForFill?: {
      readonly guid?: { readonly sessionID: number; readonly localID: number };
      readonly assetRef?: { readonly key: string };
    };
  },
  styleRegistry: FigStyleRegistry,
): readonly FigPaint[] | undefined {
  const resolved = resolveStyledPaint(entry.styleIdForFill, entry.fillPaints, styleRegistry);
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
  node: FigDesignNode,
  ctx: BuildContext,
): PathContour[] {
  const overrideTable = node.vectorData?.styleOverrideTable;

  if (!overrideTable || overrideTable.length === 0) {
    // No overrides — strip geometryStyleId from contours
    return contours.map(({ geometryStyleId: _, ...rest }) => rest);
  }

  const overrideMap = new Map<number, Fill>();
  for (const entry of overrideTable) {
    const paints = resolveOverrideEntryPaints(entry, ctx.styleRegistry);
    if (paints) {
      const fills = convertPaintsToFills(paints, ctx.images);
      if (fills.length > 0) {
        overrideMap.set(entry.styleID, fills[fills.length - 1]);
      }
    }
  }

  return contours.map(({ geometryStyleId, ...rest }) => {
    if (geometryStyleId !== undefined && overrideMap.has(geometryStyleId)) {
      return { ...rest, fillOverride: overrideMap.get(geometryStyleId)! };
    }
    return rest;
  });
}

function buildVectorNode(node: FigDesignNode, ctx: BuildContext): PathNode {
  const base = extractBaseProps(node);
  const { fillPaints, strokePaints, strokeWeight, strokeCap, strokeJoin, strokeDashes, strokeAlign } = extractPaintProps(node);
  const { fillGeometry, strokeGeometry } = extractGeometryProps(node);
  const { effects } = extractEffectsProps(node);

  const vectorPaths = node.vectorPaths;

  const contoursRef = { value: convertVectorPathsToContours(vectorPaths) };
  const isStrokeGeometryRef = { value: false };
  if (contoursRef.value.length === 0) {
    contoursRef.value = decodeGeometryToContours(fillGeometry, ctx.blobs);
  }
  if (contoursRef.value.length === 0) {
    contoursRef.value = decodeGeometryToContours(strokeGeometry, ctx.blobs);
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
  const scalarWeight = resolveScalarStrokeWeight(strokeWeight);
  const reconstructedRef = { value: false };
  if (isStrokeGeometryRef.value && strokeAlign === "CENTER" && scalarWeight > 0 && scalarWeight <= 1.5) {
    const centerline = reconstructStrokeCenterline(contoursRef.value, scalarWeight);
    if (centerline) {
      contoursRef.value = centerline;
      reconstructedRef.value = true;
    }
  }

  // Apply per-path style overrides from vectorData
  const resolvedContours = applyStyleOverrides(contoursRef.value, node, ctx);

  // strokeGeometry is Figma's pre-expanded outline of a stroke.
  // It should be *filled* with the stroke colour, not stroked again —
  // unless we successfully reconstructed the centerline above, in which
  // case the strokeGeometry is gone and we render the centerline as a
  // proper stroke.
  const treatAsFill = isStrokeGeometryRef.value && !reconstructedRef.value;
  const fills = resolveVectorFills(reconstructedRef.value, treatAsFill, strokePaints, fillPaints, ctx.images);
  const stroke = resolveVectorStroke(treatAsFill, strokePaints, strokeWeight, strokeCap, strokeJoin, strokeDashes, strokeAlign);

  const { size } = extractSizeProps(node);
  return {
    type: "path",
    id: getNodeId(node, ctx),
    name: node.name,
    transform: convertDesignTransform(base.transform),
    opacity: base.opacity,
    visible: base.visible,
    effects: convertEffectsToScene(effects),
    blendMode: convertBlendMode(node),
    contours: resolvedContours,
    fills,
    stroke,
    width: size.x > 0 ? size.x : undefined,
    height: size.y > 0 ? size.y : undefined,
  };
}

/** Extract the name string from a KiwiEnumValue or return the string as-is. */
function extractEnumName(value: unknown): string | undefined {
  if (typeof value === "string") { return value; }
  if (value && typeof value === "object" && "name" in value) {
    // `"name" in value` narrows to `value & { name: unknown }`, so
    // `value.name` is safely `unknown` without any cast.
    const name: unknown = value.name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function resolveTextAutoResize(rawAutoResize: unknown): TextAutoResize {
  const name = extractEnumName(rawAutoResize);
  if (name === "NONE" || name === "HEIGHT" || name === "TRUNCATE") {
    return name;
  }
  return "WIDTH_AND_HEIGHT";
}

function buildTextNode(node: FigDesignNode, ctx: BuildContext): TextNode {
  const base = extractBaseProps(node);
  const { effects } = extractEffectsProps(node);
  const textData = convertTextNode(node, {
    blobs: ctx.blobs,
    fontResolver: ctx.textFontResolver,
    styleRegistry: ctx.styleRegistry,
  });

  // Resolve textAutoResize from domain textData
  const rawAutoResize = node.textData?.textAutoResize;
  const textAutoResize = resolveTextAutoResize(rawAutoResize);

  return {
    type: "text",
    id: getNodeId(node, ctx),
    name: node.name,
    transform: convertDesignTransform(base.transform),
    opacity: base.opacity,
    visible: base.visible,
    effects: convertEffectsToScene(effects),
    blendMode: convertBlendMode(node),
    width: node.size?.x ?? 0,
    height: node.size?.y ?? 0,
    textAutoResize,
    textTruncation: extractEnumName(node.textData?.textTruncation),
    leadingTrim: extractEnumName(node.textData?.leadingTrim),
    hyperlink: node.textData?.hyperlink?.url,
    glyphContours: textData.glyphContours,
    decorationContours: textData.decorationContours,
    runs: textData.runs,
    fill: textData.fill,
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
  children: readonly FigDesignNode[],
  ctx: BuildContext,
): BooleanPathInput[] {
  const result: BooleanPathInput[] = [];

  for (const child of children) {
    const base = extractBaseProps(child);
    if (!base.visible && !ctx.showHiddenNodes) {
      continue;
    }

    const typeName = getDesignNodeTypeName(child);
    const childTransform = convertDesignTransform(base.transform);

    // Nested BOOLEAN_OPERATION: recurse
    if (typeName === "BOOLEAN_OPERATION") {
      const nestedResult = computeBooleanResultFromNode(child, ctx);
      if (nestedResult) {
        for (const d of nestedResult) {
          const td = applyTransformToPathD(d, childTransform);
          result.push({ d: td, windingRule: "nonzero" });
        }
      }
      continue;
    }

    // Extract geometry
    const { fillGeometry, strokeGeometry } = extractGeometryProps(child);
    const contours = resolveBooleanInputContours(child, fillGeometry, strokeGeometry, ctx);

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

function resolveBooleanInputContours(
  child: FigDesignNode,
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
  node: FigDesignNode,
  ctx: BuildContext,
): readonly string[] | undefined {
  const children: readonly FigDesignNode[] = node.children ?? [];
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
  node: FigDesignNode,
  ctx: BuildContext,
  resultPaths: readonly string[],
): PathNode {
  const base = extractBaseProps(node);
  const { fillPaints, strokePaints, strokeWeight, strokeCap, strokeJoin, strokeDashes, strokeAlign } = extractPaintProps(node);
  const { effects } = extractEffectsProps(node);

  const contours: PathContour[] = resultPaths.map((d) => ({
    commands: parseSvgPathDToCommands(d),
    windingRule: "evenodd" as const,
  }));

  return {
    type: "path",
    id: getNodeId(node, ctx),
    name: node.name,
    transform: convertDesignTransform(base.transform),
    opacity: base.opacity,
    visible: base.visible,
    effects: convertEffectsToScene(effects),
    blendMode: convertBlendMode(node),
    contours,
    fills: convertPaintsToFills(fillPaints, ctx.images),
    stroke: convertStrokeToSceneStroke(strokePaints, strokeWeight, { strokeCap, strokeJoin, dashPattern: strokeDashes, strokeAlign }),
  };
}

/**
 * Parse SVG path d-string into PathCommand array for boolean results.
 */
function parseSvgPathDToCommands(d: string): PathContour["commands"][number][] {
  return parseSvgPathD(d);
}

function cacheBuiltNode<T extends SceneNode>(source: FigDesignNode, sceneNode: T, ctx: BuildContext): T {
  ctx.nextNodesBySource.set(source, sceneNode);
  return sceneNode;
}

// =============================================================================
// Auto-layout stretch (narrow)
// =============================================================================

/**
 * Apply the Figma auto-layout `stackChildAlignSelf=STRETCH` rule.
 *
 * When the parent FRAME is an auto-layout container (stackMode VERTICAL or
 * HORIZONTAL) and a child has `stackChildAlignSelf=STRETCH`, the child's
 * counter-axis (horizontal for VERTICAL stack, vertical for HORIZONTAL)
 * dimension resolves to the parent's content area on that axis.
 *
 * Scope is deliberately narrow: this only handles the COUNTER-axis stretch,
 * not the primary-axis grow / SPACE_BETWEEN / primary-axis sizing rules
 * (those belong to Task #39's full auto-layout implementation). The
 * narrow fix is enough to correct list-row separator STRETCH rendering,
 * where `_Separator` carries `stackChildAlignSelf=STRETCH` and its
 * stored size (e.g. 129×1, copied from an unrelated SYMBOL default)
 * is smaller than the parent list-row's inner width.
 *
 * Returns a new children array with stretched sizes applied; children
 * that don't match the stretch condition are returned unchanged so
 * reference equality holds for the common case.
 *
 * The function only reads the subset of FigDesignNode captured by the
 * `StretchParent` / `StretchChild` interfaces below, so it can be
 * unit-tested with minimal literal structures without casting.
 */
export type StretchParent = {
  readonly size?: { readonly x: number; readonly y: number };
  readonly autoLayout?: {
    readonly stackMode?: { readonly name?: string };
    readonly stackPadding?: number | { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  };
};
export type StretchChild = {
  readonly size?: { readonly x: number; readonly y: number };
  readonly layoutConstraints?: {
    readonly stackChildAlignSelf?: { readonly name?: string };
  };
};

function resizeCounterAxis(
  size: { readonly x: number; readonly y: number },
  counterContent: number,
  counterAxis: "x" | "y",
): { readonly x: number; readonly y: number } {
  if (counterAxis === "x") {
    return { x: counterContent, y: size.y };
  }
  return { x: size.x, y: counterContent };
}

/**
 * Stretch auto-layout children along the counter axis.
 */
export function applyCounterAxisStretch<C extends StretchChild>(
  parent: StretchParent,
  children: readonly C[],
): readonly C[] {
  const autoLayout = parent.autoLayout;
  if (!autoLayout) {
    return children;
  }
  const modeName = autoLayout.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL") {
    return children;
  }

  // Parent's content area = size minus padding. `stackPadding` may be a
  // uniform number (Kiwi shorthand) OR a per-side `{top,right,bottom,
  // left}` object (domain expanded form); both are honoured here.
  // When no stackPadding is set the content area equals the parent's size.
  const padCounter = resolveCounterAxisPadding(autoLayout.stackPadding, modeName);
  const pSize = parent.size;
  if (!pSize) {
    return children;
  }
  const counterAxis = modeName === "VERTICAL" ? "x" : "y";
  const counterContent = (counterAxis === "x" ? pSize.x : pSize.y) - padCounter;
  if (counterContent <= 0) {
    return children;
  }

  const state: { changed: boolean; children: C[] } = { changed: false, children: [] };
  for (const child of children) {
    const alignSelf = child.layoutConstraints?.stackChildAlignSelf?.name;
    if (alignSelf !== "STRETCH" || !child.size) {
      state.children.push(child);
      continue;
    }
    const current = counterAxis === "x" ? child.size.x : child.size.y;
    if (Math.abs(current - counterContent) < 0.5) {
      state.children.push(child);
      continue;
    }
    const newSize = resizeCounterAxis(child.size, counterContent, counterAxis);
    state.children.push({ ...child, size: newSize });
    state.changed = true;
  }
  return state.changed ? state.children : children;
}

function resolveCounterAxisPadding(
  stackPadding: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } | number | undefined,
  modeName: "VERTICAL" | "HORIZONTAL",
): number {
  if (typeof stackPadding === "number") {
    return stackPadding * 2;
  }
  if (stackPadding && typeof stackPadding === "object") {
    return modeName === "VERTICAL" ? stackPadding.left + stackPadding.right : stackPadding.top + stackPadding.bottom;
  }
  return 0;
}

function cloneOwnInstanceChildren(children: readonly FigDesignNode[]): MutableFigDesignNode[] {
  if (children.length === 0) { return []; }
  return children.map(deepCloneDesignNode);
}

function positionResolvedInstanceChildren<C extends PrimaryAxisChild>(
  sizeChanged: boolean,
  dsdPinsTransform: boolean,
  parent: PrimaryAxisParent,
  children: readonly C[],
): readonly C[] {
  if (sizeChanged && !dsdPinsTransform) {
    return resolveAutoLayoutFrame(parent, children).children;
  }
  return children;
}

// =============================================================================
// Recursive Builder
// =============================================================================

function buildNode(node: FigDesignNode, ctx: BuildContext): SceneNode | null {
  const cached = ctx.previousCache?.nodesBySource.get(node);
  if (cached) {
    ctx.nextNodesBySource.set(node, cached);
    return cached;
  }

  const base = extractBaseProps(node);

  // Skip hidden nodes unless explicitly shown
  if (!base.visible && !ctx.showHiddenNodes) {
    return null;
  }

  const typeName = getDesignNodeTypeName(node);
  const children = node.children ?? [];

  switch (typeName) {
    case "DOCUMENT":
    case "CANVAS": {
      const childNodes = buildChildren(children, ctx);
      return cacheBuiltNode(node, buildGroupNode(node, ctx, childNodes), ctx);
    }

    // SYMBOL is the on-disk encoding of the Figma UI concept "Component";
    // the canonical schema has no COMPONENT or COMPONENT_SET NodeType
    // (a "Variant Set" is a FRAME with variant metadata, already covered).
    // See `docs/refactor/component-type-cleanup.md`.
    case "FRAME":
    case "SECTION":
    case "SLIDE":
    case "SLIDE_GRID":
    case "SLIDE_ROW":
    case "SYMBOL": {
      const resolved = resolveAutoLayoutFrame(node, children);
      const childNodes = buildChildren(resolved.children, ctx);
      return cacheBuiltNode(node, buildFrameNode(resolved.parent, ctx, childNodes), ctx);
    }

    case "INTERACTIVE_SLIDE_ELEMENT": {
      if (shouldRenderInteractiveSlideElementAsPath(node, children)) {
        return cacheBuiltNode(node, buildVectorNode(node, ctx), ctx);
      }
      const resolved = resolveAutoLayoutFrame(node, children);
      const childNodes = buildChildren(resolved.children, ctx);
      return cacheBuiltNode(node, buildFrameNode(resolved.parent, ctx, childNodes), ctx);
    }

    case "INSTANCE": {
      // Resolve INSTANCE against its SYMBOL:
      // - Merge visual properties (fills, cornerRadius, effects, etc.)
      // - Inherit children if instance has none
      //
      // Top-level callers pass `node.children` straight from the input
      // tree, which is read-only and shared with the input. Clone here
      // so the resolver may safely mutate. Empty input is handled
      // inside the resolver (clones from `symbol.children`).
      const ownChildren = cloneOwnInstanceChildren(children);
      const resolved = resolveDesignInstance(node, ownChildren, ctx);
      // Primary-axis re-solve gate (SoT for "when does our layout solver
      // override authored child positions"):
      //
      //   1. INSTANCE size differs from SYMBOL size (sizeChanged) AND
      //   2. DSD does NOT pin a direct child's transform.
      //
      // (1) ensures we only touch instances that were actually resized
      // (otherwise SYMBOL-time positions are still valid). (2) honours
      // Figma's pre-computed layout when present — DSD that carries a
      // `transform` on a depth-1 path is Figma's resolved post-resize
      // value and must not be clobbered.
      const symId = node.symbolId;
      const symSize = symId ? ctx.symbolMap.get(symId)?.size : undefined;
      const sizeChanged = symSize !== undefined && (
        Math.abs(symSize.x - resolved.effectiveNode.size.x) > 0.5 ||
        Math.abs(symSize.y - resolved.effectiveNode.size.y) > 0.5
      );
      const dsdPinsTransform = (node.derivedSymbolData ?? []).some((e) =>
        e.transform !== undefined && (e.guidPath?.guids?.length ?? 0) === 1,
      );
      const positioned = positionResolvedInstanceChildren(sizeChanged, dsdPinsTransform, resolved.effectiveNode, resolved.children);
      const layoutResolved = resolveAutoLayoutFrame(resolved.effectiveNode, positioned);
      const childNodes = buildChildren(layoutResolved.children, ctx);
      return cacheBuiltNode(node, buildFrameNode(layoutResolved.parent, ctx, childNodes), ctx);
    }

    case "GROUP": {
      const childNodes = buildChildren(children, ctx);
      return cacheBuiltNode(node, buildGroupNode(node, ctx, childNodes), ctx);
    }

    case "BOOLEAN_OPERATION": {
      // 1. Pre-computed fillGeometry (set by Figma export)
      const { fillGeometry, strokeGeometry } = extractGeometryProps(node);
      const hasMergedGeometry =
        (fillGeometry && fillGeometry.length > 0) ||
        (strokeGeometry && strokeGeometry.length > 0);
      if (hasMergedGeometry) {
        return cacheBuiltNode(node, buildVectorNode(node, ctx), ctx);
      }
      // 2. Compute boolean operation from child geometries using path-bool
      const resultPaths = computeBooleanResultFromNode(node, ctx);
      if (resultPaths && resultPaths.length > 0) {
        return cacheBuiltNode(node, buildBooleanOperationNode(node, ctx, resultPaths), ctx);
      }
      throw new Error(`Boolean operation  has neither merged geometry nor computable child paths`);
    }

    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return cacheBuiltNode(node, buildRectNode(node, ctx), ctx);

    case "ELLIPSE":
      return cacheBuiltNode(node, buildEllipseNode(node, ctx), ctx);

    case "VECTOR":
    case "LINE":
    case "STAR":
    case "REGULAR_POLYGON":
      return cacheBuiltNode(node, buildVectorNode(node, ctx), ctx);

    case "TEXT":
      return cacheBuiltNode(node, buildTextNode(node, ctx), ctx);

    // IMAGE nodes in .fig are rectangles with image fills.
    // The image data lives in the fills array as an IMAGE paint.
    // Render as a rect node — the image fill is handled by the
    // fill conversion pipeline (convertPaintsToFills → ImageFill).
    case "IMAGE":
      return cacheBuiltNode(node, buildRectNode(node, ctx), ctx);

    default:
      // Unknown node type - try to render children as group
      if (children.length > 0) {
        const childNodes = buildChildren(children, ctx);
        return cacheBuiltNode(node, buildGroupNode(node, ctx, childNodes), ctx);
      }
      return null;
  }
}

/**
 * Build scene nodes from a list of FigDesignNode children.
 *
 * Handles mask processing in a single pass: when a child has `mask: true`,
 * it becomes an SVG mask for all subsequent siblings until the next mask
 * node or the end of the list. Masked siblings are wrapped in a GroupNode
 * with the `mask` field set.
 *
 * This mirrors the old SVG renderer's `renderChildrenWithMasks()` logic,
 * but produces SceneNodes instead of SVG strings.
 */
function buildChildren(children: readonly FigDesignNode[], ctx: BuildContext): SceneNode[] {
  const result: SceneNode[] = [];

  const maskState: {
    activeMaskContent: SceneNode | null;
    activeMaskId: SceneNodeId | null;
    maskedChildren: SceneNode[];
  } = {
    activeMaskContent: null,
    activeMaskId: null,
    maskedChildren: [],
  };

  for (const child of children) {
    const base = extractBaseProps(child);
    if (!base.visible && !ctx.showHiddenNodes) {
      continue;
    }

    if (isMaskNode(child)) {
      // Flush previously accumulated masked children
      if (maskState.activeMaskId && maskState.activeMaskContent && maskState.maskedChildren.length > 0) {
        result.push(wrapWithMask(maskState.activeMaskId, maskState.activeMaskContent, maskState.maskedChildren, ctx));
        maskState.maskedChildren = [];
      }

      // Build the mask node and start a new mask group
      const maskNode = buildNode(child, ctx);
      if (maskNode) {
        maskState.activeMaskId = maskNode.id;
        maskState.activeMaskContent = maskNode;
      } else {
        maskState.activeMaskId = null;
        maskState.activeMaskContent = null;
      }
    } else {
      const node = buildNode(child, ctx);
      if (node) {
        if (maskState.activeMaskId) {
          maskState.maskedChildren.push(node);
        } else {
          result.push(node);
        }
      }
    }
  }

  // Flush final masked group
  if (maskState.activeMaskId && maskState.activeMaskContent && maskState.maskedChildren.length > 0) {
    result.push(wrapWithMask(maskState.activeMaskId, maskState.activeMaskContent, maskState.maskedChildren, ctx));
  }

  return result;
}

/**
 * Wrap masked children in a GroupNode with the mask field set.
 */
function wrapWithMask(
  maskId: SceneNodeId,
  maskContent: SceneNode,
  maskedChildren: readonly SceneNode[],
  ctx: BuildContext,
): GroupNode {
  return {
    type: "group",
    id: createNodeId(`masked-group-${ctx.nodeCounter++}`),
    transform: IDENTITY,
    opacity: 1,
    visible: true,
    effects: [],
    mask: { maskId, maskContent },
    children: maskedChildren,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build a scene graph from FigDesignNode domain objects.
 *
 * @param nodes - Root FigDesignNode nodes to render
 * @param options - Build configuration
 * @returns Format-agnostic scene graph
 */
export function buildSceneGraph(nodes: readonly FigDesignNode[], options: BuildSceneGraphOptions): SceneGraph {
  return buildSceneGraphWithCache(nodes, options, undefined).sceneGraph;
}

/**
 * Build a scene graph and preserve SceneNode references for unchanged
 * immutable FigDesignNode source objects.
 */
export function buildSceneGraphWithCache(
  nodes: readonly FigDesignNode[],
  options: BuildSceneGraphOptions,
  previousCache: SceneGraphBuildCache | undefined,
): BuildSceneGraphResult {
  const nextNodesBySource = new WeakMap<FigDesignNode, SceneNode>();
  const ctx: BuildContext = {
    blobs: options.blobs,
    images: options.images,
    symbolMap: options.symbolMap,
    styleRegistry: options.styleRegistry,
    showHiddenNodes: options.showHiddenNodes,
    warnings: options.warnings,
    textFontResolver: options.textFontResolver,
    previousCache,
    nextNodesBySource,
    nodeCounter: 0,
  };

  const children = buildChildren(nodes, ctx);

  const root: GroupNode = {
    type: "group",
    id: createNodeId("root"),
    transform: IDENTITY_MATRIX,
    opacity: 1,
    visible: true,
    effects: [],
    children,
  };

  return {
    sceneGraph: {
      width: options.canvasSize.width,
      height: options.canvasSize.height,
      viewport: options.viewport,
      root,
      version: 1,
    },
    cache: { nodesBySource: nextNodesBySource },
  };
}
