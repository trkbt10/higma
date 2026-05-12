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
} from "@higma-document-models/fig/scene-graph";

import {
  colorToHex,
  uint8ArrayToBase64,
  resolveFillWithRenderSettings,
  resolveTopFillWithRenderSettings,
  resolveStrokeResult,
  resolveEffects,
  finalizeGradientDefs,
  finalizeImagePatternDefsWithRenderSettings,
  normalizeFigmaRenderExportSettings,
  renderExportSettingsCacheKey,
  type IdGenerator,
  type ResolvedFill,
  type ResolvedFilter,
} from "../render";
import {
  matrixToSvgTransform,
  contourToSvgD,
  pathContoursBoundingBox,
  clampCornerRadius,
  cornerRadiusScalar,
  buildEllipseArcPathD,
} from "@higma-primitives/path";
import type {
  NormalizedFigmaRenderExportSettings,
  RenderExportSettingsCacheKey,
  SceneGraphRenderOptions,
} from "../render/export-settings";
import { buildEffectStack, type ResolvedEffectStack } from "../render/effect-stack";
import { createRenderTreeIdGenerator } from "./id-generator";
import { buildClipShape } from "./clip-shape";

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
  RenderPathContour,
  RenderBackgroundBlur,
  RenderMask,
  ClipPathShape,
  StrokeShape,
  StrokeRendering,
} from "./types";

function resolveOptionalStrokeRendering(
  stroke: Stroke | undefined,
  ids: IdGenerator,
  defs: RenderDef[],
  shape: StrokeShape,
  maskShape: ClipPathShape,
): StrokeRendering | undefined {
  if (!stroke) { return undefined; }
  return resolveStrokeRendering(stroke, ids, defs, shape, maskShape);
}

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
  clampedRadius: ReturnType<typeof clampCornerRadius>,
  ids: IdGenerator,
  defs: RenderDef[],
  maskShape: ClipPathShape,
): StrokeRendering | undefined {
  if (node.individualStrokeWeights && node.stroke) {
    const result = resolveStrokeResult(node.stroke, ids);
    if (result.layers) {
      for (const layer of result.layers) {
        if (layer.gradientDef) {
          collectGradientDef(layer.gradientDef, defs);
        }
      }
    }
    const cornerScalar = cornerRadiusScalar(clampedRadius);
    return {
      mode: "individual",
      sides: node.individualStrokeWeights,
      color: result.attrs.stroke,
      opacity: result.attrs.strokeOpacity,
      width: node.width,
      height: node.height,
      cornerRadius: cornerScalar > 0 ? cornerScalar : undefined,
      strokeAlign: result.attrs.strokeAlign,
    };
  }
  if (node.stroke) {
    const strokeShape: StrokeShape = { kind: "rect", width: node.width, height: node.height, cornerRadius: clampedRadius };
    return resolveStrokeRendering(node.stroke, ids, defs, strokeShape, maskShape);
  }
  return undefined;
}

function resolveFrameBackground(
  node: FrameNode,
  hasFills: boolean,
  strokeRendering: StrokeRendering | undefined,
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: NormalizedFigmaRenderExportSettings,
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
  };
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
  const childClipId = ids.getNextId("clip");
  defs.push({
    type: "clip-path",
    id: childClipId,
    shape: buildClipShape(node.width, node.height, clampedRadius),
  });
  return childClipId;
}

function resolveTextClipId(node: TextNode, ids: IdGenerator, defs: RenderDef[]): string | undefined {
  const needsClip = node.textAutoResize === "NONE" || node.textAutoResize === "TRUNCATE"
    || node.textTruncation === "ENDING";
  if (!needsClip) {
    return undefined;
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
      height: node.height,
    },
  });
  return textClipId;
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
 * Glyphs whose `firstCharacter` is `undefined` (e.g. opentype fallback
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
    list.push(contourToSvgD(contour));
    byRun.set(key, list);
  }
  // Decorations always go with the base run (key 0).
  if (node.decorationContours && node.decorationContours.length > 0) {
    const list = byRun.get(0) ?? [];
    for (const c of node.decorationContours) {
      list.push(contourToSvgD(c));
    }
    byRun.set(0, list);
  }
  // Emit runs in source order; skip runs that received no contours so
  // the result list is a tight set of paint operations.
  const out: RenderTextGlyphRun[] = [];
  for (let r = 0; r < sourceRuns.length; r++) {
    const list = byRun.get(r);
    if (!list || list.length === 0) { continue; }
    out.push({
      fillColor: sourceRuns[r].fillColor,
      fillOpacity: sourceRuns[r].fillOpacity,
      d: list.join(""),
    });
  }
  return out;
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
// Helper: Resolve wrapper attributes
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
): { wrapper: ResolvedWrapperAttrs; effectStack: ResolvedEffectStack; filter?: ResolvedFilter } {
  const elementBounds = getNodeBounds(node);
  const transformStr = matrixToSvgTransform(node.transform);
  const effectStack = buildEffectStack(node.effects);
  const filterResult = resolveEffects(effectStack.foregroundEffects, ids, elementBounds);

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
  };
}

// =============================================================================
// Helper: Finalize defs with element size
// =============================================================================

/**
 * Finalize all size-dependent defs (gradient coordinates and image patterns)
 * for a given element bounding box. Called once per node resolver.
 *
 * `elementBounds` may be the legacy `{width, height}` shape (origin
 * (0, 0), used by FRAME / RECTANGLE / ELLIPSE / TEXT) or the bbox
 * shape `{x, y, width, height}` (origin at the path's bbox top-left,
 * used by VECTOR — Figma encodes gradient endpoints relative to that
 * bbox so without (x, y) the gradient slides off the path).
 */
function finalizeDefs(
  defs: RenderDef[],
  elementBounds: { readonly x?: number; readonly y?: number; readonly width: number; readonly height: number },
  exportSettings: NormalizedFigmaRenderExportSettings,
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
    } else if (def.type === "diamond-gradient") {
      defs[i] = {
        type: "diamond-gradient",
        def: { ...def.def, elementWidth: elementSize.width, elementHeight: elementSize.height },
      };
    }
  }
}

// =============================================================================
// Helper: Resolve mask
// =============================================================================

/**
 * Resolve a node's mask (if present) into a RenderMask reference and
 * a RenderMaskDef in the defs array.
 *
 * Masks can be applied to ANY node type (group, frame, rect, ellipse,
 * path, text, image). This helper is called by every node resolver.
 */
function resolveMask(
  node: SceneNode,
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: NormalizedFigmaRenderExportSettings,
): RenderMask | undefined {
  if (!node.mask) {
    return undefined;
  }
  const maskId = ids.getNextId("mask");
  const resolvedMaskContent = resolveNode(node.mask.maskContent, ids, exportSettings);
  if (!resolvedMaskContent) {
    return undefined;
  }
  defs.push({ type: "mask", id: maskId, maskContent: resolvedMaskContent });
  return { maskAttr: `url(#${maskId})` };
}

// =============================================================================
// Helper: Resolve background blur
// =============================================================================

/**
 * Extract background blur effect from a node's effects and produce
 * a RenderBackgroundBlur instruction with a clip path.
 *
 * Background blur cannot be expressed as an SVG filter — it requires
 * foreignObject + CSS backdrop-filter, clipped to the node's shape.
 *
 * The `shape` parameter controls the clip geometry. When omitted we
 * fall back to a rectangle matching `bounds` — this matches the legacy
 * behaviour but produces a square blur region for non-rectangular
 * nodes (e.g. an ELLIPSE Container would look square because the blur
 * bleeds outside the circular silhouette). Callers for ellipse / path
 * nodes pass a shape matching the silhouette so the backdrop-filter
 * is clipped to the visible outline.
 */
function resolveBackgroundBlur(
  effectStack: ResolvedEffectStack,
  bounds: { x: number; y: number; width: number; height: number },
  ids: IdGenerator,
  defs: RenderDef[],
  shape?: ClipPathShape,
): RenderBackgroundBlur | undefined {
  const bgBlur = effectStack.backgroundBlur;
  if (!bgBlur || bgBlur.radius <= 0) {
    return undefined;
  }

  // Create a clip path for the foreignObject (same shape as the node)
  const clipId = ids.getNextId("bg-blur-clip");
  const clipShape: ClipPathShape = shape ?? {
    kind: "rect", x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
  };
  defs.push({
    type: "clip-path",
    id: clipId,
    shape: clipShape,
  });

  return {
    radius: bgBlur.radius,
    clipId,
    bounds,
  };
}

// =============================================================================
// Helper: Resolve fill and collect defs
// =============================================================================

function resolveFillResult(
  fill: Fill,
  ids: IdGenerator,
  defs: RenderDef[],
  exportSettings: NormalizedFigmaRenderExportSettings,
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
  exportSettings: NormalizedFigmaRenderExportSettings,
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
  exportSettings: NormalizedFigmaRenderExportSettings,
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
  exportSettings: NormalizedFigmaRenderExportSettings,
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
  stroke: Stroke,
  ids: IdGenerator,
  defs: RenderDef[],
  /** Shape descriptor for non-uniform stroke modes */
  shape: StrokeShape,
  /** Clip shape for stroke-align mask (required for INSIDE/OUTSIDE) */
  maskClipShape?: ClipPathShape,
): StrokeRendering {
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
  if (result.attrs.strokeAlign && maskClipShape) {
    const maskId = ids.getNextId("stroke-mask");
    defs.push({ type: "stroke-mask", id: maskId, shape: maskClipShape, strokeAlign: result.attrs.strokeAlign });
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

// =============================================================================
// Node Resolvers
// =============================================================================

function resolveGroupNode(
  node: GroupNode,
  ids: IdGenerator,
  exportSettings: NormalizedFigmaRenderExportSettings,
  resolvedChildren: readonly RenderNode[] | undefined = undefined,
): RenderGroupNode {
  const defs: RenderDef[] = [];
  const { wrapper } = resolveWrapper(node, ids, defs);

  const children = resolvedChildren ?? resolveChildren(node.children, ids, exportSettings);
  const mask = resolveMask(node, ids, defs, exportSettings);

  return {
    type: "group",
    id: node.id,
    wrapper,
    defs,
    source: node,
    children,
    mask,
    canUnwrapSingleChild:
      !wrapper.transform && (node.opacity >= 1) && !wrapper.filterAttr && !mask && !wrapper.blendMode,
  };
}

function resolveFrameNode(
  node: FrameNode,
  ids: IdGenerator,
  exportSettings: NormalizedFigmaRenderExportSettings,
  resolvedChildren: readonly RenderNode[] | undefined = undefined,
): RenderFrameNode {
  const defs: RenderDef[] = [];
  const { wrapper, effectStack } = resolveWrapper(node, ids, defs);
  const clampedRadius = clampCornerRadius(node.cornerRadius, node.width, node.height);

  // Background fill and stroke — resolved independently.
  const hasFills = node.fills.length > 0;
  const maskShape = buildClipShape(node.width, node.height, clampedRadius);

  const strokeRendering = resolveFrameStrokeRendering(node, clampedRadius, ids, defs, maskShape);
  const background = resolveFrameBackground(node, hasFills, strokeRendering, ids, defs, exportSettings);
  const children = resolvedChildren ?? resolveChildren(node.children, ids, exportSettings);
  const childClipId = resolveFrameChildClipId(node, children, ids, defs, clampedRadius);

  // Finalize gradient coordinates using element size
  finalizeDefs(defs, { width: node.width, height: node.height }, exportSettings);

  // Background blur (foreignObject + backdrop-filter, separate from filter
  // pipeline). Pass the FRAME's rounded-rect shape so the backdrop clip
  // honours cornerRadius (otherwise a rounded FRAME with background blur
  // would show a square blur area bleeding past the rounded corners).
  const backgroundBlur = resolveBackgroundBlur(
    effectStack, { x: 0, y: 0, width: node.width, height: node.height }, ids, defs,
    maskShape,
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
    cornerRadius: clampedRadius,
    backgroundBlur,
    mask,
    // Surface source fills/stroke at the RenderNode level so WebGL / other
    // backends never discriminate `node.source.type` — consistent with
    // RenderRectNode / RenderEllipseNode.
    sourceFills: node.fills,
    sourceStroke: node.stroke,
  };
}

function resolveRectNode(node: RectNode, ids: IdGenerator, exportSettings: NormalizedFigmaRenderExportSettings): RenderRectNode {
  const defs: RenderDef[] = [];
  const { wrapper, effectStack } = resolveWrapper(node, ids, defs);
  const clampedRadius = clampCornerRadius(node.cornerRadius, node.width, node.height);
  const fillResult = resolveTopFillResult(node.fills, ids, defs, exportSettings);
  const fillLayers = resolveAllFillLayers(node.fills, ids, defs, exportSettings);
  const maskClipShape = buildClipShape(node.width, node.height, clampedRadius);
  const rectStrokeShape: StrokeShape = { kind: "rect", width: node.width, height: node.height, cornerRadius: clampedRadius };
  const strokeRendering = resolveOptionalStrokeRendering(node.stroke, ids, defs, rectStrokeShape, maskClipShape);

  finalizeDefs(defs, { width: node.width, height: node.height }, exportSettings);

  const backgroundBlur = resolveBackgroundBlur(
    effectStack, { x: 0, y: 0, width: node.width, height: node.height }, ids, defs,
    maskClipShape,
  );

  const mask = resolveMask(node, ids, defs, exportSettings);
  const needsWrapper = !!(wrapper.transform || node.opacity < 1 || wrapper.filterAttr || defs.length > 0 || fillLayers || strokeRendering || backgroundBlur || mask);

  return {
    type: "rect",
    id: node.id,
    wrapper,
    defs,
    source: node,
    width: node.width,
    height: node.height,
    cornerRadius: clampedRadius,
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

function resolveEllipseNode(node: EllipseNode, ids: IdGenerator, exportSettings: NormalizedFigmaRenderExportSettings): RenderEllipseNode | RenderPathNode {
  const defs: RenderDef[] = [];
  const { wrapper, effectStack } = resolveWrapper(node, ids, defs);
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
  const strokeRendering = resolveOptionalStrokeRendering(node.stroke, ids, defs, ellipseStrokeShape, ellipseMaskShape);

  const ellipseSize = { width: node.rx * 2, height: node.ry * 2 };

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
    finalizeDefs(defs, ellipseSize, exportSettings);
    const needsWrapper = !!(
      wrapper.transform || node.opacity < 1 || wrapper.filterAttr || defs.length > 0 || fillLayers || strokeRendering || backgroundBlur || mask
    );
    return {
      type: "path",
      id: node.id,
      wrapper,
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

  finalizeDefs(defs, ellipseSize, exportSettings);
  const needsWrapper = !!(wrapper.transform || node.opacity < 1 || wrapper.filterAttr || defs.length > 0 || fillLayers || strokeRendering || backgroundBlur || mask);

  return {
    type: "ellipse",
    id: node.id,
    wrapper,
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

function resolvePathNode(node: PathNode, ids: IdGenerator, exportSettings: NormalizedFigmaRenderExportSettings): RenderPathNode {
  const defs: RenderDef[] = [];
  const { wrapper, effectStack } = resolveWrapper(node, ids, defs);
  const fillResult = resolveTopFillResult(node.fills, ids, defs, exportSettings);
  const fillLayers = resolveAllFillLayers(node.fills, ids, defs, exportSettings);

  const paths: RenderPathContour[] = node.contours.map((contour) => {
    const base: RenderPathContour = {
      d: contourToSvgD(contour),
      fillRule: contour.windingRule !== "nonzero" ? contour.windingRule as "evenodd" : undefined,
    };
    if (contour.fillOverride) {
      const overrideFill = resolveFillResult(contour.fillOverride, ids, defs, exportSettings);
      return { ...base, fillOverride: overrideFill };
    }
    return base;
  });

  const pathStrokeShape: StrokeShape = { kind: "path", paths };
  // INSIDE/OUTSIDE stroke needs a shape-matching mask; for paths the mask
  // uses the same contour data drawn as a clip-path (so the doubled
  // stroke width is clipped to the correct side of the path).
  const pathMaskShape: ClipPathShape = {
    kind: "path",
    d: paths.map((p) => p.d).join(" "),
  };
  const strokeRendering = resolveOptionalStrokeRendering(node.stroke, ids, defs, pathStrokeShape, pathMaskShape);

  // For VECTOR / boolean-op paths the contour origin in node-local
  // coordinates can be offset from (0, 0) — Figma's vector network
  // anchors the path at its own bbox, not the node's. The gradient's
  // userSpaceOnUse coordinates need that anchor so a linear gradient
  // running 0→1 in paint-space maps onto the path's actual extent
  // (e.g. world-map-style dots: their gradient should colour
  // the visible continents, not an off-frame region above the path).
  // Falls back to (0, 0) origin when contours can't be measured.
  const pathBounds = resolvePathBounds(node);
  if (pathBounds) {
    finalizeDefs(defs, pathBounds, exportSettings);
  }

  // Pass path shape so backdrop-filter clips to the actual contour, not
  // the node's bounding rect (matches ELLIPSE/FRAME behaviour).
  const backgroundBlur = resolveOptionalBackgroundBlur(effectStack, pathBounds, ids, defs, pathMaskShape);
  const mask = resolveMask(node, ids, defs, exportSettings);

  const needsWrapper = !!(
    wrapper.transform || node.opacity < 1 || wrapper.filterAttr ||
    defs.length > 0 || paths.length > 1 || fillLayers || strokeRendering || backgroundBlur || mask
  );

  return {
    type: "path",
    id: node.id,
    wrapper,
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

function resolveTextNode(node: TextNode, ids: IdGenerator, exportSettings: NormalizedFigmaRenderExportSettings): RenderTextNode {
  const defs: RenderDef[] = [];
  const { wrapper } = resolveWrapper(node, ids, defs);
  const fillColor = colorToHex(node.fill.color);
  const fillOpacity = node.fill.opacity < 1 ? node.fill.opacity : undefined;

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
    sourceFillColor: node.fill.color,
    sourceFillOpacity: node.fill.opacity,
    sourceTextLineLayout: node.textLineLayout,
    sourceTextAutoResize: node.textAutoResize,
    mask,
  };
}

function resolveImageNode(node: ImageNode, ids: IdGenerator, exportSettings: NormalizedFigmaRenderExportSettings): RenderImageNode {
  const defs: RenderDef[] = [];
  const { wrapper } = resolveWrapper(node, ids, defs);

  const dataUri = resolveImageDataUri(node);

  const mask = resolveMask(node, ids, defs, exportSettings);
  const needsWrapper = !!(wrapper.transform || node.opacity < 1 || mask);

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
    sourceImageRef: node.imageRef,
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

function resolveNode(node: SceneNode, ids: IdGenerator, exportSettings: NormalizedFigmaRenderExportSettings): RenderNode | null {
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
  exportSettings: NormalizedFigmaRenderExportSettings,
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
  exportSettings: NormalizedFigmaRenderExportSettings,
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
  if (child.type === "frame") {
    if (shouldOmitViewportRootFrameChildClip(child, viewport)) {
      if (child.omitChildClip === true) {
        return child;
      }
      if (shouldReuseViewportRootChildClipMark(previousChild, child)) {
        return previousChild;
      }
      return { ...child, omitChildClip: true };
    }
    if (child.omitChildClip === true) {
      return { ...child, omitChildClip: undefined };
    }
  }
  return child;
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
  exportSettings: NormalizedFigmaRenderExportSettings,
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
    const children = resolveChildrenIncremental(node.children, ids, previousCache, nextNodesById, exportSettings);
    const previousChildren = cachedPreviousContainerChildren(previous);
    if (previous !== undefined && previousChildren !== undefined && renderChildrenEqual(previousChildren, children)) {
      nextNodesById.set(node.id, previous);
      return previous.node;
    }

    const resolved = resolveContainerNodeIncremental(node, ids, children, exportSettings);
    nextNodesById.set(node.id, { source: node, node: resolved });
    return resolved;
  }

  const resolved = resolveNode(node, ids, exportSettings);
  if (!resolved) {
    return null;
  }
  nextNodesById.set(node.id, { source: node, node: resolved });
  return resolved;
}

function resolveChildrenIncremental(
  children: readonly SceneNode[],
  ids: IdGenerator,
  previousCache: RenderTreeResolutionCache | undefined,
  nextNodesById: Map<string, CachedRenderNode>,
  exportSettings: NormalizedFigmaRenderExportSettings,
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
  const exportSettings = normalizeFigmaRenderExportSettings(options?.exportSettings);
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
  const exportSettings = normalizeFigmaRenderExportSettings(options?.exportSettings);
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
