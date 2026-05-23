/**
 * @file RenderTree resolver — SceneGraph → RenderTree
 *
 * Performs all rendering decisions and attribute resolution in a single
 * traversal. The output RenderTree is fully resolved: backends only format.
 *
 * Uses scene-graph/render/ as the SoT for all SVG attribute resolution.
 */

import type {
  SceneGraph,
  SceneNode,
  GroupNode,
  FrameNode,
  RectNode,
  EllipseNode,
  PathNode,
  TextNode,
  ImageNode,
  Fill,
  Stroke,
  Effect,
  ClipShape,
  PathContour,
} from "@higma-document-renderers/fig/scene-graph";

import {
  uint8ArrayToBase64,
  resolveFillWithRenderSettings,
  resolveTopFillWithRenderSettings,
  resolveStrokeResult,
  resolveEffects,
  resolveEffectBounds,
  finalizeGradientDefs,
  finalizeImagePatternDefsWithRenderSettings,
  resolveFigmaRenderExportSettings,
  resolveFigmaBlurStdDeviation,
  renderExportSettingsCacheKey,
  buildEffectStack,
  type IdGenerator,
  type ResolvedFill,
  type ResolvedFilter,
  type ResolvedStrokeAttrs,
  type ResolvedStrokeLayer,
  type ResolvedStrokeResult,
  type ResolvedEffectStack,
  type ResolvedFigmaRenderExportSettings,
  type RenderExportSettingsCacheKey,
  type SceneGraphRenderOptions,
} from "../render";
import {
  matrixToSvgTransform,
  contourToSvgD,
  pathContoursBoundingBox,
  clampCornerRadius,
  cornerRadiusScalar,
  buildEllipseArcPathD,
  buildStrokeAlignedClosedPathCommands,
  buildStrokeGeometryBackedInsideStrokeCenterlineCommands,
  buildStrokeGeometryBackedOutsideStrokeCenterlineCommands,
  type PathCommand,
} from "@higma-primitives/path";
import { createRenderTreeIdGenerator } from "./id-generator";
import { buildClipShape } from "./clip-shape";

/**
 * Decimal precision for path `d` coordinates held in the RenderTree.
 * The SVG formatter owns Figma export quantisation because it has the
 * final viewport origin and emitted parent transform. Keeping six
 * decimals here preserves enough Kiwi geometry for scaled instances
 * before the formatter applies Figma's viewport-local precision rule.
 */
const RENDER_PATH_PRECISION = 6;
const STROKE_GEOMETRY_CENTERLINE_PATH_PRECISION = RENDER_PATH_PRECISION;
const STROKE_ALIGNED_PATH_FLATTEN_TOLERANCE = 0.001;

import type {
  RenderTree,
  RenderNode,
  RenderGroupNode,
  RenderFrameNode,
  RenderRectNode,
  RenderEllipseNode,
  RenderPathNode,
  RenderTextNode,
  RenderTextGlyphRun,
  RenderImageNode,
  RenderDef,
  ResolvedWrapperAttrs,
  ResolvedFillResult,
  ResolvedFillLayer,
  RenderFrameBackground,
  RenderFrameSurfaceShape,
  RenderPathContour,
  RenderBackgroundBlur,
  RenderMask,
  RenderMaskContentRendering,
  ClipPathShape,
  StrokeShape,
  StrokeRendering,
} from "./types";

function resolveOptionalBackgroundBlur(
  effectStack: ResolvedEffectStack,
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined,
  ids: IdGenerator,
  defs: RenderDef[],
  shape: ClipPathShape,
): RenderBackgroundBlur | undefined {
  if (!bounds) { return undefined; }
  return resolveBackgroundBlur(effectStack, bounds, ids, defs, shape);
}

function resolveFrameStrokeRendering(
  node: FrameNode,
  surfaceShape: RenderFrameSurfaceShape,
  ids: IdGenerator,
  defs: RenderDef[],
  maskShape: ClipPathShape,
): StrokeRendering | undefined {
  const individual = resolveIndividualFrameStrokeRendering(node, surfaceShape, ids, defs);
  if (individual !== undefined) {
    return individual;
  }
  if (node.stroke) {
    const strokeShape = frameSurfaceToStrokeShape(node, surfaceShape);
    return resolveStrokeRendering(node.stroke, ids, defs, strokeShape, { kind: "source-shape", maskShape });
  }
  return undefined;
}

function resolveIndividualFrameStrokeRendering(
  node: FrameNode,
  surfaceShape: RenderFrameSurfaceShape,
  ids: IdGenerator,
  defs: RenderDef[],
): StrokeRendering | undefined {
  if (!node.individualStrokeWeights || !node.stroke) {
    return undefined;
  }
  if (surfaceShape.kind !== "rect") {
    throw new Error(`resolveRenderTree: frame ${node.id} has individual stroke weights on a non-rectangular Kiwi surface`);
  }
  const result = resolveStrokeResult(node.stroke, ids);
  collectStrokeLayerGradientDefs(result.layers, defs);
  return {
    mode: "individual",
    sides: node.individualStrokeWeights,
    color: result.attrs.stroke,
    opacity: result.attrs.strokeOpacity,
    width: node.width,
    height: node.height,
    cornerRadius: surfaceShape.cornerRadius,
    strokeAlign: result.attrs.strokeAlign,
  };
}

function frameSurfaceToStrokeShape(node: FrameNode, surfaceShape: RenderFrameSurfaceShape): StrokeShape {
  switch (surfaceShape.kind) {
    case "rect":
      return {
        kind: "rect",
        width: surfaceShape.width,
        height: surfaceShape.height,
        cornerRadius: surfaceShape.cornerRadius,
        cornerSmoothing: surfaceShape.cornerSmoothing,
      };
    case "path": {
      const rectShape = framePathSurfaceToRectStrokeShape(node);
      if (rectShape !== undefined) {
        return rectShape;
      }
      return { kind: "path", paths: surfaceShape.paths };
    }
  }
}

function framePathSurfaceToRectStrokeShape(node: FrameNode): StrokeShape | undefined {
  if (node.surfaceShape.type !== "path") {
    return undefined;
  }
  const radii = roundedRectRadiiFromPathClip(node.surfaceShape, node.width, node.height);
  if (radii === undefined) {
    return undefined;
  }
  return {
    kind: "rect",
    width: node.width,
    height: node.height,
    cornerRadius: radii,
    cornerSmoothing: node.cornerSmoothing,
  };
}

function collectStrokeLayerGradientDefs(
  layers: ReturnType<typeof resolveStrokeResult>["layers"],
  defs: RenderDef[],
): void {
  if (!layers) {
    return;
  }
  for (const layer of layers) {
    collectGradientDef(layer.gradientDef, defs);
  }
}

function resolveFrameBackground(
  node: FrameNode,
  hasFills: boolean,
  strokeRendering: StrokeRendering | undefined,
  filterAttr: string | undefined,
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: ResolvedFigmaRenderExportSettings,
): RenderFrameBackground | null {
  if (!hasFills && !strokeRendering) {
    return null;
  }
  const fillResult = resolveFrameBackgroundFill(hasFills, node.fills, ids, defs, exportSettings);
  const fillLayers = hasFills ? resolveAllFillLayers(node.fills, ids, defs, exportSettings) : undefined;
  return {
    fill: fillResult,
    fillLayers,
    strokeRendering,
    filterAttr,
  };
}

type LocalBox = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

type AffineMatrix2x3 = {
  readonly m00: number; readonly m01: number; readonly m02: number;
  readonly m10: number; readonly m11: number; readonly m12: number;
};

const IDENTITY_AFFINE: AffineMatrix2x3 = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const GEOMETRY_FLOAT_EPSILON = 1e-4;

function composeAffine(parent: AffineMatrix2x3, child: AffineMatrix2x3): AffineMatrix2x3 {
  return {
    m00: parent.m00 * child.m00 + parent.m01 * child.m10,
    m01: parent.m00 * child.m01 + parent.m01 * child.m11,
    m02: parent.m00 * child.m02 + parent.m01 * child.m12 + parent.m02,
    m10: parent.m10 * child.m00 + parent.m11 * child.m10,
    m11: parent.m10 * child.m01 + parent.m11 * child.m11,
    m12: parent.m10 * child.m02 + parent.m11 * child.m12 + parent.m12,
  };
}

function transformLocalBox(box: LocalBox, m: AffineMatrix2x3): LocalBox {
  const xs = [
    m.m00 * box.x + m.m01 * box.y + m.m02,
    m.m00 * (box.x + box.w) + m.m01 * box.y + m.m02,
    m.m00 * box.x + m.m01 * (box.y + box.h) + m.m02,
    m.m00 * (box.x + box.w) + m.m01 * (box.y + box.h) + m.m02,
  ];
  const ys = [
    m.m10 * box.x + m.m11 * box.y + m.m12,
    m.m10 * (box.x + box.w) + m.m11 * box.y + m.m12,
    m.m10 * box.x + m.m11 * (box.y + box.h) + m.m12,
    m.m10 * (box.x + box.w) + m.m11 * (box.y + box.h) + m.m12,
  ];
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

function unionLocalBox(a: LocalBox, b: LocalBox): LocalBox {
  const xMin = Math.min(a.x, b.x);
  const yMin = Math.min(a.y, b.y);
  const xMax = Math.max(a.x + a.w, b.x + b.w);
  const yMax = Math.max(a.y + a.h, b.y + b.h);
  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

function isLocalBox(box: LocalBox | undefined): box is LocalBox {
  return box !== undefined;
}

function mergeLocalBoxes(boxes: readonly LocalBox[]): LocalBox | undefined {
  const first = boxes[0];
  if (first === undefined) {
    return undefined;
  }
  return boxes.slice(1).reduce((acc, box) => unionLocalBox(acc, box), first);
}

function roundedRectRadiiFromPathClip(
  clip: Extract<ClipShape, { readonly type: "path" }>,
  width: number,
  height: number,
): readonly [number, number, number, number] | undefined {
  const contour = clip.contours.length === 1 ? clip.contours[0] : undefined;
  if (contour === undefined) {
    return undefined;
  }
  const commands = commandsWithoutClosingSegment(contour.commands);
  if (commands.length !== 9) {
    return undefined;
  }
  const [move, topLeftCurve, topEdge, topRightCurve, rightEdge, bottomRightCurve, bottomEdge, bottomLeftCurve, leftEdge] = commands;
  if (
    move?.type !== "M" ||
    topLeftCurve?.type !== "C" ||
    topEdge?.type !== "L" ||
    topRightCurve?.type !== "C" ||
    rightEdge?.type !== "L" ||
    bottomRightCurve?.type !== "C" ||
    bottomEdge?.type !== "L" ||
    bottomLeftCurve?.type !== "C" ||
    leftEdge?.type !== "L"
  ) {
    return undefined;
  }
  const topLeft = move.y;
  const topRight = width - topEdge.x;
  const bottomRight = height - rightEdge.y;
  const bottomLeft = bottomEdge.x;
  if (
    !nearlyEqual(move.x, 0) ||
    !nearlyEqual(topLeftCurve.x, topLeft) ||
    !nearlyEqual(topLeftCurve.y, 0) ||
    !nearlyEqual(topEdge.y, 0) ||
    !nearlyEqual(topRightCurve.x, width) ||
    !nearlyEqual(topRightCurve.y, topRight) ||
    !nearlyEqual(rightEdge.x, width) ||
    !nearlyEqual(bottomRightCurve.x, width - bottomRight) ||
    !nearlyEqual(bottomRightCurve.y, height) ||
    !nearlyEqual(bottomEdge.y, height) ||
    !nearlyEqual(bottomLeftCurve.x, 0) ||
    !nearlyEqual(bottomLeftCurve.y, height - bottomLeft) ||
    !nearlyEqual(leftEdge.x, 0) ||
    !nearlyEqual(leftEdge.y, topLeft)
  ) {
    return undefined;
  }
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function commandsWithoutClosingSegment(
  commands: Extract<ClipShape, { readonly type: "path" }>["contours"][number]["commands"],
): Extract<ClipShape, { readonly type: "path" }>["contours"][number]["commands"] {
  const last = commands[commands.length - 1];
  if (last?.type === "Z") {
    return commands.slice(0, -1);
  }
  return commands;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= GEOMETRY_FLOAT_EPSILON;
}

function frameClipCropsChildren(node: FrameNode): boolean {
  return node.children
    .map((child) => sceneNodeClipLocalBoxRecursive(child, IDENTITY_AFFINE))
    .filter(isLocalBox)
    .some((box) => !frameClipContainsLocalBox(node, box));
}

function frameClipContainsLocalBox(node: FrameNode, box: LocalBox): boolean {
  const clip = node.clip;
  if (clip === undefined) {
    return frameRectContainsLocalBox(node.width, node.height, box);
  }
  switch (clip.type) {
    case "rect":
      return frameRectContainsLocalBox(clip.width, clip.height, box);
    case "path": {
      const radii = roundedRectRadiiFromPathClip(clip, node.width, node.height);
      if (radii === undefined) {
        return false;
      }
      return frameRectContainsLocalBox(node.width, node.height, box);
    }
  }
}

// Figma's SVG exporter emits FRAME child clips for rectangular overflow.
// Rounded corners stay on the frame surface/mask; children that only cover
// the corner curve but remain inside the authored rectangle do not create a
// child clip.
function frameRectContainsLocalBox(
  width: number,
  height: number,
  box: LocalBox,
): boolean {
  return box.x >= -GEOMETRY_FLOAT_EPSILON
    && box.y >= -GEOMETRY_FLOAT_EPSILON
    && box.x + box.w <= width + GEOMETRY_FLOAT_EPSILON
    && box.y + box.h <= height + GEOMETRY_FLOAT_EPSILON;
}

function resolveFrameChildClipId(
  node: FrameNode,
  children: readonly RenderNode[],
  ids: IdGenerator,
  defs: RenderDef[],
  clampedRadius: ReturnType<typeof clampCornerRadius>,
): string | undefined {
  if (!node.clipsContent || children.length === 0) {
    return undefined;
  }
  // A frame with a 0-width or 0-height clip rect is degenerate: an SVG
  // <clipPath> using that rect would clip every child to a region with
  // no area, hiding even children that draw outside the rect (e.g. a
  // 0-height container holding LINE shapes whose stroke extends along
  // y=0). Figma's own SVG export skips the clip in this case — we
  // honour the same semantics rather than emitting an "impossible"
  // clip and silently swallowing the contents.
  if (node.width <= 0 || node.height <= 0) {
    return undefined;
  }
  if (!frameClipCropsChildren(node)) {
    return undefined;
  }
  const childClipId = ids.getNextId("clip");
  defs.push({
    type: "clip-path",
    id: childClipId,
    shape: resolveFrameClipPathShape(node, clampedRadius),
  });
  return childClipId;
}

function resolveFrameClipPathShape(
  node: FrameNode,
  clampedRadius: ReturnType<typeof clampCornerRadius>,
): ClipPathShape {
  if (node.clip !== undefined) {
    return sceneClipToClipPathShape(node.clip);
  }
  return buildClipShape(node.width, node.height, clampedRadius, node.cornerSmoothing);
}

function sceneClipToClipPathShape(clip: ClipShape): ClipPathShape {
  switch (clip.type) {
    case "rect":
      return buildClipShape(clip.width, clip.height, clip.cornerRadius, clip.cornerSmoothing);
    case "path":
      return {
        kind: "path",
        d: clip.contours.map((contour) => contourToSvgD(contour, RENDER_PATH_PRECISION)).join(" "),
        fillRule: resolvePathContoursFillRule(clip.contours),
      };
  }
}

function sceneClipToFrameSurfaceShape(clip: ClipShape): RenderFrameSurfaceShape {
  switch (clip.type) {
    case "rect":
      return {
        kind: "rect",
        width: clip.width,
        height: clip.height,
        cornerRadius: clip.cornerRadius,
        cornerSmoothing: clip.cornerSmoothing,
      };
    case "path":
      return {
        kind: "path",
        paths: clip.contours.map((contour) => ({
          d: contourToSvgD(contour, RENDER_PATH_PRECISION),
          fillRule: resolveRenderPathFillRule(contour),
        })),
      };
  }
}

function sceneClipElementBounds(clip: ClipShape): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  switch (clip.type) {
    case "rect":
      return { x: 0, y: 0, width: clip.width, height: clip.height };
    case "path": {
      const bbox = pathContoursBoundingBox(clip.contours);
      if (bbox === undefined) {
        throw new Error("resolveRenderTree: frame surface path has no bounding box");
      }
      return { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h };
    }
  }
}

function resolveTextClipId(node: TextNode, ids: IdGenerator, defs: RenderDef[]): string | undefined {
  const clipHeight = node.textTruncationClipHeight;
  if (clipHeight === undefined) {
    return undefined;
  }
  if (!Number.isFinite(clipHeight) || clipHeight < 0) {
    throw new Error("resolveRenderTree: textTruncationClipHeight must be a finite non-negative number");
  }
  const textClipId = ids.getNextId("text-clip");
  defs.push({
    type: "clip-path",
    id: textClipId,
    shape: {
      kind: "rect",
      x: 0,
      y: 0,
      width: node.width,
      height: clipHeight,
    },
  });
  return textClipId;
}

function resolveGroupChildClipId(node: GroupNode, ids: IdGenerator, defs: RenderDef[]): string | undefined {
  if (node.clip === undefined) {
    return undefined;
  }
  const childClipId = ids.getNextId("group-clip");
  defs.push({
    type: "clip-path",
    id: childClipId,
    shape: sceneClipToClipPathShape(node.clip),
  });
  return childClipId;
}

function resolveTextContent(node: TextNode): RenderTextNode["content"] {
  if (node.glyphContours && node.glyphContours.length > 0) {
    const runs = buildGlyphContentRuns(node);
    return { mode: "glyphs", runs };
  }
  if (node.textLineLayout) {
    return { mode: "lines", layout: node.textLineLayout };
  }
  return { mode: "glyphs", runs: [] };
}

/**
 * Group glyph contours by which `TextRun` their `firstCharacter` falls
 * into and serialise per-run path data. Decorations always paint with
 * the base run's fill — Figma applies underline / strikethrough at the
 * line level, not per character — so they're appended to the first run
 * (or to a synthesised base run if `runs[]` is empty).
 *
 * SoT: `node.runs` is the authoritative list of (start, end, fillColor,
 * fillOpacity); this function never re-derives fills from raw paints.
 *
 * Glyphs whose `firstCharacter` is `undefined` (e.g. opentype synthesised
 * line contours, Figma's auto-inserted ellipsis glyph) inherit the base
 * run — same precedence as decorations.
 */
function buildGlyphContentRuns(node: TextNode): readonly RenderTextGlyphRun[] {
  const sourceRuns = node.runs;
  // Resolve which run a glyph at character index `i` belongs to. Returns
  // run index or -1 when no run covers that character (shouldn't happen
  // for well-formed inputs because runs cover [0, characters.length)).
  function runIndexForChar(i: number): number {
    for (let r = 0; r < sourceRuns.length; r++) {
      if (i >= sourceRuns[r].start && i < sourceRuns[r].end) { return r; }
    }
    return -1;
  }
  // Bucket glyphs by run index. `-1` collects glyphs without a character
  // index — they fold into the base run (run 0) below.
  const byRun = new Map<number, string[]>();
  for (const contour of node.glyphContours ?? []) {
    const ci = contour.firstCharacter;
    const idx = ci === undefined ? -1 : runIndexForChar(ci);
    const key = idx >= 0 ? idx : 0;
    const list = byRun.get(key) ?? [];
    list.push(contourToSvgD(contour, RENDER_PATH_PRECISION));
    byRun.set(key, list);
  }
  // Decorations always go with the base run (key 0).
  if (node.decorationContours && node.decorationContours.length > 0) {
    const list = byRun.get(0) ?? [];
    for (const c of node.decorationContours) {
      list.push(contourToSvgD(c, RENDER_PATH_PRECISION));
    }
    byRun.set(0, list);
  }
  // Emit runs in source order; skip runs that received no contours so
  // the result list is a tight set of paint operations. The base run
  // carries `fills[0]`'s blend mode (if any) — character-level fill
  // runs inherit the base node's first-paint blend semantic because
  // Figma stores per-character fill overrides as colour/opacity only.
  const baseBlendMode = node.fills[0]?.blendMode;
  const out: RenderTextGlyphRun[] = [];
  for (let r = 0; r < sourceRuns.length; r++) {
    const list = byRun.get(r);
    if (!list || list.length === 0) { continue; }
    out.push({
      fillColor: sourceRuns[r].fillColor,
      fillOpacity: sourceRuns[r].fillOpacity,
      ...(baseBlendMode === undefined ? {} : { blendMode: baseBlendMode }),
      d: list.join(""),
    });
  }

  // Stacked fill paints: `fills[0]` is already represented by the
  // per-character source runs above (they carry the base fill into
  // each glyph-bucketed run). `fills[1..]` add additional full-text
  // paint passes in source order — Figma's painter's-algorithm
  // composite. The path data for each extra pass is the union of every
  // glyph contour and every decoration — i.e. the same "all visible
  // marks" silhouette each pass operates on. Each pass carries its
  // own `blendMode` because real-world stacks routinely mix NORMAL
  // and non-NORMAL passes (`[{black @0.15 NORMAL}, {black @1
  // OVERLAY}]` — the Event metadata Description / "Special event"
  // text in the App Store template). See `TextNode.fills` for the
  // SoT anchor (mirrors Figma's `fillPaints: Paint[]`).
  if (node.fills.length <= 1) {
    return out;
  }
  const everyD: string[] = [];
  for (const contour of node.glyphContours ?? []) {
    everyD.push(contourToSvgD(contour, RENDER_PATH_PRECISION));
  }
  for (const c of node.decorationContours ?? []) {
    everyD.push(contourToSvgD(c, RENDER_PATH_PRECISION));
  }
  const combined = everyD.join("");
  if (combined.length === 0) {
    return out;
  }
  for (let i = 1; i < node.fills.length; i++) {
    const f = node.fills[i];
    out.push({
      fillColor: colorToCssHex(f.color),
      fillOpacity: f.opacity,
      ...(f.blendMode === undefined ? {} : { blendMode: f.blendMode }),
      d: combined,
    });
  }

  return out;
}

/**
 * Convert a scene-graph `Color` (RGBA 0..1) into a 6-digit CSS hex.
 * Alpha is intentionally dropped — the run carries opacity separately
 * via `fillOpacity`, so combining alpha into the hex would double-apply.
 */
function colorToCssHex(color: { readonly r: number; readonly g: number; readonly b: number }): string {
  const toByte = (v: number) => {
    const clamped = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toByte(color.r)}${toByte(color.g)}${toByte(color.b)}`;
}

function hexToSceneColor(hex: string): { readonly r: number; readonly g: number; readonly b: number; readonly a: number } {
  const match = /^#([0-9a-f]{6})$/iu.exec(hex);
  if (match === null) {
    throw new Error(`resolveRenderTree: text run fillColor must be a six-digit hex color, got ${hex}`);
  }
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
    a: 1,
  };
}

function resolveImageDataUri(node: ImageNode): string | undefined {
  if (!node.data || node.data.length === 0) {
    return undefined;
  }
  const base64 = uint8ArrayToBase64(node.data);
  return `data:${node.mimeType};base64,${base64}`;
}

function resolvePathBounds(node: PathNode) {
  const bbox = pathContoursBoundingBox(node.contours);
  if (bbox) {
    return { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h };
  }
  if (node.width && node.height) {
    return { x: 0, y: 0, width: node.width, height: node.height };
  }
  return undefined;
}

// =============================================================================
// Resolve wrapper attributes
// =============================================================================

/**
 * Extract element bounds from a SceneNode for filter region computation.
 * Returns { x:0, y:0, width, height } — in the node's local coordinate space.
 */
function getNodeBounds(node: SceneNode): { x: number; y: number; width: number; height: number } | undefined {
  switch (node.type) {
    case "frame":
    case "rect":
    case "text":
    case "image":
      return { x: 0, y: 0, width: node.width, height: node.height };
    case "ellipse":
      return { x: 0, y: 0, width: node.rx * 2, height: node.ry * 2 };
    case "path":
      return node.width && node.height ? { x: 0, y: 0, width: node.width, height: node.height } : undefined;
    case "group":
      return undefined; // groups have no intrinsic bounds
  }
}

function resolveWrapper(
  node: SceneNode,
  ids: IdGenerator,
  defs: RenderDef[],
): { wrapper: ResolvedWrapperAttrs; effectStack: ResolvedEffectStack; filter?: ResolvedFilter; filterSource?: "effect-shape" } {
  const elementBounds = getNodeBounds(node);
  const transformStr = matrixToSvgTransform(node.transform);
  const effectStack = buildEffectStack(node.effects);
  const filterSource = resolveFilterSource(node, effectStack.foregroundEffects);
  const filterEffects = foregroundFilterEffectsWithBackdropRegion(effectStack, effectStack.foregroundEffects);
  const filterResult = resolveEffects(
    filterEffects,
    ids,
    elementBounds,
    filterSource === "effect-shape" ? { sourceGraphic: "omit" } : undefined,
  );

  if (filterResult) {
    defs.push({ type: "filter", filter: filterResult });
  }

  return {
    wrapper: {
      transform: transformStr,
      opacity: node.opacity < 1 ? node.opacity : undefined,
      filterAttr: filterResult?.filterAttr,
      blendMode: node.blendMode,
    },
    effectStack,
    filter: filterResult ?? undefined,
    filterSource,
  };
}

function resolveFilterSource(
  node: SceneNode,
  effects: readonly Effect[],
): "effect-shape" | undefined {
  if (!effects.some((effect) => effect.type === "drop-shadow" || effect.type === "inner-shadow")) {
    return undefined;
  }
  if (nodeHasVisibleEffectSource(node)) {
    return undefined;
  }
  return "effect-shape";
}

function nodeHasVisibleEffectSource(node: SceneNode): boolean {
  switch (node.type) {
    case "rect":
    case "ellipse":
      return node.fills.length > 0 || node.stroke !== undefined;
    case "path":
      return (
        node.fills.length > 0 ||
        node.stroke !== undefined ||
        node.contours.some((contour) => contour.fillOverride !== undefined)
      );
    case "frame":
    case "group":
    case "image":
    case "text":
      return true;
  }
}

function resolveFrameWrapper(
  node: FrameNode,
  ids: IdGenerator,
  defs: RenderDef[],
): { wrapper: ResolvedWrapperAttrs; effectStack: ResolvedEffectStack } {
  const transformStr = matrixToSvgTransform(node.transform);
  const effectStack = buildEffectStack(node.effects);
  const layerEffects = effectStack.foregroundEffects.filter((effect) => effect.type === "layer-blur");
  const filterEffects = foregroundFilterEffectsWithBackdropRegion(effectStack, layerEffects);
  const filterResult = resolveEffects(filterEffects, ids, getNodeBounds(node));

  if (filterResult) {
    defs.push({ type: "filter", filter: filterResult });
  }

  return {
    wrapper: {
      transform: transformStr,
      opacity: node.opacity < 1 ? node.opacity : undefined,
      filterAttr: filterResult?.filterAttr,
      blendMode: node.blendMode,
    },
    effectStack,
  };
}

function foregroundFilterEffectsWithBackdropRegion(
  effectStack: ResolvedEffectStack,
  foregroundEffects: readonly Effect[],
): readonly Effect[] {
  if (effectStack.backgroundBlur === null) {
    return foregroundEffects;
  }
  return [...foregroundEffects, effectStack.backgroundBlur];
}

function resolveFrameSurfaceFilterAttr(
  effects: readonly Effect[],
  ids: IdGenerator,
  defs: RenderDef[],
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): string | undefined {
  const surfaceEffects = effects.filter((effect) => effect.type === "drop-shadow" || effect.type === "inner-shadow");
  const filterResult = resolveEffects(surfaceEffects, ids, bounds);
  if (filterResult === undefined) {
    return undefined;
  }
  defs.push({ type: "filter", filter: filterResult });
  return filterResult.filterAttr;
}

// =============================================================================
// Def finalization with element bounds
// =============================================================================

/**
 * Finalize all size-dependent defs (gradient coordinates and image patterns)
 * for a given element bounding box. Called once per node resolver.
 *
 * FRAME / RECTANGLE / ELLIPSE / TEXT pass explicit `(0, 0, width,
 * height)` bounds. VECTOR paths pass their contour bbox because Figma
 * encodes gradient endpoints relative to that bbox.
 */
function finalizeDefs(
  defs: RenderDef[],
  elementBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  exportSettings: ResolvedFigmaRenderExportSettings,
): void {
  finalizeGradientDefs(defs, elementBounds);
  // Image patterns and angular/diamond gradients still operate on
  // `{width, height}` only — they tile/centre on the node's own
  // (0, 0) origin and do not need the bbox offset.
  const sizeOnly = { width: elementBounds.width, height: elementBounds.height };
  finalizeImagePatternDefsWithRenderSettings(defs, sizeOnly, exportSettings);
  finalizeAngularDiamondGradientDefs(defs, sizeOnly);
}

/**
 * Stamp each angular/diamond gradient def with the concrete element
 * size. The SVG emitter needs pixel dimensions to place the
 * `<foreignObject>` that hosts the CSS conic-gradient; pattern
 * `objectBoundingBox` units don't propagate into foreignObject's
 * x/y/width/height, so without pixel dimensions the gradient
 * collapses to a 1×1-pixel region and renders invisibly.
 */
function finalizeAngularDiamondGradientDefs(
  defs: RenderDef[],
  elementSize: { width: number; height: number },
): void {
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (def.type === "angular-gradient") {
      defs[i] = {
        type: "angular-gradient",
        def: { ...def.def, elementWidth: elementSize.width, elementHeight: elementSize.height },
      };
      continue;
    }
    if (def.type === "diamond-gradient") {
      defs[i] = {
        type: "diamond-gradient",
        def: { ...def.def, elementWidth: elementSize.width, elementHeight: elementSize.height },
      };
    }
  }
}

// =============================================================================
// Resolve mask
// =============================================================================

/**
 * Resolve a node's mask (if present) into a RenderMask reference and
 * a RenderMaskDef in the defs array.
 *
 * Masks can be applied to ANY node type (group, frame, rect, ellipse,
 * path, text, image). This function is called by every node resolver.
 */
function resolveMask(
  node: SceneNode,
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: ResolvedFigmaRenderExportSettings,
): RenderMask | undefined {
  if (!node.mask) {
    return undefined;
  }
  const maskId = ids.getNextId("mask");
  const resolvedMaskContent = resolveNode(node.mask.maskContent, ids, exportSettings);
  if (!resolvedMaskContent) {
    return undefined;
  }
  const contentRendering = resolveMaskContentRendering(node.mask.maskType, resolvedMaskContent);
  const bounds = resolveMaskContentBounds(node.mask.maskContent, contentRendering);
  defs.push({
    type: "mask",
    id: maskId,
    maskType: node.mask.maskType,
    contentRendering,
    bounds,
    maskContent: resolvedMaskContent,
  });
  return { maskId, maskAttr: `url(#${maskId})` };
}

function resolveMaskContentRendering(
  maskType: NonNullable<SceneNode["mask"]>["maskType"],
  maskContent: RenderNode,
): RenderMaskContentRendering {
  switch (maskType) {
    case "ALPHA":
    case "LUMINANCE":
      if (renderMaskContentHasAuthoredPaint(maskContent)) {
        return "source-paint";
      }
      return "geometry-coverage";
    case "OUTLINE":
      return "geometry-coverage";
  }
}

function renderMaskContentHasAuthoredPaint(node: RenderNode): boolean {
  switch (node.type) {
    case "group":
      return node.children.some((child) => renderMaskContentHasAuthoredPaint(child));
    case "frame":
      return (
        node.background !== null ||
        node.backgroundBlur !== undefined ||
        node.children.some((child) => renderMaskContentHasAuthoredPaint(child))
      );
    case "rect":
    case "ellipse":
    case "path":
      return node.sourceFills.length > 0 || node.strokeRendering !== undefined || node.filterSource === "effect-shape";
    case "text":
      return node.content.mode === "lines" || node.content.runs.length > 0;
    case "image":
      return true;
  }
}

function resolveMaskContentBounds(
  maskContent: SceneNode,
  contentRendering: RenderMaskContentRendering,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const box = resolveMaskContentBoundsBox(maskContent, contentRendering);
  if (box === undefined) {
    throw new Error(`Mask source ${maskContent.id} has no measurable geometry for its SVG mask region`);
  }
  return { x: box.x, y: box.y, width: box.w, height: box.h };
}

function resolveMaskContentBoundsBox(
  maskContent: SceneNode,
  contentRendering: RenderMaskContentRendering,
): LocalBox | undefined {
  if (contentRendering === "source-paint") {
    return sceneNodeAuthoredLocalBoxRecursive(maskContent, IDENTITY_AFFINE);
  }
  return sceneNodeVisualLocalBoxRecursive(maskContent, IDENTITY_AFFINE);
}

function sceneNodeAuthoredLocalBoxRecursive(
  node: SceneNode,
  parentTransform: AffineMatrix2x3,
): LocalBox | undefined {
  if (node.visible === false) { return undefined; }
  const localBox = sceneNodeAuthoredLocalBox(node);
  if (localBox === undefined) {
    return undefined;
  }
  return transformLocalBox(localBox, composeAffine(parentTransform, node.transform));
}

function sceneNodeAuthoredLocalBox(node: SceneNode): LocalBox | undefined {
  const own = sceneNodeOwnIntrinsicLocalBox(node);
  if (node.type !== "frame" && node.type !== "group") {
    return own;
  }
  const childBoxes = node.children
    .map((child) => sceneNodeAuthoredLocalBoxRecursive(child, IDENTITY_AFFINE))
    .filter(isLocalBox);
  return mergeLocalBoxes([own, ...childBoxes].filter(isLocalBox));
}

function sceneNodeVisualLocalBoxRecursive(
  node: SceneNode,
  parentTransform: AffineMatrix2x3,
): LocalBox | undefined {
  if (node.visible === false) { return undefined; }
  const localBox = sceneNodeVisualLocalBox(node);
  if (localBox === undefined) {
    return undefined;
  }
  return transformLocalBox(localBox, composeAffine(parentTransform, node.transform));
}

function sceneNodeClipLocalBoxRecursive(
  node: SceneNode,
  parentTransform: AffineMatrix2x3,
): LocalBox | undefined {
  if (node.visible === false) { return undefined; }
  const localBox = sceneNodeClipLocalBox(node);
  if (localBox === undefined) {
    return undefined;
  }
  return transformLocalBox(localBox, composeAffine(parentTransform, node.transform));
}

function sceneNodeClipLocalBox(node: SceneNode): LocalBox | undefined {
  const own = sceneNodeClipIntrinsicLocalBox(node);
  if (node.type !== "frame" && node.type !== "group") {
    return own;
  }
  const childBoxes = node.children
    .map((child) => sceneNodeClipLocalBoxRecursive(child, IDENTITY_AFFINE))
    .filter(isLocalBox);
  return mergeLocalBoxes([own, ...childBoxes].filter(isLocalBox));
}

function sceneNodeClipIntrinsicLocalBox(node: SceneNode): LocalBox | undefined {
  const own = sceneNodeOwnIntrinsicLocalBox(node);
  const stroke = sceneNodeClipStrokeLocalBox(node);
  return mergeLocalBoxes([own, stroke].filter(isLocalBox));
}

function sceneNodeVisualLocalBox(node: SceneNode): LocalBox | undefined {
  const own = sceneNodeVisualIntrinsicLocalBox(node);
  if (node.type !== "frame" && node.type !== "group") {
    return own === undefined ? undefined : sceneNodeLocalBoxWithEffects(node, own);
  }
  const childBoxes = node.children
    .map((child) => sceneNodeVisualLocalBoxRecursive(child, IDENTITY_AFFINE))
    .filter(isLocalBox);
  const merged = mergeLocalBoxes([own, ...childBoxes].filter(isLocalBox));
  return merged === undefined ? undefined : sceneNodeLocalBoxWithEffects(node, merged);
}

function sceneNodeLocalBoxWithEffects(node: SceneNode, box: LocalBox): LocalBox {
  const effectBounds = resolveEffectBounds(node.effects, { x: box.x, y: box.y, width: box.w, height: box.h });
  return { x: effectBounds.x, y: effectBounds.y, w: effectBounds.width, h: effectBounds.height };
}

function sceneNodeVisualIntrinsicLocalBox(node: SceneNode): LocalBox | undefined {
  const own = sceneNodeOwnIntrinsicLocalBox(node);
  const stroke = sceneNodeStrokeLocalBox(node);
  return mergeLocalBoxes([own, stroke].filter(isLocalBox));
}

function sceneNodeClipStrokeLocalBox(node: SceneNode): LocalBox | undefined {
  if (node.type !== "path") {
    return sceneNodeStrokeLocalBox(node);
  }
  if (node.stroke?.align === "INSIDE") {
    return undefined;
  }
  return sceneNodeStrokeLocalBox(node);
}

function sceneNodeOwnIntrinsicLocalBox(node: SceneNode): LocalBox | undefined {
  switch (node.type) {
    case "frame":
    case "rect":
    case "image":
    case "text":
      return { x: 0, y: 0, w: node.width, h: node.height };
    case "ellipse":
      return { x: node.cx - node.rx, y: node.cy - node.ry, w: node.rx * 2, h: node.ry * 2 };
    case "path": {
      const bbox = pathContoursBoundingBox(node.contours);
      if (bbox) {
        return { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h };
      }
      if (node.width !== undefined && node.height !== undefined) {
        return { x: 0, y: 0, w: node.width, h: node.height };
      }
      return undefined;
    }
    case "group":
      return undefined;
  }
}

function sceneNodeStrokeLocalBox(node: SceneNode): LocalBox | undefined {
  switch (node.type) {
    case "frame":
    case "rect": {
      const own = { x: 0, y: 0, w: node.width, h: node.height };
      return expandBoxForMaskStroke(own, node.stroke, node.individualStrokeWeights);
    }
    case "ellipse": {
      const own = { x: node.cx - node.rx, y: node.cy - node.ry, w: node.rx * 2, h: node.ry * 2 };
      return expandBoxForMaskStroke(own, node.stroke, undefined);
    }
    case "path": {
      const strokeBox = node.strokeContours === undefined ? undefined : pathContoursBoundingBox(node.strokeContours);
      if (strokeBox !== undefined) {
        return { x: strokeBox.x, y: strokeBox.y, w: strokeBox.w, h: strokeBox.h };
      }
      const own = sceneNodeOwnIntrinsicLocalBox(node);
      if (own === undefined) {
        return undefined;
      }
      return expandBoxForMaskStroke(own, node.stroke, undefined);
    }
    case "image":
    case "text":
    case "group":
      return undefined;
  }
}

function expandBoxForMaskStroke(
  box: LocalBox,
  stroke: Stroke | undefined,
  individualStrokeWeights: FrameNode["individualStrokeWeights"] | undefined,
): LocalBox | undefined {
  if (stroke === undefined) {
    return undefined;
  }
  if (individualStrokeWeights !== undefined) {
    return expandBoxByOutsets(box, {
      top: strokeOutset(individualStrokeWeights.top, stroke.align),
      right: strokeOutset(individualStrokeWeights.right, stroke.align),
      bottom: strokeOutset(individualStrokeWeights.bottom, stroke.align),
      left: strokeOutset(individualStrokeWeights.left, stroke.align),
    });
  }
  const outset = strokeOutset(stroke.width, stroke.align);
  return expandBoxByOutsets(box, { top: outset, right: outset, bottom: outset, left: outset });
}

function strokeOutset(width: number, align: Stroke["align"]): number {
  if (width <= 0) {
    return 0;
  }
  switch (align) {
    case "INSIDE":
      return 0;
    case "OUTSIDE":
      return width;
    case "CENTER":
    case undefined:
      return width / 2;
  }
}

function expandBoxByOutsets(
  box: LocalBox,
  outsets: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number },
): LocalBox | undefined {
  if (outsets.top === 0 && outsets.right === 0 && outsets.bottom === 0 && outsets.left === 0) {
    return undefined;
  }
  return {
    x: box.x - outsets.left,
    y: box.y - outsets.top,
    w: box.w + outsets.left + outsets.right,
    h: box.h + outsets.top + outsets.bottom,
  };
}

// =============================================================================
// Resolve background blur
// =============================================================================

/**
 * Extract background blur effect from a node's effects and produce
 * a RenderBackgroundBlur instruction with a clip path.
 *
 * Background blur cannot be expressed as an SVG filter — it requires
 * foreignObject + CSS backdrop-filter, clipped to the node's shape.
 *
 * The `shape` parameter controls the clip geometry and is required so
 * the backdrop-filter is clipped to the visible outline.
 */
function resolveBackgroundBlur(
  effectStack: ResolvedEffectStack,
  bounds: { x: number; y: number; width: number; height: number },
  ids: IdGenerator,
  defs: RenderDef[],
  shape: ClipPathShape,
): RenderBackgroundBlur | undefined {
  const bgBlur = effectStack.backgroundBlur;
  if (!bgBlur || bgBlur.radius <= 0) {
    return undefined;
  }

  const backdropBounds = {
    x: bounds.x - bgBlur.radius,
    y: bounds.y - bgBlur.radius,
    width: bounds.width + bgBlur.radius * 2,
    height: bounds.height + bgBlur.radius * 2,
  };

  // CSS clip-path inside foreignObject resolves in the foreignObject's
  // local coordinate space, so shift the Kiwi node-local shape by the
  // backdrop sampling origin. This matches Figma's exported
  // `bgblur_*_clip_path` structure without duplicating shape geometry.
  const clipId = ids.getNextId("bg-blur-clip");
  defs.push({
    type: "clip-path",
    id: clipId,
    shape,
    transform: matrixToSvgTransform({
      m00: 1,
      m01: 0,
      m02: -backdropBounds.x,
      m10: 0,
      m11: 1,
      m12: -backdropBounds.y,
    }),
    transformProjection: "preserve",
  });

  return {
    stdDeviation: resolveFigmaBlurStdDeviation(bgBlur.radius),
    clipId,
    backdropBounds,
  };
}

// =============================================================================
// Resolve fill and collect defs
// =============================================================================

function resolveFillResult(
  fill: Fill,
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: ResolvedFigmaRenderExportSettings,
): ResolvedFillResult {
  const resolved = resolveFillWithRenderSettings(fill, ids, exportSettings);
  collectFillDef(resolved, defs);
  return {
    attrs: resolved.attrs,
    def: resolved.def,
    // Carry paint-level blendMode through so single-fill rendering
    // (formatRectShape / formatEllipseShape) can emit the correct
    // `mix-blend-mode` style. Multi-fill already flows through
    // `ResolvedFillLayer`'s own blendMode.
    blendMode: fill.blendMode,
  };
}

function resolveTopFillResult(
  fills: readonly Fill[],
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: ResolvedFigmaRenderExportSettings,
): ResolvedFillResult {
  const resolved = resolveTopFillWithRenderSettings(fills, ids, exportSettings);
  collectFillDef(resolved, defs);
  // When topmost fill gets used here (single-visible path), preserve
  // its paint-level blend mode too — the fills array may still have
  // only one visible entry but that entry could be e.g. OVERLAY.
  const topVisible = fills.find((f) => f.opacity !== 0);
  return {
    attrs: resolved.attrs,
    def: resolved.def,
    blendMode: topVisible?.blendMode,
  };
}

function resolveFrameBackgroundFill(
  hasFills: boolean,
  fills: readonly Fill[],
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: ResolvedFigmaRenderExportSettings,
): ResolvedFillResult {
  if (!hasFills) { return { attrs: { fill: "none" as const } }; }
  return resolveFillResult(fills[fills.length - 1], ids, defs, exportSettings);
}

/**
 * Resolve all fills in the array as stacked fill layers.
 * Returns undefined if there are fewer than 2 fills (no multi-paint needed).
 * Fills are ordered bottom-to-top (first fill = bottommost layer).
 */
function resolveAllFillLayers(
  fills: readonly Fill[],
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: ResolvedFigmaRenderExportSettings,
): readonly ResolvedFillLayer[] | undefined {
  if (fills.length < 2) { return undefined; }

  const layers: ResolvedFillLayer[] = [];
  for (const fill of fills) {
    const resolved = resolveFillWithRenderSettings(fill, ids, exportSettings);
    collectFillDef(resolved, defs);
    layers.push({
      attrs: resolved.attrs,
      def: resolved.def,
      blendMode: fill.blendMode,
    });
  }
  return layers;
}

function collectFillDef(resolved: ResolvedFill, defs: RenderDef[]): void {
  if (!resolved.def) { return; }
  switch (resolved.def.type) {
    case "linear-gradient":
      defs.push({ type: "linear-gradient", def: resolved.def });
      break;
    case "radial-gradient":
      defs.push({ type: "radial-gradient", def: resolved.def });
      break;
    case "angular-gradient":
      defs.push({ type: "angular-gradient", def: resolved.def });
      break;
    case "diamond-gradient":
      defs.push({ type: "diamond-gradient", def: resolved.def });
      break;
    case "image":
      defs.push({ type: "pattern", def: resolved.def });
      break;
  }
}

/**
 * Collect a gradient def from a ResolvedFillDef (used by stroke layers).
 */
function collectGradientDef(def: ResolvedFill["def"], defs: RenderDef[]): void {
  if (!def) { return; }
  // Reuse the same logic as collectFillDef
  collectFillDef({ attrs: { fill: "none" }, def }, defs);
}

type StrokePlacement =
  | {
      readonly kind: "source-shape";
      readonly maskShape: ClipPathShape;
    }
  | {
      readonly kind: "precomputed-geometry";
      readonly paths: readonly RenderPathContour[];
      readonly maskShape: ClipPathShape;
    }
  | {
      readonly kind: "kiwi-stroke-centerline";
    };

/**
 * Resolve a Stroke to a StrokeRendering instruction.
 *
 * Determines the rendering mode from the stroke data:
 * - layers (multi-paint) → mode:"layers"
 * - strokeAlign INSIDE/OUTSIDE → mode:"masked" (mask def is added)
 * - otherwise → mode:"uniform"
 *
 * Individual stroke weights are handled separately at the node level
 * (Frame/Rect with individualStrokeWeights).
 */
function resolveStrokeRendering(
  stroke: Stroke | undefined,
  ids: IdGenerator,
  defs: RenderDef[],
  /** Shape descriptor for non-uniform stroke modes */
  shape: StrokeShape,
  placement: StrokePlacement,
): StrokeRendering | undefined {
  if (stroke === undefined) {
    return undefined;
  }
  const result = resolveStrokeResult(stroke, ids);

  // Collect gradient defs from any layer up-front so both the "layers"
  // path and the "masked" path below see the <linearGradient> / mask def
  // in the parent's defs array.
  if (result.layers) {
    for (const layer of result.layers) {
      if (layer.gradientDef) {
        collectGradientDef(layer.gradientDef, defs);
      }
    }
  }

  if (placement.kind === "kiwi-stroke-centerline") {
    return resolveCenterlineStrokeRendering(result, shape);
  }

  if (placement.kind === "precomputed-geometry") {
    return resolvePrecomputedStrokeGeometry(result, ids, defs, placement);
  }

  // True multi-paint stroke (two or more visible paints stacked): render
  // as layered <use> elements so each paint gets its own blend mode. One
  // layer is not "multi-paint" — it's a single paint that happens to
  // need a gradient def, and should still participate in the strokeAlign
  // mask machinery below.
  if (result.layers && result.layers.length >= 2) {
    return { mode: "layers", layers: result.layers, shape };
  }

  // INSIDE/OUTSIDE stroke → masked. Single-layer gradient strokes flow
  // through here too, which means the stroke attrs already point at the
  // gradient url(#lg-N) from the collected def above.
  if (result.attrs.strokeAlign) {
    const maskId = ids.getNextId("stroke-mask");
    defs.push({ type: "stroke-mask", id: maskId, shape: placement.maskShape, strokeAlign: result.attrs.strokeAlign });
    // The single-layer branch in resolveStrokeResult forwards a layer with
    // its paint blendMode when the paint is a non-default blend (e.g. a
    // SOFT_LIGHT-blended white outline with strokeAlign=INSIDE). Pull that
    // blendMode through onto the masked result so the formatter can wrap
    // the stroke draw in `style="mix-blend-mode:..."` — without this
    // pass-through the masked path would silently discard the blend.
    const layer = result.layers && result.layers.length === 1 ? result.layers[0] : undefined;
    return { mode: "masked", attrs: result.attrs, maskId, shape, blendMode: layer?.blendMode, layer };
  }

  // Single-layer gradient without strokeAlign — emit as a regular
  // "layers" rendering so the gradient fill is still attached to the
  // stroke. Without this branch a single-layer gradient with CENTER
  // alignment would resolve to "uniform" and lose the gradient.
  if (result.layers && result.layers.length === 1) {
    return { mode: "layers", layers: result.layers, shape };
  }

  // Uniform stroke
  return { mode: "uniform", attrs: result.attrs };
}

function resolvePrecomputedStrokeGeometry(
  result: ReturnType<typeof resolveStrokeResult>,
  ids: IdGenerator,
  defs: RenderDef[],
  placement: Extract<StrokePlacement, { readonly kind: "precomputed-geometry" }>,
): StrokeRendering {
  const mask = resolvePrecomputedStrokeGeometryMask(result.attrs, ids, defs, placement.maskShape);
  return {
    mode: "geometry",
    paths: placement.paths,
    layers: resolvePrecomputedStrokeGeometryLayers(result),
    mask,
  };
}

function resolvePrecomputedStrokeGeometryMask(
  attrs: ResolvedStrokeAttrs,
  ids: IdGenerator,
  defs: RenderDef[],
  maskShape: ClipPathShape,
): Extract<StrokeRendering, { readonly mode: "geometry" }>["mask"] {
  if (attrs.strokeAlign === undefined) {
    return undefined;
  }
  const id = ids.getNextId("stroke-mask");
  defs.push({ type: "stroke-mask", id, shape: maskShape, strokeAlign: attrs.strokeAlign });
  return { id, shape: maskShape, strokeAlign: attrs.strokeAlign };
}

function resolvePrecomputedStrokeGeometryLayers(
  result: ReturnType<typeof resolveStrokeResult>,
): readonly ResolvedStrokeLayer[] {
  if (result.layers !== undefined && result.layers.length > 0) {
    return result.layers;
  }
  return [{ attrs: result.attrs }];
}

function centerStrokeLayer(layer: ResolvedStrokeLayer): ResolvedStrokeLayer {
  return {
    ...layer,
    attrs: centerStrokeAttrs(layer.attrs),
  };
}

function resolveCenterlineStrokeRendering(
  result: ResolvedStrokeResult,
  shape: StrokeShape,
): StrokeRendering {
  const layers = result.layers?.map(centerStrokeLayer) ?? [{ attrs: centerStrokeAttrs(result.attrs) }];
  return { mode: "layers", layers, shape };
}

function centerStrokeAttrs(attrs: ResolvedStrokeAttrs): ResolvedStrokeAttrs {
  return {
    stroke: attrs.stroke,
    strokeWidth: attrs.strokeWidth / 2,
    strokeOpacity: attrs.strokeOpacity,
    strokeLinecap: attrs.strokeLinecap,
    strokeLinejoin: attrs.strokeLinejoin,
    strokeDasharray: attrs.strokeDasharray,
  };
}

// =============================================================================
// Node Resolvers
// =============================================================================

function resolveGroupNode(
  node: GroupNode,
  ids: IdGenerator,
  exportSettings: ResolvedFigmaRenderExportSettings,
  resolvedChildren: readonly RenderNode[] | undefined = undefined,
): RenderGroupNode {
  const defs: RenderDef[] = [];
  const { wrapper } = resolveWrapper(node, ids, defs);

  const children = resolvedChildren ?? resolveChildren(node.children, ids, exportSettings);
  const mask = resolveMask(node, ids, defs, exportSettings);
  const childClipId = resolveGroupChildClipId(node, ids, defs);

  return {
    type: "group",
    id: node.id,
    wrapper,
    defs,
    source: node,
    children,
    childClipId,
    mask,
    canUnwrapSingleChild:
      !wrapper.transform && (node.opacity >= 1) && !wrapper.filterAttr && !mask && !wrapper.blendMode && !childClipId,
  };
}

function requiresRenderWrapper(input: {
  readonly wrapper: ResolvedWrapperAttrs;
  readonly opacity: number;
  readonly reasons: readonly boolean[];
}): boolean {
  if (input.wrapper.transform !== undefined) {
    return true;
  }
  if (input.opacity < 1) {
    return true;
  }
  if (input.wrapper.filterAttr !== undefined) {
    return true;
  }
  return input.reasons.some((reason) => reason);
}

function resolveFrameNode(
  node: FrameNode,
  ids: IdGenerator,
  exportSettings: ResolvedFigmaRenderExportSettings,
  resolvedChildren: readonly RenderNode[] | undefined = undefined,
): RenderFrameNode {
  const defs: RenderDef[] = [];
  const { wrapper, effectStack } = resolveFrameWrapper(node, ids, defs);
  const clampedRadius = clampCornerRadius(node.cornerRadius, node.width, node.height);
  const surfaceBounds = sceneClipElementBounds(node.surfaceShape);
  const surfaceFilterAttr = resolveFrameSurfaceFilterAttr(effectStack.foregroundEffects, ids, defs, surfaceBounds);
  const surfaceShape = sceneClipToFrameSurfaceShape(node.surfaceShape);
  const surfaceClipShape = sceneClipToClipPathShape(node.surfaceShape);

  // Background fill and stroke — resolved independently.
  const hasFills = node.fills.length > 0;

  const strokeRendering = resolveFrameStrokeRendering(node, surfaceShape, ids, defs, surfaceClipShape);
  const background = resolveFrameBackground(node, hasFills, strokeRendering, surfaceFilterAttr, ids, defs, exportSettings);
  const children = resolvedChildren ?? resolveChildren(node.children, ids, exportSettings);
  const childClipId = resolveFrameChildClipId(node, children, ids, defs, clampedRadius);

  // Finalize surface paint coordinates using the actual Kiwi surface,
  // not the frame's logical layout size. Crop-like FRAME surfaces can
  // carry a path smaller than node.width/node.height; Figma resolves
  // those paint transforms against that visible surface bbox.
  finalizeDefs(defs, surfaceBounds, exportSettings);

  // Background blur (foreignObject + backdrop-filter, separate from filter
  // pipeline). Pass the FRAME's rounded-rect shape so the backdrop clip
  // honours cornerRadius (otherwise a rounded FRAME with background blur
  // would show a square blur area bleeding past the rounded corners).
  const backgroundBlur = resolveBackgroundBlur(
    effectStack, surfaceBounds, ids, defs,
    surfaceClipShape,
  );

  const mask = resolveMask(node, ids, defs, exportSettings);

  return {
    type: "frame",
    id: node.id,
    wrapper,
    defs,
    source: node,
    background,
    children,
    childClipId,
    width: node.width,
    height: node.height,
    surfaceShape,
    cornerRadius: clampedRadius,
    cornerSmoothing: node.cornerSmoothing,
    backgroundBlur,
    mask,
    // Surface source fills/stroke at the RenderNode level so WebGL / other
    // backends never discriminate `node.source.type` — consistent with
    // RenderRectNode / RenderEllipseNode.
    sourceFills: node.fills,
    sourceStroke: node.stroke,
    sourceSurfaceShape: node.surfaceShape,
  };
}

function resolveRectNode(node: RectNode, ids: IdGenerator, exportSettings: ResolvedFigmaRenderExportSettings): RenderRectNode {
  const defs: RenderDef[] = [];
  const { wrapper, effectStack, filterSource } = resolveWrapper(node, ids, defs);
  const clampedRadius = clampCornerRadius(node.cornerRadius, node.width, node.height);
  const fillResult = resolveTopFillResult(node.fills, ids, defs, exportSettings);
  const fillLayers = resolveAllFillLayers(node.fills, ids, defs, exportSettings);
  const maskClipShape = buildClipShape(node.width, node.height, clampedRadius, node.cornerSmoothing);
  const rectStrokeShape: StrokeShape = { kind: "rect", width: node.width, height: node.height, cornerRadius: clampedRadius, cornerSmoothing: node.cornerSmoothing };
  const strokeRendering = resolveStrokeRendering(node.stroke, ids, defs, rectStrokeShape, { kind: "source-shape", maskShape: maskClipShape });

  finalizeDefs(defs, { x: 0, y: 0, width: node.width, height: node.height }, exportSettings);

  const backgroundBlur = resolveBackgroundBlur(
    effectStack, { x: 0, y: 0, width: node.width, height: node.height }, ids, defs,
    maskClipShape,
  );

  const mask = resolveMask(node, ids, defs, exportSettings);
  const needsWrapper = requiresRenderWrapper({
    wrapper,
    opacity: node.opacity,
    reasons: [
      defs.length > 0,
      fillLayers !== undefined,
      strokeRendering !== undefined,
      backgroundBlur !== undefined,
      mask !== undefined,
    ],
  });

  return {
    type: "rect",
    id: node.id,
    wrapper,
    filterSource,
    defs,
    source: node,
    width: node.width,
    height: node.height,
    cornerRadius: clampedRadius,
    cornerSmoothing: node.cornerSmoothing,
    fill: fillResult,
    fillLayers,
    strokeRendering,
    needsWrapper,
    sourceFills: node.fills,
    sourceStroke: node.stroke,
    backgroundBlur,
    mask,
  };
}

function resolveEllipseNode(node: EllipseNode, ids: IdGenerator, exportSettings: ResolvedFigmaRenderExportSettings): RenderEllipseNode | RenderPathNode {
  const defs: RenderDef[] = [];
  const { wrapper, effectStack, filterSource } = resolveWrapper(node, ids, defs);
  const fillResult = resolveTopFillResult(node.fills, ids, defs, exportSettings);
  const fillLayers = resolveAllFillLayers(node.fills, ids, defs, exportSettings);
  const ellipseStrokeShape: StrokeShape = { kind: "ellipse", cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry };
  // INSIDE/OUTSIDE stroke needs an ellipse-shaped mask to clip the doubled
  // stroke width to the correct half. Without this, an INSIDE stroke bleeds
  // outside the ellipse (the user's PFP case — avatar stroke appeared
  // to clip the circle) and an OUTSIDE stroke appears centred.
  const ellipseMaskShape: ClipPathShape = {
    kind: "ellipse", cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry,
  };
  const strokeRendering = resolveStrokeRendering(node.stroke, ids, defs, ellipseStrokeShape, { kind: "source-shape", maskShape: ellipseMaskShape });

  const ellipseSize = { width: node.rx * 2, height: node.ry * 2 };
  const ellipseBounds = { x: 0, y: 0, ...ellipseSize };

  // Pass ellipse shape so the backdrop-filter is clipped to the actual
  // ellipse silhouette, not a rect. Otherwise an ELLIPSE with a
  // background-blur effect renders as a square blur area
  // (user-reported ELLIPSE "Container" bug).
  const backgroundBlur = resolveBackgroundBlur(
    effectStack, { x: 0, y: 0, ...ellipseSize }, ids, defs,
    ellipseMaskShape,
  );
  const mask = resolveMask(node, ids, defs, exportSettings);

  // If arc data is present, resolve as a path node
  if (node.arcData) {
    const d = buildEllipseArcPathD(node.cx, node.cy, node.rx, node.ry, node.arcData);
    const paths: RenderPathContour[] = [{ d, fillRule: "evenodd" }];
    finalizeDefs(defs, ellipseBounds, exportSettings);
    const needsWrapper = requiresRenderWrapper({
      wrapper,
      opacity: node.opacity,
      reasons: [
        defs.length > 0,
        fillLayers !== undefined,
        strokeRendering !== undefined,
        backgroundBlur !== undefined,
        mask !== undefined,
      ],
    });
    return {
      type: "path",
      id: node.id,
      wrapper,
      filterSource,
      defs,
      source: node,
      paths,
      fill: fillResult,
      fillLayers,
      strokeRendering,
      needsWrapper,
      sourceContours: [],
      sourceFills: node.fills,
      sourceStroke: node.stroke,
      backgroundBlur,
      mask,
    };
  }

  finalizeDefs(defs, ellipseBounds, exportSettings);
  const needsWrapper = requiresRenderWrapper({
    wrapper,
    opacity: node.opacity,
    reasons: [
      defs.length > 0,
      fillLayers !== undefined,
      strokeRendering !== undefined,
      backgroundBlur !== undefined,
      mask !== undefined,
    ],
  });

  return {
    type: "ellipse",
    id: node.id,
    wrapper,
    filterSource,
    defs,
    source: node,
    cx: node.cx,
    cy: node.cy,
    rx: node.rx,
    ry: node.ry,
    fill: fillResult,
    fillLayers,
    strokeRendering,
    needsWrapper,
    sourceFills: node.fills,
    sourceStroke: node.stroke,
    backgroundBlur,
    mask,
  };
}

function resolvePathNode(node: PathNode, ids: IdGenerator, exportSettings: ResolvedFigmaRenderExportSettings): RenderPathNode {
  const defs: RenderDef[] = [];
  const { wrapper, effectStack, filterSource } = resolveWrapper(node, ids, defs);
  const fillResult = resolveTopFillResult(node.fills, ids, defs, exportSettings);
  const fillLayers = resolveAllFillLayers(node.fills, ids, defs, exportSettings);

  const sourcePaths = resolveRenderPathContours(node.contours, ids, defs, exportSettings);
  const centerlinePaths = resolveStrokeCenterlinePathContours(node);
  const strokeGeometryPaths = centerlinePaths === undefined ? resolveStrokeGeometryPathContours(node.strokeContours) : undefined;
  const paths = sourcePaths;

  const pathStrokeShape = resolvePathStrokeShape(node, paths, centerlinePaths);
  // INSIDE/OUTSIDE stroke needs a shape-matching mask; for paths the mask
  // uses the same contour data drawn as a clip-path (so the doubled
  // stroke width is clipped to the correct side of the path).
  const pathMaskShape: ClipPathShape = {
    kind: "path",
    d: sourcePaths.map((p) => p.d).join(" "),
    fillRule: resolveRenderPathContoursFillRule(sourcePaths),
  };
  const strokePlacement = resolvePathStrokePlacement(strokeGeometryPaths, centerlinePaths, pathMaskShape, pathStrokeShape);
  const strokeRendering = resolveStrokeRendering(node.stroke, ids, defs, pathStrokeShape, strokePlacement);

  // For VECTOR / boolean-op paths the contour origin in node-local
  // coordinates can be offset from (0, 0) — Figma's vector network
  // anchors the path at its own bbox, not the node's. The gradient's
  // userSpaceOnUse coordinates need that anchor so a linear gradient
  // running 0→1 in paint-space maps onto the path's actual extent
  // (e.g. world-map-style dots: their gradient should colour
  // the visible continents, not an off-frame region above the path).
  const pathBounds = resolvePathBounds(node);
  if (pathBounds) {
    finalizeDefs(defs, pathBounds, exportSettings);
  }

  // Pass path shape so backdrop-filter clips to the actual contour, not
  // the node's bounding rect (matches ELLIPSE/FRAME behaviour).
  const backgroundBlur = resolveOptionalBackgroundBlur(effectStack, pathBounds, ids, defs, pathMaskShape);
  const mask = resolveMask(node, ids, defs, exportSettings);

  const needsWrapper = requiresRenderWrapper({
    wrapper,
    opacity: node.opacity,
    reasons: [
      defs.length > 0,
      paths.length > 1,
      fillLayers !== undefined,
      strokeRendering !== undefined,
      backgroundBlur !== undefined,
      mask !== undefined,
    ],
  });

  return {
    type: "path",
    id: node.id,
    wrapper,
    filterSource,
    defs,
    source: node,
    paths,
    fill: fillResult,
    fillLayers,
    strokeRendering,
    needsWrapper,
    sourceContours: node.contours,
    sourceFills: node.fills,
    sourceStroke: node.stroke,
    backgroundBlur,
    mask,
  };
}

function resolveRenderPathContours(
  contours: readonly PathContour[],
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: ResolvedFigmaRenderExportSettings,
): readonly RenderPathContour[] {
  return contours.map((contour) => {
    const base: RenderPathContour = {
      d: contourToSvgD(contour, RENDER_PATH_PRECISION),
      fillRule: resolveRenderPathFillRule(contour),
    };
    if (contour.fillOverride) {
      const overrideFill = resolveFillResult(contour.fillOverride, ids, defs, exportSettings);
      return { ...base, fillOverride: overrideFill };
    }
    return base;
  });
}

function resolveStrokeGeometryPathContours(
  contours: readonly PathContour[] | undefined,
): readonly RenderPathContour[] | undefined {
  if (contours === undefined || contours.length === 0) {
    return undefined;
  }
  return contours.map((contour) => ({
    d: contourToSvgD(contour, RENDER_PATH_PRECISION),
    fillRule: resolveRenderPathFillRule(contour),
  }));
}

function resolveRenderPathFillRule(contour: PathContour): RenderPathContour["fillRule"] {
  if (contour.windingRule === "nonzero") {
    return undefined;
  }
  return contour.windingRule;
}

function resolvePathContoursFillRule(contours: readonly PathContour[]): RenderPathContour["fillRule"] {
  if (contours.some((contour) => contour.windingRule === "evenodd")) {
    return "evenodd";
  }
  return undefined;
}

function resolveRenderPathContoursFillRule(paths: readonly RenderPathContour[]): RenderPathContour["fillRule"] {
  if (paths.some((path) => path.fillRule === "evenodd")) {
    return "evenodd";
  }
  return undefined;
}

function resolvePathStrokePlacement(
  strokeGeometryPaths: readonly RenderPathContour[] | undefined,
  centerlinePaths: readonly RenderPathContour[] | undefined,
  maskShape: ClipPathShape,
  strokeShape: StrokeShape,
): StrokePlacement {
  if (centerlinePaths !== undefined) {
    return { kind: "kiwi-stroke-centerline" };
  }
  if (strokeShape.kind === "rect") {
    return { kind: "source-shape", maskShape };
  }
  if (strokeGeometryPaths !== undefined) {
    return resolveStrokeGeometryPlacement(strokeGeometryPaths, maskShape);
  }
  return { kind: "source-shape", maskShape };
}

function resolveStrokeGeometryPlacement(
  strokeGeometryPaths: readonly RenderPathContour[],
  maskShape: ClipPathShape,
): StrokePlacement {
  return { kind: "precomputed-geometry", paths: strokeGeometryPaths, maskShape };
}

function resolveStrokeCenterlinePathContours(node: PathNode): readonly RenderPathContour[] | undefined {
  return resolveInsideStrokeGeometryCenterlinePathContours(node) ?? resolveOutsideStrokeAlignedPathContours(node);
}

function resolveInsideStrokeGeometryCenterlinePathContours(node: PathNode): readonly RenderPathContour[] | undefined {
  const stroke = node.stroke;
  if (stroke?.align !== "INSIDE") {
    return undefined;
  }
  if (node.contours.length !== 1 || node.strokeContours?.length !== 1) {
    return undefined;
  }
  const contour = node.contours[0];
  if (contour.windingRule !== "nonzero" || contour.fillOverride !== undefined) {
    return undefined;
  }
  const centerlineCommands = buildStrokeGeometryBackedInsideStrokeCenterlineCommands(
    contour.commands,
    node.strokeContours[0].commands,
    stroke.width,
  );
  if (centerlineCommands === undefined) {
    return undefined;
  }
  return [{
    d: contourToSvgD({ commands: centerlineCommands }, STROKE_GEOMETRY_CENTERLINE_PATH_PRECISION),
  }];
}

function resolveOutsideStrokeAlignedPathContours(node: PathNode): readonly RenderPathContour[] | undefined {
  const stroke = node.stroke;
  if (stroke?.align !== "OUTSIDE") {
    return undefined;
  }
  if (node.contours.length !== 1) {
    return undefined;
  }
  const contour = node.contours[0];
  if (contour.windingRule !== "nonzero" || contour.fillOverride !== undefined) {
    return undefined;
  }
  const alignedCommands = resolveOutsideStrokeAlignedPathCommands(
    contour.commands,
    node.strokeContours,
    stroke.width / 2,
  );
  if (alignedCommands === undefined) {
    return undefined;
  }
  return [{
    d: contourToSvgD({ commands: alignedCommands }, RENDER_PATH_PRECISION),
  }];
}

function resolveOutsideStrokeAlignedPathCommands(
  commands: PathContour["commands"],
  strokeContours: readonly PathContour[] | undefined,
  offsetDistance: number,
): readonly PathCommand[] | undefined {
  if (strokeContours === undefined) {
    return buildStrokeAlignedClosedPathCommands(
      commands,
      offsetDistance,
      { flattenTolerance: STROKE_ALIGNED_PATH_FLATTEN_TOLERANCE },
    );
  }
  if (strokeContours.length !== 1) {
    return undefined;
  }
  return buildStrokeGeometryBackedOutsideStrokeCenterlineCommands(
    commands,
    strokeContours[0].commands,
    offsetDistance,
    { flattenTolerance: STROKE_ALIGNED_PATH_FLATTEN_TOLERANCE },
  );
}

function resolvePathStrokeShape(
  node: PathNode,
  paths: readonly RenderPathContour[],
  centerlinePaths: readonly RenderPathContour[] | undefined,
): StrokeShape {
  if (centerlinePaths !== undefined) {
    return { kind: "path", paths: centerlinePaths };
  }
  if (node.cornerRadius !== undefined && typeof node.width === "number" && typeof node.height === "number") {
    return {
      kind: "rect",
      width: node.width,
      height: node.height,
      cornerRadius: node.cornerRadius,
      cornerSmoothing: node.cornerSmoothing,
    };
  }
  return { kind: "path", paths };
}

function resolveTextNode(node: TextNode, ids: IdGenerator, exportSettings: ResolvedFigmaRenderExportSettings): RenderTextNode {
  const defs: RenderDef[] = [];
  const { wrapper } = resolveWrapper(node, ids, defs);
  const baseRun = node.runs[0];
  const fillColor = baseRun?.fillColor ?? "#000000";
  const fillOpacity = baseRun !== undefined && baseRun.fillOpacity < 1 ? baseRun.fillOpacity : undefined;

  const textClipId = resolveTextClipId(node, ids, defs);
  const content = resolveTextContent(node);

  const mask = resolveMask(node, ids, defs, exportSettings);

  return {
    type: "text",
    id: node.id,
    wrapper,
    defs,
    source: node,
    width: node.width,
    height: node.height,
    fillColor,
    fillOpacity,
    textClipId,
    textTruncation: node.textTruncation,
    leadingTrim: node.leadingTrim,
    hyperlink: node.hyperlink,
    content,
    sourceGlyphContours: node.glyphContours,
    sourceDecorationContours: node.decorationContours,
    sourceFillColor: hexToSceneColor(fillColor),
    sourceFillOpacity: baseRun?.fillOpacity ?? 0,
    sourceTextLineLayout: node.textLineLayout,
    sourceTextAutoResize: node.textAutoResize,
    mask,
  };
}

function resolveImageNode(node: ImageNode, ids: IdGenerator, exportSettings: ResolvedFigmaRenderExportSettings): RenderImageNode {
  const defs: RenderDef[] = [];
  const { wrapper } = resolveWrapper(node, ids, defs);

  const dataUri = resolveImageDataUri(node);

  const mask = resolveMask(node, ids, defs, exportSettings);
  const needsWrapper = requiresRenderWrapper({
    wrapper,
    opacity: node.opacity,
    reasons: [mask !== undefined],
  });

  return {
    type: "image",
    id: node.id,
    wrapper,
    defs,
    source: node,
    width: node.width,
    height: node.height,
    dataUri,
    preserveAspectRatio: resolvePreserveAspectRatio(node.scaleMode),
    needsWrapper,
    sourceImageHash: node.imageHash,
    sourceData: node.data,
    sourceMimeType: node.mimeType,
    sourceScaleMode: node.scaleMode,
    sourceImageShouldColorManage: node.imageShouldColorManage,
    mask,
  };
}

/**
 * Convert Figma scaleMode to SVG preserveAspectRatio.
 */
function resolvePreserveAspectRatio(scaleMode: string): string {
  switch (scaleMode) {
    case "FIT":
      return "xMidYMid meet";
    case "FILL":
    case "CROP":
      return "xMidYMid slice";
    case "TILE":
      return "none";
    case "STRETCH":
      return "none";
    default:
      return "xMidYMid slice";
  }
}

// =============================================================================
// Node Dispatch
// =============================================================================

function resolveNode(node: SceneNode, ids: IdGenerator, exportSettings: ResolvedFigmaRenderExportSettings): RenderNode | null {
  if (!node.visible) {
    return null;
  }

  switch (node.type) {
    case "group":
      return resolveGroupNode(node, ids, exportSettings);
    case "frame":
      return resolveFrameNode(node, ids, exportSettings);
    case "rect":
      return resolveRectNode(node, ids, exportSettings);
    case "ellipse":
      return resolveEllipseNode(node, ids, exportSettings);
    case "path":
      return resolvePathNode(node, ids, exportSettings);
    case "text":
      return resolveTextNode(node, ids, exportSettings);
    case "image":
      return resolveImageNode(node, ids, exportSettings);
    default: {
      // Exhaustiveness check
      const _exhaustive: never = node;
      void _exhaustive;
      return null;
    }
  }
}

function resolveChildren(
  children: readonly SceneNode[],
  ids: IdGenerator,
  exportSettings: ResolvedFigmaRenderExportSettings,
): RenderNode[] {
  const result: RenderNode[] = [];
  for (const child of children) {
    const resolved = resolveNode(child, ids, exportSettings);
    if (resolved) {
      result.push(resolved);
    }
  }
  return result;
}

// =============================================================================
// Incremental resolution cache
// =============================================================================

type CachedRenderNode = {
  readonly source: SceneNode;
  readonly node: RenderNode;
};

export type RenderTreeResolutionCache = {
  readonly nodesById: ReadonlyMap<string, CachedRenderNode>;
  readonly rootChildren: readonly RenderNode[];
  readonly exportSettingsKey: RenderExportSettingsCacheKey;
};

export type RenderTreeResolutionResult = {
  readonly renderTree: RenderTree;
  readonly cache: RenderTreeResolutionCache;
};

function renderChildrenEqual(a: readonly RenderNode[], b: readonly RenderNode[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((node, index) => node === b[index]);
}

function cachedContainerChildren(node: RenderNode): readonly RenderNode[] | undefined {
  if (node.type === "group" || node.type === "frame") {
    return node.children;
  }
  return undefined;
}

function cacheReusableForExportSettings(
  previousCache: RenderTreeResolutionCache | undefined,
  cacheKey: RenderExportSettingsCacheKey,
): RenderTreeResolutionCache | undefined {
  if (previousCache === undefined) {
    return undefined;
  }
  if (previousCache.exportSettingsKey !== cacheKey) {
    return undefined;
  }
  return previousCache;
}

function cachedPreviousContainerChildren(previous: CachedRenderNode | undefined): readonly RenderNode[] | undefined {
  if (previous === undefined) {
    return undefined;
  }
  return cachedContainerChildren(previous.node);
}

function resolveContainerNodeIncremental(
  node: GroupNode | FrameNode,
  ids: IdGenerator,
  children: readonly RenderNode[],
  exportSettings: ResolvedFigmaRenderExportSettings,
): RenderGroupNode | RenderFrameNode {
  if (node.type === "group") {
    return resolveGroupNode(node, ids, exportSettings, children);
  }
  return resolveFrameNode(node, ids, exportSettings, children);
}

function shouldOmitViewportRootFrameChildClip(
  node: RenderFrameNode,
  viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  // SAFETY: a rounded-corner frame whose bounds match the viewport
  // CANNOT delegate its clipping to the viewport rect — the viewport
  // is always rectangular, so omitting the child clip drops the
  // rounded corner shape. (Event Card and any other top-level rounded
  // container exhibits this: top corners render square because the
  // viewport rect lets the gradient bleed into the corner-curve area.)
  // Honour Figma's semantics here: rounded clip MUST be applied.
  if (cornerRadiusScalar(node.cornerRadius) > 0) {
    return false;
  }
  return node.childClipId !== undefined
    && viewport.x === 0
    && viewport.y === 0
    && node.wrapper.transform === undefined
    && node.width === viewport.width
    && node.height === viewport.height;
}

function shouldReuseViewportRootChildClipMark(
  previousChild: RenderNode | undefined,
  child: RenderFrameNode,
): previousChild is RenderFrameNode {
  return previousChild?.type === "frame"
    && previousChild.omitChildClip === true
    && previousChild.id === child.id
    && previousChild.source === child.source
    && previousChild.childClipId === child.childClipId;
}

function markViewportRootChildClip(
  child: RenderNode,
  viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  previousChild: RenderNode | undefined,
): RenderNode {
  if (child.type !== "frame") {
    return child;
  }
  if (shouldOmitViewportRootFrameChildClip(child, viewport)) {
    return markViewportRootFrameClipAsViewportOwned(child, previousChild);
  }
  if (child.omitChildClip === true) {
    return { ...child, omitChildClip: undefined };
  }
  return child;
}

function markViewportRootFrameClipAsViewportOwned(
  child: RenderFrameNode,
  previousChild: RenderNode | undefined,
): RenderFrameNode {
  if (child.omitChildClip === true) {
    return child;
  }
  if (shouldReuseViewportRootChildClipMark(previousChild, child)) {
    return previousChild;
  }
  return { ...child, omitChildClip: true };
}

function markViewportRootChildClips(
  children: readonly RenderNode[],
  viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  previousChildren?: readonly RenderNode[],
): readonly RenderNode[] {
  const marked = children.map((child, index) => markViewportRootChildClip(child, viewport, previousChildren?.[index]));
  if (previousChildren && renderChildrenEqual(previousChildren, marked)) {
    return previousChildren;
  }
  if (renderChildrenEqual(children, marked)) {
    return children;
  }
  return marked;
}

function resolveNodeIncremental(
  node: SceneNode,
  ids: IdGenerator,
  previousCache: RenderTreeResolutionCache | undefined,
  nextNodesById: Map<string, CachedRenderNode>,
  exportSettings: ResolvedFigmaRenderExportSettings,
): RenderNode | null {
  if (!node.visible) {
    return null;
  }

  const previous = previousCache?.nodesById.get(node.id);

  if (previous?.source === node) {
    nextNodesById.set(node.id, previous);
    return previous.node;
  }

  if (node.type === "group" || node.type === "frame") {
    return resolveContainerNodeWithIncrementalChildren(node, ids, previous, previousCache, nextNodesById, exportSettings);
  }

  const resolved = resolveNode(node, ids, exportSettings);
  if (!resolved) {
    return null;
  }
  nextNodesById.set(node.id, { source: node, node: resolved });
  return resolved;
}

function resolveContainerNodeWithIncrementalChildren(
  node: GroupNode | FrameNode,
  ids: IdGenerator,
  previous: CachedRenderNode | undefined,
  previousCache: RenderTreeResolutionCache | undefined,
  nextNodesById: Map<string, CachedRenderNode>,
  exportSettings: ResolvedFigmaRenderExportSettings,
): RenderNode {
  const children = resolveChildrenIncremental(node.children, ids, previousCache, nextNodesById, exportSettings);
  const previousChildren = cachedPreviousContainerChildren(previous);
  if (previous === undefined || previousChildren === undefined || !renderChildrenEqual(previousChildren, children)) {
    const resolved = resolveContainerNodeIncremental(node, ids, children, exportSettings);
    nextNodesById.set(node.id, { source: node, node: resolved });
    return resolved;
  }
  nextNodesById.set(node.id, previous);
  return previous.node;
}

function resolveChildrenIncremental(
  children: readonly SceneNode[],
  ids: IdGenerator,
  previousCache: RenderTreeResolutionCache | undefined,
  nextNodesById: Map<string, CachedRenderNode>,
  exportSettings: ResolvedFigmaRenderExportSettings,
): RenderNode[] {
  const result: RenderNode[] = [];
  for (const child of children) {
    const resolved = resolveNodeIncremental(child, ids, previousCache, nextNodesById, exportSettings);
    if (resolved) {
      result.push(resolved);
    }
  }
  return result;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve a SceneGraph into a fully-resolved RenderTree.
 *
 * All rendering decisions (visibility filtering, attribute resolution,
 * clip path generation, def collection) are performed here. Backends
 * only format the result.
 */
export function resolveRenderTree(sceneGraph: SceneGraph, options?: SceneGraphRenderOptions): RenderTree {
  const ids = createRenderTreeIdGenerator();
  const exportSettings = resolveFigmaRenderExportSettings(options?.exportSettings);
  const viewport = sceneGraph.viewport ?? {
    x: 0,
    y: 0,
    width: sceneGraph.width,
    height: sceneGraph.height,
  };
  const children = markViewportRootChildClips(resolveChildren(sceneGraph.root.children, ids, exportSettings), viewport);

  return {
    width: sceneGraph.width,
    height: sceneGraph.height,
    viewport,
    children,
  };
}

/**
 * Resolve a SceneGraph while reusing RenderNode objects for unchanged nodes.
 *
 * The cache is explicit and caller-owned. This keeps standalone string
 * rendering deterministic while allowing the React editor path to preserve
 * RenderNode identity across partial document edits.
 */
export function resolveRenderTreeIncremental(
  sceneGraph: SceneGraph,
  previousCache: RenderTreeResolutionCache | undefined,
  options?: SceneGraphRenderOptions,
): RenderTreeResolutionResult {
  const ids = createRenderTreeIdGenerator();
  const nextNodesById = new Map<string, CachedRenderNode>();
  const exportSettings = resolveFigmaRenderExportSettings(options?.exportSettings);
  const cacheKey = renderExportSettingsCacheKey(exportSettings);
  const reusablePreviousCache = cacheReusableForExportSettings(previousCache, cacheKey);
  const resolvedChildren = resolveChildrenIncremental(sceneGraph.root.children, ids, reusablePreviousCache, nextNodesById, exportSettings);
  const viewport = sceneGraph.viewport ?? {
    x: 0,
    y: 0,
    width: sceneGraph.width,
    height: sceneGraph.height,
  };
  const children = markViewportRootChildClips(resolvedChildren, viewport, reusablePreviousCache?.rootChildren);

  return {
    renderTree: {
      width: sceneGraph.width,
      height: sceneGraph.height,
      viewport,
      children,
    },
    cache: { nodesById: nextNodesById, rootChildren: children, exportSettingsKey: cacheKey },
  };
}
