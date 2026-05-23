/**
 * @file SVG scene graph renderer
 *
 * Renders a SceneGraph to an SVG string via the RenderTree intermediate
 * representation. All attribute resolution is performed by the RenderTree
 * resolver — this file only formats pre-resolved data to SVG strings.
 *
 * ## Architecture
 *
 * ```
 * SceneGraph
 *     ↓ resolveRenderTree()
 * RenderTree (fully resolved)
 *     ↓ formatRenderTree() [this file]
 * SVG string
 * ```
 *
 * This ensures parity with the React renderer, which formats the same
 * RenderTree to JSX elements.
 */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "../scene-graph";
import {
  resolveSvgMaskElementAttrs,
  resolveSvgMaskPresentation,
  resolveSvgStrokeMaskElementAttrs,
  resolveRenderTree,
  resolveLayeredRectShapePrimitive,
  resolvePathBackedRectShapePrimitive,
  resolvePathContourRectPrimitive,
  resolveRectShapePrimitive,
  type RenderTree,
  type RenderNode,
  type BlendMode,
  type StrokeShape,
  type RenderGroupNode,
  type RenderFrameNode,
  type RenderRectNode,
  type RenderEllipseNode,
  type RenderPathNode,
  type RenderTextNode,
  type RenderImageNode,
  type RenderDef,
  type RenderFilterDef,
  type RenderPatternDef,
  type ResolvedFillResult,
  type ResolvedWrapperAttrs,
  type ClipPathShape,
  type StrokeRendering,
  type RenderBackgroundBlur,
  type RenderNodeBase,
  type SvgMaskElementAttrs,
  type PathContourRectSize,
  type RectShapePrimitive,
} from "../scene-graph";

import type { ResolvedStrokeAttrs, ResolvedAngularGradient, ResolvedDiamondGradient, ResolvedFillLayer, ResolvedStrokeLayer } from "../scene-graph";

import type { ResolvedFilterPrimitive } from "../scene-graph";
import { buildRoundedRectPathD, buildSmoothedRoundedRectPathD, parseSvgPathD, pathCommandsBoundingBox, type CornerRadius } from "@higma-primitives/path";

import {
  svg,
  g,
  defs,
  path,
  rect,
  circle,
  ellipse,
  text,
  clipPath,
  mask,
  linearGradient,
  radialGradient,
  stop,
  pattern,
  image,
  useElement,
  filter,
  feGaussianBlur,
  feFlood,
  feColorMatrix,
  feOffset,
  feBlend,
  feComposite,
  feMorphology,
  feMerge,
  feMergeNode,
  line,
  a as svgAnchor,
  foreignObject,
  htmlDiv,
  type SvgNode,
  type SvgElementNode,
  type SvgPaintAttrs,
  type SvgAttributeValue,
  type SvgAttributes,
  EMPTY_SVG,
} from "./element-primitives";
import type { SvgString } from "./primitives";
import { serializeFigmaExportSvg } from "./figma-export-precision";
import { projectFigmaExportTransforms } from "./figma-export-transform-projection";

// =============================================================================
// Def Formatting
// =============================================================================

const DATA_IMAGE_URI_PREFIX = "data:image/";
let svgImageAssetGeneration = 0;

type SvgImageAsset = {
  readonly id: string;
  readonly node: SvgNode;
};

type SvgImageAssetRegistry = {
  readonly generation: number;
  readonly byKey: Map<string, SvgImageAsset>;
  nextIndex: number;
};

function formatClipPathShape(shape: ClipPathShape): SvgNode {
  switch (shape.kind) {
    case "path": {
      return path({ d: shape.d, "fill-rule": shape.fillRule, "clip-rule": shape.fillRule });
    }
    case "ellipse":
      return ellipse({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry });
    case "rect":
      return rect({
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        rx: shape.rx,
        ry: shape.ry,
      });
  }
}

function formatFilterPrimitive(p: ResolvedFilterPrimitive): SvgNode {
  switch (p.type) {
    case "feFlood":
      return feFlood({ "flood-color": p.floodColor, "flood-opacity": p.floodOpacity, result: p.result });
    case "feColorMatrix":
      return feColorMatrix({
        in: p.in,
        type: p.matrixType,
        values: p.values,
        result: p.result,
      });
    case "feOffset":
      return feOffset({ in: p.in, dx: p.dx, dy: p.dy, result: p.result });
    case "feGaussianBlur":
      return feGaussianBlur({ in: p.in, stdDeviation: p.stdDeviation, result: p.result });
    case "feBlend":
      return feBlend({
        mode: p.mode,
        in: p.in,
        in2: p.in2,
        result: p.result,
      });
    case "feComposite":
      return feComposite({
        in: p.in,
        in2: p.in2,
        operator: p.operator,
        k1: p.k1,
        k2: p.k2,
        k3: p.k3,
        k4: p.k4,
        result: p.result,
      });
    case "feMorphology":
      return feMorphology({
        in: p.in,
        operator: p.operator,
        radius: p.radius,
        result: p.result,
      });
    case "feMerge":
      return feMerge({}, ...p.nodes.map((nodeIn) => feMergeNode({ in: nodeIn })));
  }
}

/**
 * Interpolate between two `#rrggbb`-ish stop colors at `t ∈ [0,1]`.
 * Supports both 6-digit hex and `rgb(r,g,b)`/`rgba(...)` values emitted
 * by the gradient stop resolver.
 */
function interpolateStopColor(a: string, b: string, t: number): string {
  const parse = (c: string): readonly [number, number, number, number] => {
    if (c.startsWith("#") && c.length === 7) {
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(",").map((s) => s.trim());
      return [parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10), parts[3] ? parseFloat(parts[3]) : 1];
    }
    return [0, 0, 0, 1];
  };
  const [ar, ag, ab, aa] = parse(a);
  const [br, bg, bb, ba] = parse(b);
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * t);
  const r = mix(ar, br), g = mix(ag, bg), bl = mix(ab, bb);
  const alpha = aa + (ba - aa) * t;
  return alpha < 0.999 ? `rgba(${r},${g},${bl},${alpha.toFixed(3)})` : `rgb(${r},${g},${bl})`;
}

/** Sample the gradient stop color at angular position `t ∈ [0,1]`. */
function sampleGradientAt(
  stops: readonly { offset: string; stopColor: string; stopOpacity?: number }[],
  t: number,
): string {
  if (stops.length === 0) { return "rgb(0,0,0)"; }
  const offsets = stops.map((s) => {
    const v = s.offset.endsWith("%") ? parseFloat(s.offset) / 100 : parseFloat(s.offset);
    return Number.isFinite(v) ? v : 0;
  });
  if (t <= offsets[0]) { return stops[0].stopColor; }
  if (t >= offsets[offsets.length - 1]) { return stops[stops.length - 1].stopColor; }
  for (let i = 1; i < offsets.length; i++) {
    if (t <= offsets[i]) {
      const span = offsets[i] - offsets[i - 1];
      const u = span > 0 ? (t - offsets[i - 1]) / span : 0;
      return interpolateStopColor(stops[i - 1].stopColor, stops[i].stopColor, u);
    }
  }
  return stops[stops.length - 1].stopColor;
}

/**
 * Emit an angular (conic) gradient as an SVG-native sectored
 * approximation. 64 triangular sectors radiate from the gradient's
 * centre; each sector is filled with the stop colour sampled at its
 * mid-angle.
 *
 * A prior implementation used `<foreignObject>` + CSS `conic-gradient`
 * inside an SVG `<pattern>`. Chromium refuses to render foreignObject
 * children when the foreignObject is nested inside a <pattern>, so
 * angular-filled FRAMEs rendered as white. The sectored approximation
 * works in every SVG renderer
 * (Chromium, Firefox, Safari, resvg) and does not depend on CSS.
 *
 * Trade-off: 64 sectors introduces ~5.6° angular stepping. For the
 * smooth continuous gradients Figma tends to emit, that is visually
 * indistinguishable from a true conic gradient at typical sizes.
 * Increase `SECTORS` if finer resolution is required.
 */
const SECTORS = 256;

function formatAngularGradientDef(d: ResolvedAngularGradient): SvgNode {
  const w = d.elementWidth ?? 1;
  const h = d.elementHeight ?? 1;
  // cx/cy are fractional (0..1) unless explicitly overridden; resolve
  // against element size.
  const cx = parseFloat(d.cx) * (d.cx.endsWith("%") ? w / 100 : 1) || (w / 2);
  const cy = parseFloat(d.cy) * (d.cy.endsWith("%") ? h / 100 : 1) || (h / 2);
  // Radius that guarantees full coverage regardless of element shape.
  const radius = Math.hypot(w, h);
  // Figma's `from` angle: d.rotation degrees. 0° points RIGHT, CW.
  // CSS conic-gradient default starts at TOP; we mirror that so the
  // mapping matches buildConicGradientCSS.
  const fromDeg = d.rotation - 90;

  const parts: SvgNode[] = [];
  // Tiny overlap so adjacent sectors meet cleanly without bg bleed-
  // through, but small enough to avoid double-coverage artefacts that
  // shift colours at sector boundaries on angular-gradient fills.
  // 256 sectors × 0.05° overlap = 12.8° total double-cover, well below
  // the 1.4° sector width.
  const OVERLAP_DEG = 0.0;
  // Note: tested 0.3 (worst, 9.52%), 0.05 (8.50%), 0.0 (8.50%), 0.01 (8.56%).
  // 0 is simplest and matches 0.05 result.
  for (let i = 0; i < SECTORS; i++) {
    const a0 = (i / SECTORS) * 360 + fromDeg;
    const a1 = ((i + 1) / SECTORS) * 360 + fromDeg;
    const a0r = (a0 - OVERLAP_DEG) * Math.PI / 180;
    const a1r = (a1 + OVERLAP_DEG) * Math.PI / 180;
    const x0 = cx + Math.cos(a0r) * radius;
    const y0 = cy + Math.sin(a0r) * radius;
    const x1 = cx + Math.cos(a1r) * radius;
    const y1 = cy + Math.sin(a1r) * radius;
    const midT = (i + 0.5) / SECTORS;
    const color = sampleGradientAt(d.stops, midT);
    const pathD = `M${cx},${cy} L${x0},${y0} L${x1},${y1} Z`;
    parts.push(path({ d: pathD, fill: color }));
  }
  // Size the pattern tile to enclose every sector triangle (each
  // triangle apex sits at (cx, cy) and extends out to `radius`). With
  // the tile sized to the element extent (w × h) the triangles whose
  // bbox falls outside (0,0)-(w,h) get CLIPPED by the pattern, leaving
  // those sectors blank (e.g. a 38×38 FRAME with radius=53.7 — most
  // triangles span coordinates beyond the tile). Use 2×radius so the
  // tile encloses the full sweep, anchored at the origin so the apex
  // stays at the same user-space coordinate when the tile is repeated
  // across a larger fill area.
  //
  // Use `patternUnits="userSpaceOnUse"` — coordinates in pattern
  // children are in user space, so the same triangle path renders at
  // the same absolute position regardless of the tile origin. The
  // tile's only effect with this setting is to clip; making it large
  // enough to enclose every sector removes the clipping.
  const tileSize = Math.ceil(radius * 2);
  return pattern(
    { id: d.id, patternUnits: "userSpaceOnUse", width: tileSize, height: tileSize },
    ...parts,
  );
}

/**
 * Format a diamond gradient def as a pattern containing four radial-
 * gradient halves. The SVG-pattern+foreignObject approach failed in
 * Chromium (see `formatAngularGradientDef` comment); for diamond we
 * fall back to a 4-triangle linear-gradient approximation (each
 * triangle gradient goes from centre to one corner of the fill box).
 */
function formatDiamondGradientDef(d: ResolvedDiamondGradient): SvgNode {
  const w = d.elementWidth ?? 1;
  const h = d.elementHeight ?? 1;
  const cx = parseFloat(d.cx) * (d.cx.endsWith("%") ? w / 100 : 1) || (w / 2);
  const cy = parseFloat(d.cy) * (d.cy.endsWith("%") ? h / 100 : 1) || (h / 2);
  // Sample 32 concentric polygons, each a diamond (rhombus) at decreasing
  // scale; inner polygon uses the first stop, outer the last.
  const parts: SvgNode[] = [];
  const steps = 32;
  // Diamond vertices span from centre to the element corners along ±x/±y axes.
  const dx = Math.max(w - cx, cx);
  const dy = Math.max(h - cy, cy);
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const color = sampleGradientAt(d.stops, t);
    const rx = dx * t;
    const ry = dy * t;
    const pathD = `M${cx - rx},${cy} L${cx},${cy - ry} L${cx + rx},${cy} L${cx},${cy + ry} Z`;
    parts.push(path({ d: pathD, fill: color }));
  }
  return pattern(
    { id: d.id, patternUnits: "userSpaceOnUse", width: w, height: h },
    ...parts,
  );
}

function patternImageAttrs(d: RenderPatternDef["def"]): Parameters<typeof image>[0] {
  if (d.imageTransform) {
    return {
      href: d.dataUri,
      width: d.imageWidth,
      height: d.imageHeight,
      preserveAspectRatio: d.preserveAspectRatio,
      transform: d.imageTransform,
    };
  }
  return {
    href: d.dataUri,
    width: d.imageWidth,
    height: d.imageHeight,
    preserveAspectRatio: d.preserveAspectRatio,
    x: 0,
    y: 0,
  };
}

function filterElementAttrs(f: RenderFilterDef["filter"]): Parameters<typeof filter>[0] {
  if (f.filterBounds) {
    return {
      id: f.id,
      x: f.filterBounds.x,
      y: f.filterBounds.y,
      width: f.filterBounds.width,
      height: f.filterBounds.height,
      filterUnits: "userSpaceOnUse",
      "color-interpolation-filters": "sRGB",
    };
  }
  return { id: f.id };
}

function formatDef(def: RenderDef): SvgNode {
  switch (def.type) {
    case "linear-gradient": {
      const d = def.def;
      const stops = d.stops.map((s) =>
        stop({
          offset: s.offset,
          "stop-color": s.stopColor,
          "stop-opacity": s.stopOpacity,
        }),
      );
      return linearGradient({ id: d.id, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, gradientUnits: d.gradientUnits }, ...stops);
    }
    case "radial-gradient": {
      const d = def.def;
      const stops = d.stops.map((s) =>
        stop({
          offset: s.offset,
          "stop-color": s.stopColor,
          "stop-opacity": s.stopOpacity,
        }),
      );
      return radialGradient({
        id: d.id, cx: d.cx, cy: d.cy, r: d.r,
        gradientUnits: d.gradientUnits,
        gradientTransform: typeof d.gradientTransform === "string" ? d.gradientTransform : undefined,
      }, ...stops);
    }
    case "angular-gradient": {
      return formatAngularGradientDef(def.def);
    }
    case "diamond-gradient": {
      return formatDiamondGradientDef(def.def);
    }
    case "pattern": {
      const d = def.def;
      const patternAttrs: Parameters<typeof pattern>[0] = {
        id: d.id,
        patternContentUnits: d.patternContentUnits === "objectBoundingBox" ? "objectBoundingBox" : undefined,
        patternUnits: d.patternContentUnits === "userSpaceOnUse" ? "userSpaceOnUse" : undefined,
        width: d.width,
        height: d.height,
        patternTransform: d.patternTransform,
      };
      // When imageTransform is set (by finalizeImagePatternDefs),
      // the image uses natural pixel dimensions with the transform
      // mapping to objectBoundingBox space. Otherwise, simple stretch.
      const imgAttrs = patternImageAttrs(d);
      return pattern(patternAttrs, image(imgAttrs));
    }
    case "filter": {
      const f = def.filter;
      const primitives = f.primitives.map((p) => formatFilterPrimitive(p));
      const filterAttrs = filterElementAttrs(f);
      return filter(filterAttrs, ...primitives);
    }
    case "clip-path": {
      const shape = formatClipPathShape(def.shape);
      if (def.transformProjection === undefined) {
        return clipPath({ id: def.id, transform: def.transform }, shape);
      }
      return clipPath({ id: def.id, transform: def.transform }, { transformProjection: def.transformProjection }, shape);
    }
    case "mask": {
      // `maskUnits="userSpaceOnUse"` matches Figma's own SVG export
      // (`mask*_xxxx` decls always carry this) AND is required for
      // correctness here: the mask CONTENT comes from a SceneNode whose
      // path coordinates live in user space (the same coord system the
      // masked content sits in). With the default `objectBoundingBox`
      // SVG would re-interpret those coords as fractions of the using
      // element's bounding box — turning a 165×360 iPhone-screen mask
      // path into a region 165× and 360× the size of the using rect,
      // and crashing resvg on the resulting degenerate geometry
      // (`geom.rs:27 unwrap None`).
      const presentation = resolveSvgMaskPresentation(def.maskType);
      if (def.contentRendering === "source-paint") {
        return mask(
          svgMaskElementAttrs(def, presentation.maskType),
          formatNode(def.maskContent),
        );
      }
      const maskContent = formatNodeAsMaskShape(def.maskContent, "white");
      return mask(
        svgMaskElementAttrs(def, presentation.maskType),
        maskContent,
      );
    }
    case "stroke-mask": {
      // Stroke-align mask for INSIDE/OUTSIDE stroke clipping.
      // INSIDE: white filled shape → only stroke inside the shape is visible.
      // OUTSIDE: inverted mask — large white rect with black shape cutout → only stroke outside is visible.
      // Same `maskUnits="userSpaceOnUse"` rationale as the plain mask above.
      const shape = formatClipPathShape(def.shape);
      if (def.strokeAlign === "OUTSIDE") {
        // Invert: large white background with black shape hole
        return mask(
          svgStrokeMaskElementAttrs(def.id),
          rect({ x: -100, y: -100, width: 10000, height: 10000, fill: "white" }),
          g({ fill: "black" }, shape),
        );
      }
      return mask(
        svgStrokeMaskElementAttrs(def.id),
        g({ fill: "white" }, shape),
      );
    }
  }
}

function svgMaskElementAttrs(
  def: Extract<RenderDef, { readonly type: "mask" }>,
  maskType: "alpha" | "luminance",
): {
  readonly id: string;
  readonly style: string;
  readonly maskUnits: "userSpaceOnUse";
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
} {
  return svgMaskElementAttrsToSvgAttrs(resolveSvgMaskElementAttrs({
    id: def.id,
    bounds: def.bounds,
    maskType,
  }));
}

function svgStrokeMaskElementAttrs(id: string): {
  readonly id: string;
  readonly style: string;
  readonly maskUnits: "userSpaceOnUse";
} {
  const attrs = resolveSvgStrokeMaskElementAttrs(id);
  return {
    id: attrs.id,
    style: `mask-type:${attrs.maskType}`,
    maskUnits: attrs.maskUnits,
  };
}

function svgMaskElementAttrsToSvgAttrs(attrs: SvgMaskElementAttrs): {
  readonly id: string;
  readonly style: string;
  readonly maskUnits: "userSpaceOnUse";
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
} {
  return {
    id: attrs.id,
    style: `mask-type:${attrs.maskType}`,
    maskUnits: attrs.maskUnits,
    x: attrs.x,
    y: attrs.y,
    width: attrs.width,
    height: attrs.height,
  };
}

function formatDefs(renderDefs: readonly RenderDef[]): SvgNode {
  if (renderDefs.length === 0) { return EMPTY_SVG; }
  const formatted = renderDefs.map(formatDef);
  return defs(...formatted);
}

// =============================================================================
// Fill/Stroke Attribute Formatting
// =============================================================================

function fillToSvgAttrs(fill: ResolvedFillResult): { fill: string; "fill-opacity"?: number; style?: string } {
  return {
    fill: fill.attrs.fill,
    "fill-opacity": fill.attrs.fillOpacity,
    style: blendModeStyle(fill.blendMode),
  };
}

type StrokeSvgAttrs = Pick<
  SvgPaintAttrs,
  | "stroke"
  | "stroke-width"
  | "stroke-opacity"
  | "stroke-linecap"
  | "stroke-linejoin"
  | "stroke-dasharray"
>;

function strokeToSvgAttrs(attrs: ResolvedStrokeAttrs): StrokeSvgAttrs {
  return {
    stroke: attrs.stroke,
    "stroke-width": attrs.strokeWidth,
    "stroke-opacity": attrs.strokeOpacity,
    "stroke-linecap": attrs.strokeLinecap,
    "stroke-linejoin": attrs.strokeLinejoin,
    "stroke-dasharray": attrs.strokeDasharray,
  };
}

/**
 * Convert wrapper attrs + mask to SVG attribute record.
 *
 * Every field of ResolvedWrapperAttrs must be consumed here.
 * The shared WRAPPER_ATTRS_FIELDS registry (in render-tree/types.ts)
 * enforces that ResolvedWrapperAttrs and this function stay in sync
 * — if a field is added to the type but not the registry, the
 * `satisfies` on the registry definition fails.
 */
type WrapperSvgAttrs = Pick<SvgPaintAttrs, "transform" | "opacity" | "style"> & {
  filter?: string;
  mask?: string;
};

function wrapperAttrs(node: { wrapper: ResolvedWrapperAttrs; mask?: { maskAttr: string } }): WrapperSvgAttrs {
  return wrapperAttrsForFilterMode(node, true);
}

function wrapperAttrsWithoutFilter(node: { wrapper: ResolvedWrapperAttrs; mask?: { maskAttr: string } }): WrapperSvgAttrs {
  return wrapperAttrsForFilterMode(node, false);
}

function wrapperAttrsForFilterMode(
  node: { wrapper: ResolvedWrapperAttrs; mask?: { maskAttr: string } },
  includeFilter: boolean,
): WrapperSvgAttrs {
  const w = node.wrapper;
  // Figma's SVG exporter does not add CSS isolation to filtered groups.
  // Blend isolation changes the backdrop that mix-blend-mode samples and
  // is therefore never inferred here; filters already define their own SVG
  // offscreen pipeline via <filter>.
  const parts: string[] = [];
  if (w.blendMode) {parts.push(`mix-blend-mode:${w.blendMode}`);}
  const style = parts.length > 0 ? parts.join(";") : undefined;
  return {
    transform: w.transform,
    opacity: w.opacity,
    filter: wrapperFilterAttr(w, includeFilter),
    mask: node.mask?.maskAttr,
    style,
  };
}

function foregroundFilterAttrs(wrapper: ResolvedWrapperAttrs): WrapperSvgAttrs {
  if (wrapper.filterAttr === undefined) {
    return {};
  }
  return { filter: wrapper.filterAttr };
}

function wrapperFilterAttr(wrapper: ResolvedWrapperAttrs, includeFilter: boolean): string | undefined {
  if (!includeFilter) {
    return undefined;
  }
  return wrapper.filterAttr;
}

// =============================================================================
// Corner Radius Routines
// =============================================================================

/**
 * Render a rectangle shape.
 *
 * Sharp-cornered rects and single-fill uniform rounded rects emit as
 * native `<rect>` / `<rect rx>`. Per-corner or smoothed rounded rects
 * use `<path>` because SVG `<rect>` cannot express their Kiwi geometry.
 */
function formatRectShape(
  w: number, h: number, cr: CornerRadius | undefined,
  fillAttrs: SvgPaintAttrs,
  strokeAttrs: SvgPaintAttrs,
  cornerSmoothing?: number,
): SvgNode {
  const shape = resolveRectShapePrimitive(w, h, cr, cornerSmoothing);
  return formatRectShapePrimitive(shape, { ...fillAttrs, ...strokeAttrs });
}

function formatLayeredRectShape(
  w: number,
  h: number,
  cr: CornerRadius | undefined,
  attrs: SvgPaintAttrs,
  cornerSmoothing?: number,
): SvgNode {
  const shape = resolveLayeredRectShapePrimitive(w, h, cr, cornerSmoothing);
  return formatRectShapePrimitive(shape, attrs);
}

function formatPathBackedRectShape(
  w: number,
  h: number,
  cr: CornerRadius | undefined,
  fillAttrs: SvgPaintAttrs,
  strokeAttrs: SvgPaintAttrs,
  cornerSmoothing?: number,
): SvgNode {
  const shape = resolvePathBackedRectShapePrimitive(w, h, cr, cornerSmoothing);
  return formatRectShapePrimitive(shape, { ...fillAttrs, ...strokeAttrs });
}

function formatRectShapePrimitive(shape: RectShapePrimitive, attrs: SvgPaintAttrs): SvgNode {
  switch (shape.kind) {
    case "rect":
      return rect({
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        rx: shape.rx,
        ...attrs,
      });
    case "path":
      return path({
        d: shape.d,
        ...attrs,
      });
  }
}

/**
 * Normalise a CornerRadius (scalar | 4-tuple | undefined) into the
 * 4-tuple form `buildSmoothedRoundedRectPathD` expects. Returns
 * `undefined` when the input has all-zero radii — the caller then
 * falls back to the sharp-corner rect emission, since the smoothed-
 * corner generator only contributes geometry when at least one
 * corner is rounded.
 */
function cornerRadiusToTuple(cr: CornerRadius | undefined): readonly [number, number, number, number] | undefined {
  if (cr === undefined) { return undefined; }
  if (typeof cr === "number") {
    return positiveScalarCornerRadiusToTuple(cr);
  }
  const [tl, tr, br, bl] = cr;
  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) { return undefined; }
  return [tl, tr, br, bl];
}

function positiveScalarCornerRadiusToTuple(radius: number): readonly [number, number, number, number] | undefined {
  if (radius <= 0) { return undefined; }
  return [radius, radius, radius, radius];
}

/**
 * Return the uniform corner radius when all four corners share the
 * same value; undefined otherwise (signals that the caller needs to
 * fall back to a `<path>` because SVG `<rect rx>` only supports a
 * single radius).
 */
function uniformCornerRadius(cr: CornerRadius | undefined): number | undefined {
  if (cr === undefined) { return 0; }
  if (typeof cr === "number") { return cr; }
  const [tl, tr, br, bl] = cr;
  if (tl === tr && tr === br && br === bl) { return tl; }
  return undefined;
}

// =============================================================================
// Multi-fill Layer Routines
// =============================================================================

function blendModeStyle(bm: BlendMode | undefined): string | undefined {
  return bm ? `mix-blend-mode:${bm}` : undefined;
}

function directShapeStyleWithNodeBlend(
  node: RenderNodeBase & { readonly needsWrapper?: boolean },
  style: string | undefined,
): string | undefined {
  if (node.needsWrapper === true || node.wrapper.blendMode === undefined) {
    return style;
  }
  const nodeBlendStyle = blendModeStyle(node.wrapper.blendMode);
  if (style !== undefined) {
    throw new Error(`formatRenderTree cannot fold node-level blend onto paint-blended shape ${node.id}`);
  }
  return nodeBlendStyle;
}

function directShapeAttrsWithNodeBlend<T extends SvgPaintAttrs>(
  node: RenderNodeBase & { readonly needsWrapper?: boolean },
  attrs: T,
): T {
  return {
    ...attrs,
    style: directShapeStyleWithNodeBlend(node, attrs.style),
  };
}

/**
 * Render stacked rect shapes for multi-paint fills.
 * Each fill layer becomes its own rect/path element, bottom-to-top.
 */
function formatMultiFillRectLayers(
  layers: readonly ResolvedFillLayer[],
  w: number, h: number, cr: CornerRadius | undefined,
  strokeAttrs: SvgPaintAttrs,
  cornerSmoothing?: number,
): SvgNode[] {
  return layers.map((layer, i): SvgNode => {
    const fillAttrs: SvgPaintAttrs = {
      fill: layer.attrs.fill,
      "fill-opacity": layer.attrs.fillOpacity,
      style: blendModeStyle(layer.blendMode),
    };
    // Only last layer gets stroke
    const sAttrs: SvgPaintAttrs = i === layers.length - 1 ? strokeAttrs : {};
    return formatLayeredRectShape(w, h, cr, { ...fillAttrs, ...sAttrs }, cornerSmoothing);
  });
}

/**
 * Render stacked ellipse shapes for multi-paint fills.
 */
function formatMultiFillEllipseLayers(
  layers: readonly ResolvedFillLayer[],
  cx: number, cy: number, rx: number, ry: number,
  strokeAttrs: StrokeSvgAttrs,
): SvgNode[] {
  // Mirror `formatEllipseElement`: when rx === ry the shape is a true
  // circle and Figma's exporter emits `<circle>` rather than `<ellipse>`.
  // Keeping the byte pattern aligned matters for downstream comparisons
  // and removes a 4× `<ellipse>` over-emission in the App page
  // screenshots fixture (each iPhone camera lens has 4 stacked gradient
  // fills on a circular shape).
  const isCircle = rx === ry;
  return layers.map((layer, i) => {
    const fillAttrs = {
      fill: layer.attrs.fill,
      "fill-opacity": layer.attrs.fillOpacity,
    };
    const sAttrs = i === layers.length - 1 ? strokeAttrs : {};
    const style = blendModeStyle(layer.blendMode);
    if (isCircle) {
      return circle({ cx, cy, r: rx, ...fillAttrs, ...sAttrs, style });
    }
    return ellipse({ cx, cy, rx, ry, ...fillAttrs, ...sAttrs, style });
  });
}

/**
 * Render stacked path shapes for multi-paint fills.
 */
function formatMultiFillPathLayers(
  layers: readonly ResolvedFillLayer[],
  paths: readonly { d: string; fillRule?: "evenodd" }[],
  strokeAttrs: StrokeSvgAttrs,
): SvgNode[] {
  const result: SvgNode[] = [];
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const fillAttrs = {
      fill: layer.attrs.fill,
      "fill-opacity": layer.attrs.fillOpacity,
    };
    const sAttrs = li === layers.length - 1 ? strokeAttrs : {};
    const style = blendModeStyle(layer.blendMode);
    for (const p of paths) {
      result.push(formatPreservedPathContourElement(p, {
        ...fillAttrs,
        ...sAttrs,
        style,
      }));
    }
  }
  return result;
}

function formatFrameSurfaceShape(
  node: RenderFrameNode,
  fillAttrs: SvgPaintAttrs,
  strokeAttrs: StrokeSvgAttrs | undefined,
): SvgNode[] {
  const attrs = { ...fillAttrs, ...(strokeAttrs ?? {}), ...frameBackgroundShapeRendering(node) };
  switch (node.surfaceShape.kind) {
    case "rect":
      if (frameSurfaceNeedsPathBackedShape(node)) {
        return [formatPathBackedRectShape(
          node.surfaceShape.width,
          node.surfaceShape.height,
          node.surfaceShape.cornerRadius,
          attrs,
          {},
          node.surfaceShape.cornerSmoothing,
        )];
      }
      return [formatRectShape(
        node.surfaceShape.width,
        node.surfaceShape.height,
        node.surfaceShape.cornerRadius,
        attrs,
        {},
        node.surfaceShape.cornerSmoothing,
      )];
    case "path":
      if (frameSurfaceNeedsPathBackedShape(node)) {
        return node.surfaceShape.paths.map((p) => formatPreservedPathContourElement(p, attrs));
      }
      return node.surfaceShape.paths.map((p) => formatPathContourElement(p, attrs, {
        width: node.width,
        height: node.height,
      }));
  }
}

function frameSurfaceNeedsPathBackedShape(node: RenderFrameNode): boolean {
  return node.background?.filterAttr !== undefined || node.wrapper.filterAttr !== undefined;
}

function formatPathContourElement(
  contour: { readonly d: string; readonly fillRule?: "evenodd" },
  attrs: SvgPaintAttrs,
  size?: PathContourRectSize,
): SvgNode {
  const rectPrimitive = resolvePathContourRectPrimitive(contour, size);
  if (rectPrimitive !== undefined) {
    return formatPathContourRectElement(rectPrimitive, attrs);
  }
  return path({
    d: contour.d,
    "fill-rule": contour.fillRule,
    ...attrs,
  });
}

function formatPathContourRectElement(
  rectPrimitive: Extract<RectShapePrimitive, { readonly kind: "rect" }>,
  attrs: SvgPaintAttrs,
): SvgNode {
  const rectNode = rect({
      x: rectPrimitive.x,
      y: rectPrimitive.y,
      width: rectPrimitive.width,
      height: rectPrimitive.height,
      rx: rectPrimitive.rx,
      ...attrs,
    });
  if (rectNode.kind !== "element") {
    throw new Error("formatPathContourElement requires rect() to return an SVG element");
  }
  return rectNode;
}

function formatPreservedPathContourElement(
  contour: { readonly d: string; readonly fillRule?: "evenodd" },
  attrs: SvgPaintAttrs,
): SvgNode {
  return path({
    d: contour.d,
    "fill-rule": contour.fillRule,
    ...attrs,
  });
}

function formatMultiFillFrameSurfaceLayers(
  node: RenderFrameNode,
  strokeAttrs: StrokeSvgAttrs | undefined,
): SvgNode[] {
  const layers = node.background?.fillLayers;
  if (layers === undefined) {
    return [];
  }
  switch (node.surfaceShape.kind) {
    case "rect":
      return formatMultiFillRectLayers(
        layers,
        node.surfaceShape.width,
        node.surfaceShape.height,
        node.surfaceShape.cornerRadius,
        strokeAttrs ?? {},
        node.surfaceShape.cornerSmoothing,
      );
    case "path":
      return formatMultiFillPathLayers(layers, node.surfaceShape.paths, strokeAttrs ?? {});
  }
}

// =============================================================================
// Multi-stroke Layer Routines
// =============================================================================

/**
 * Render stacked rect strokes for multi-paint stroke layers.
 * Each stroke layer draws the same shape outline with its own color/gradient and blend mode.
 */
function formatMultiStrokeRectLayers(
  layers: readonly ResolvedStrokeLayer[],
  w: number, h: number, cr: CornerRadius | undefined,
): SvgNode[] {
  return layers.map((layer) => {
    const sAttrs = strokeToSvgAttrs(layer.attrs);
    const style = blendModeStyle(layer.blendMode);
    if (cr !== undefined && typeof cr !== "number") {
      return path({
        d: buildRoundedRectPathD(w, h, cr),
        fill: "none",
        ...sAttrs,
        style,
      });
    }
    return rect({
      x: 0, y: 0, width: w, height: h, rx: cr, ry: cr,
      fill: "none",
      ...sAttrs,
      style,
    });
  });
}

/**
 * Render stacked ellipse strokes for multi-paint stroke layers.
 */
function formatMultiStrokeEllipseLayers(
  layers: readonly ResolvedStrokeLayer[],
  cx: number, cy: number, rx: number, ry: number,
): SvgNode[] {
  return layers.map((layer) => {
    const sAttrs = strokeToSvgAttrs(layer.attrs);
    const style = blendModeStyle(layer.blendMode);
    return ellipse({
      cx, cy, rx, ry,
      fill: "none",
      ...sAttrs,
      style,
    });
  });
}

/**
 * Render stacked path strokes for multi-paint stroke layers.
 */
function formatMultiStrokePathLayers(
  layers: readonly ResolvedStrokeLayer[],
  paths: readonly { d: string; fillRule?: "evenodd" }[],
  size?: PathContourRectSize,
): SvgNode[] {
  const result: SvgNode[] = [];
  for (const layer of layers) {
    const sAttrs = strokeToSvgAttrs(layer.attrs);
    const style = blendModeStyle(layer.blendMode);
    for (const p of paths) {
      result.push(formatPathContourElement(p, {
        fill: "none",
        ...sAttrs,
        style,
      }, size));
    }
  }
  return result;
}

function strokeGeometryFillAttrs(attrs: ResolvedStrokeAttrs): SvgPaintAttrs {
  return {
    fill: attrs.stroke,
    "fill-opacity": attrs.strokeOpacity,
  };
}

function formatStrokeGeometryLayers(
  sr: Extract<StrokeRendering, { readonly mode: "geometry" }>,
  maskId: string | undefined,
): SvgNode[] {
  const result: SvgNode[] = [];
  for (const layer of sr.layers) {
    const fillAttrs = strokeGeometryFillAttrs(layer.attrs);
    const style = blendModeStyle(layer.blendMode);
    for (const p of sr.paths) {
      result.push(path({
        d: p.d,
        "fill-rule": p.fillRule,
        ...fillAttrs,
        style,
        mask: maskId === undefined ? undefined : `url(#${maskId})`,
      }));
    }
  }
  return result;
}

// =============================================================================
// Background Blur Formatter
// =============================================================================

/**
 * Format a background blur effect as foreignObject + CSS backdrop-filter.
 *
 * SVG has no native background blur. Figma's SVG export uses a foreignObject
 * containing a div with `backdrop-filter: blur(stdDeviation px)`, clipped to
 * the node's shape via a clipPath.
 */
function formatBackgroundBlur(bgBlur: RenderBackgroundBlur): SvgNode {
  const foContent = htmlDiv({
    xmlns: "http://www.w3.org/1999/xhtml",
    style: `backdrop-filter:blur(${bgBlur.stdDeviation}px);clip-path:url(#${bgBlur.clipId});width:100%;height:100%`,
  });
  const fo = foreignObject(
    {
      x: bgBlur.backdropBounds.x,
      y: bgBlur.backdropBounds.y,
      width: bgBlur.backdropBounds.width,
      height: bgBlur.backdropBounds.height,
    },
    foContent,
  );
  return fo;
}



// =============================================================================
// StrokeRendering Formatter
// =============================================================================

/**
 * Get stroke attrs for the fill shape element (uniform mode only).
 * Other modes return empty — strokes are rendered as separate elements.
 */
function getUniformStrokeAttrs(sr: StrokeRendering | undefined): StrokeSvgAttrs {
  if (!sr || sr.mode !== "uniform") { return {}; }
  return strokeToSvgAttrs(sr.attrs);
}

/**
 * Format a stroked shape element from StrokeShape + stroke attrs.
 */
function formatStrokedShape(shape: StrokeShape, sAttrs: StrokeSvgAttrs): SvgNode {
  switch (shape.kind) {
    case "rect":
      return formatRectShape(shape.width, shape.height, shape.cornerRadius, { fill: "none" }, sAttrs, shape.cornerSmoothing);
    case "ellipse":
      if (shape.rx === shape.ry) {
        return circle({ cx: shape.cx, cy: shape.cy, r: shape.rx, fill: "none", ...sAttrs });
      }
      return ellipse({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry, fill: "none", ...sAttrs });
    case "path": {
      const els = shape.paths.map((p) =>
        formatPathContourElement(p, { fill: "none", ...sAttrs }),
      );
      return els.length === 1 ? els[0] : g({}, ...els);
    }
  }
}

/**
 * Format an INSIDE/OUTSIDE-aligned stroke on a rect/rounded-rect as
 * Figma's exporter does — the rect is offset by half the unaligned
 * stroke width so the (single-width) stroke straddles the visible
 * edge instead of doubled+clipped by a mask. This is the canonical
 * SVG idiom for inside/outside alignment on a closed rect:
 *
 *   INSIDE  rect x=t/2 y=t/2 w=W-t h=H-t rx=max(0,r-t/2) sw=t
 *   OUTSIDE rect x=-t/2 y=-t/2 w=W+t h=H+t rx=r+t/2 sw=t
 *
 * The visible rendering is identical to the masked-doubled-stroke
 * pattern for solid strokes, but dashed strokes traverse a different
 * perimeter length — Figma computes dashes along the offset rect, so
 * the masked pattern produces a slightly different dash phase. The
 * offset-rect pattern reproduces Figma's exact dash positions.
 *
 * Returns undefined when the input strokeAlign is CENTER (no offset
 * needed) or when the offset would make width/height non-positive
 * (a stroke too thick to fit inside the rect — fall back to mask).
 */
function tryFormatAlignedRectStroke(
  shape: StrokeShape,
  attrs: ResolvedStrokeAttrs,
): SvgNode | undefined {
  if (shape.kind !== "rect") { return undefined; }
  if (attrs.strokeAlign !== "INSIDE" && attrs.strokeAlign !== "OUTSIDE") { return undefined; }
  const doubledWidth = attrs.strokeWidth;
  const actualWidth = doubledWidth / 2;
  const half = actualWidth / 2;
  const sign = attrs.strokeAlign === "INSIDE" ? 1 : -1;
  const x = sign * half;
  const y = sign * half;
  const w = shape.width - sign * actualWidth;
  const h = shape.height - sign * actualWidth;
  if (w <= 0 || h <= 0) { return undefined; }
  const smoothing = positiveCornerSmoothing(shape.cornerSmoothing);
  const adjustedCornerRadius = adjustCornerRadiusForAlignedStroke(shape.cornerRadius, sign * half);
  const sAttrs: StrokeSvgAttrs = {
    stroke: attrs.stroke,
    "stroke-width": actualWidth,
    "stroke-opacity": attrs.strokeOpacity,
    "stroke-linecap": attrs.strokeLinecap,
    "stroke-linejoin": attrs.strokeLinejoin,
    "stroke-dasharray": attrs.strokeDasharray,
  };
  const fillAttrs: SvgPaintAttrs = { fill: "none" };
  const smoothed = formatSmoothedAlignedRectStroke(shape.cornerRadius, smoothing, w, h, x, y, sign * half, fillAttrs, sAttrs);
  if (smoothed !== undefined) {
    return smoothed;
  }
  const uniform = uniformCornerRadius(adjustedCornerRadius);
  if (uniform === undefined && adjustedCornerRadius !== undefined && typeof adjustedCornerRadius !== "number") {
    const d = buildRoundedRectPathD(w, h, adjustedCornerRadius, { x, y });
    return path({ d, ...fillAttrs, ...sAttrs });
  }
  const rxValue = uniform ?? (typeof adjustedCornerRadius === "number" ? adjustedCornerRadius : 0);
  const rxAttr = rxValue > 0 ? { rx: rxValue } : {};
  return rect({ x, y, width: w, height: h, ...rxAttr, ...fillAttrs, ...sAttrs });
}

function positiveCornerSmoothing(value: number | undefined): number {
  if (typeof value === "number" && value > 0) {
    return value;
  }
  return 0;
}

function formatSmoothedAlignedRectStroke(
  cornerRadius: CornerRadius | undefined,
  smoothing: number,
  width: number,
  height: number,
  x: number,
  y: number,
  strokeInset: number,
  fillAttrs: SvgPaintAttrs,
  strokeAttrs: StrokeSvgAttrs,
): SvgNode | undefined {
  if (smoothing === 0) {
    return undefined;
  }
  // For smoothed corners, pass the SOURCE radii (not the inset
  // ones) and the stroke half-width; `buildSmoothedRoundedRectPathD`
  // applies Figma's hybrid inset formula internally so the smoothing
  // extent `p` and arc curvature are reconciled correctly. Passing
  // the already-inset radii via the no-inset path would tighten the
  // arc but leave `p` un-adjusted, producing a corner that overshoots
  // theirs's emission by ~0.4 unit on `p` (calibration: iPhone
  // bezel Aluminum stroke at scale 0.2009).
  const sourceRadii = cornerRadiusToTuple(cornerRadius);
  if (sourceRadii === undefined) {
    return undefined;
  }
  const d = buildSmoothedRoundedRectPathD(width, height, sourceRadii, smoothing, { x, y }, strokeInset);
  return path({ d, ...fillAttrs, ...strokeAttrs });
}

/**
 * Adjust a CornerRadius by `delta` (positive = inset for INSIDE,
 * negative = outset for OUTSIDE), clamping each corner at 0.
 */
function adjustCornerRadiusForAlignedStroke(
  cr: CornerRadius | undefined,
  delta: number,
): CornerRadius | undefined {
  if (cr === undefined) { return undefined; }
  if (typeof cr === "number") {
    return adjustAlignedCornerRadiusValue(cr, delta);
  }
  const [tl, tr, br, bl] = cr;
  return [
    adjustAlignedCornerRadiusValue(tl, delta),
    adjustAlignedCornerRadiusValue(tr, delta),
    adjustAlignedCornerRadiusValue(br, delta),
    adjustAlignedCornerRadiusValue(bl, delta),
  ];
}

function adjustAlignedCornerRadiusValue(radius: number, delta: number): number {
  if (radius <= 0) { return 0; }
  const adjusted = radius - delta;
  return adjusted > 0 ? adjusted : 0;
}

/**
 * Format multi-paint stroke layers from StrokeShape.
 */
function formatStrokeLayersForShape(layers: readonly ResolvedStrokeLayer[], shape: StrokeShape): SvgNode[] {
  switch (shape.kind) {
    case "rect":
      return formatMultiStrokeRectLayers(layers, shape.width, shape.height, shape.cornerRadius);
    case "ellipse":
      return formatMultiStrokeEllipseLayers(layers, shape.cx, shape.cy, shape.rx, shape.ry);
    case "path":
      return formatMultiStrokePathLayers(layers, shape.paths);
  }
}

/**
 * Format separate stroke elements from a StrokeRendering union.
 *
 * This is the SINGLE stroke rendering function for the SVG backend.
 * All node formatters delegate here — no stroke logic elsewhere.
 */
function formatStrokeRendering(sr: StrokeRendering): SvgNode[] {
  switch (sr.mode) {
    case "uniform":
      return [];

    case "masked": {
      // Rect/rounded-rect with INSIDE/OUTSIDE alignment: emit Figma's
      // canonical inset/outset-rect pattern so the stroke's dash phase
      // matches Figma's exporter. The masked-doubled-stroke path
      // remains for ellipse/path shapes, where the offset transform is
      // more involved.
      const aligned = tryFormatAlignedRectStroke(sr.shape, sr.attrs);
      if (aligned !== undefined) {
        return [wrapOptionalBlendMode(aligned, sr.blendMode)];
      }
      const stroked = formatStrokedShape(sr.shape, strokeToSvgAttrs(sr.attrs));
      const wrapped = g({ mask: `url(#${sr.maskId})` }, stroked);
      // Paint-level blend mode forwarded from the single-layer branch
      // (e.g. a SOFT_LIGHT-blended white outline). The mask wrapper
      // alone has no `mix-blend-mode`, so the blend gets lost without
      // this extra wrapper.
      if (sr.blendMode) {
        return [g({ style: blendModeStyle(sr.blendMode) }, wrapped)];
      }
      return [wrapped];
    }

    case "layers":
      return formatStrokeLayersForShape(sr.layers, sr.shape);

    case "geometry": {
      return formatStrokeGeometryLayers(sr, sr.mask?.id);
    }

    case "individual": {
      const { sides, color, opacity, width: w, height: h, cornerRadius, strokeAlign } = sr;
      const lines: SvgNode[] = [];
      // SVG `<line>` strokes are centred on the line geometry. Per-side
      // stroke placement depends on Figma's strokeAlign, which determines
      // whether the band lies INSIDE, OUTSIDE, or CENTERED on the geometry:
      //
      //   INSIDE:  band paints from edge..edge+t (offset inward by t/2)
      //   OUTSIDE: band paints from edge-t..edge (offset outward by t/2)
      //   CENTER:  band paints from edge-t/2..edge+t/2 (line on the edge)
      //
      // For a single 1-px-tall element with OUTSIDE-aligned top stroke
      // (e.g. a 299×1 _Separator INSTANCE in a list), the visible
      // band lies one pixel ABOVE the geometry — y = -0.5 — not inside.
      const sign = strokeAlign === "OUTSIDE" ? -1 : strokeAlign === "INSIDE" ? 1 : 0;
      const topY = sign * (sides.top / 2);
      const bottomY = h + (sign === 0 ? 0 : -sign * (sides.bottom / 2));
      const leftX = sign * (sides.left / 2);
      const rightX = w + (sign === 0 ? 0 : -sign * (sides.right / 2));
      if (sides.top > 0) {
        lines.push(line({ x1: 0, y1: topY, x2: w, y2: topY, stroke: color, "stroke-opacity": opacity, "stroke-width": sides.top }));
      }
      if (sides.right > 0) {
        lines.push(line({ x1: rightX, y1: 0, x2: rightX, y2: h, stroke: color, "stroke-opacity": opacity, "stroke-width": sides.right }));
      }
      if (sides.bottom > 0) {
        lines.push(line({ x1: 0, y1: bottomY, x2: w, y2: bottomY, stroke: color, "stroke-opacity": opacity, "stroke-width": sides.bottom }));
      }
      if (sides.left > 0) {
        lines.push(line({ x1: leftX, y1: 0, x2: leftX, y2: h, stroke: color, "stroke-opacity": opacity, "stroke-width": sides.left }));
      }

      // Clip the band to the rounded perimeter only for INSIDE alignment;
      // OUTSIDE strokes lie outside the rect by definition and clipping
      // them to the inner rect would erase the entire band.
      if (hasNonZeroCornerRadius(cornerRadius) && strokeAlign !== "OUTSIDE") {
        // Clip to the rounded rect so per-side strokes don't bleed past
        // the rounded corners. Without this, an 8-px top stroke on a
        // r=24 rounded frame paints a horizontal band from y=0 to y=8
        // straight across the corner curve, producing a square-cornered
        // band visibly mismatched with Figma's exporter (which emits a
        // path-based inside-stroke that follows the rounded perimeter).
        const clipId = insideStrokeClipId(w, h, cornerRadius);
        const clipShape = formatRectShape(w, h, cornerRadius, { fill: "white" }, {});
        const clipDef = clipPath({ id: clipId }, clipShape);
        return [g({ "clip-path": `url(#${clipId})` }, clipDef, ...lines)];
      }
      return lines;
    }
  }
}

function wrapOptionalBlendMode(node: SvgNode, blendMode: BlendMode | undefined): SvgNode {
  if (blendMode === undefined) {
    return node;
  }
  return g({ style: blendModeStyle(blendMode) }, node);
}

// =============================================================================
// Shape Node Assembly
// =============================================================================

/**
 * Assemble a shape node's parts into a wrapped SVG group.
 *
 * All shape nodes (rect, ellipse, path, frame) share the same final assembly:
 * 1. Prepend defs
 * 2. Emit background blur before the foreground pixels when present
 * 3. Keep foreground filters off the background blur
 * 4. Wrap in <g> with wrapper attrs
 *
 * This prevents scattered backgroundBlur/defs handling across every formatter.
 */
function assembleShapeNode(
  node: { readonly defs: readonly RenderDef[]; readonly backgroundBlur?: RenderBackgroundBlur } & RenderNodeBase,
  shapeContent: readonly SvgNode[],
): SvgNode {
  const parts: SvgNode[] = [];
  const defsStr = formatDefs(node.defs);
  if (defsStr !== EMPTY_SVG) { parts.push(defsStr); }
  if (node.backgroundBlur === undefined) {
    parts.push(...shapeContent);
    return g(wrapperAttrs(node), ...parts);
  }

  parts.push(formatBackgroundBlur(node.backgroundBlur));
  if (node.wrapper.filterAttr === undefined) {
    parts.push(...shapeContent);
  } else {
    parts.push(g(foregroundFilterAttrs(node.wrapper), ...shapeContent));
  }
  return g(wrapperAttrsWithoutFilter(node), ...parts);
}

// =============================================================================
// Node Formatters
// =============================================================================

function insideStrokeClipId(w: number, h: number, cr: CornerRadius | undefined): string {
  return `inside-stroke-clip-${w}-${h}-${cornerRadiusKey(cr)}`.replace(/[^\w-]/g, "_");
}

function cornerRadiusKey(cr: CornerRadius | undefined): string {
  if (cr === undefined) { return "0"; }
  if (typeof cr === "number") { return `${cr}`; }
  return cr.join("_");
}

function hasNonZeroCornerRadius(cr: CornerRadius | undefined): boolean {
  if (cr === undefined) { return false; }
  if (typeof cr === "number") { return cr > 0; }
  return cr.some((r: number) => r > 0);
}

function formatGroupNode(node: RenderGroupNode): SvgNode {
  const children = node.children.map(formatNode);
  const clippedChildren = formatGroupChildren(node, children);
  const defsStr = formatDefs(node.defs);

  // Optimization: unwrap single child if no wrapper attrs needed
  if (node.canUnwrapSingleChild && clippedChildren.length === 1 && node.defs.length === 0) {
    return clippedChildren[0];
  }

  const parts: SvgNode[] = [];
  if (defsStr !== EMPTY_SVG) { parts.push(defsStr); }
  parts.push(...clippedChildren);

  return g(wrapperAttrs(node), ...parts);
}

function formatGroupChildren(node: RenderGroupNode, children: readonly SvgNode[]): readonly SvgNode[] {
  if (node.childClipId === undefined) {
    return children;
  }
  return [clipSvgChildren(node.childClipId, children)];
}

function formatFrameNode(node: RenderFrameNode): SvgNode {
  const defsParts: SvgNode[] = [];
  const foregroundParts: SvgNode[] = [];
  const defsStr = formatDefs(node.defs);
  if (defsStr !== EMPTY_SVG) { defsParts.push(defsStr); }

  // Keep the FRAME background and children inside the same clip group
  // whenever Kiwi `clipsContent` resolved a child clip. That is the SVG
  // export structure Figma uses for clipped frames, and it keeps the
  // Kiwi clipping decision as the single source of truth. Strokes
  // (especially OUTSIDE/CENTER align with `strokeRendering`) live
  // outside the child clip so the part extending beyond the frame edge
  // is not clipped.
  const { fillParts: bgFillParts, strokeParts: bgStrokeParts } = formatFrameBackgroundParts(node);

  const bgBlurPart = formatOptionalBackgroundBlur(node.backgroundBlur);
  const childElements = node.children.map(formatNode);
  const childClipId = node.omitChildClip ? undefined : node.childClipId;
  if (childClipId && childElements.length > 0) {
    const clippedFrameContent = clipSvgChildren(childClipId, [...bgFillParts, ...childElements]);
    foregroundParts.push(...formatFrameSurfaceEffectGroup(node, [clippedFrameContent]));
    foregroundParts.push(...bgStrokeParts);
  } else {
    foregroundParts.push(...formatFrameSurfaceEffectGroup(node, [...bgFillParts, ...childElements]), ...bgStrokeParts);
  }

  return assembleFrameNode(node, defsParts, bgBlurPart, foregroundParts);
}

function formatFrameBackgroundParts(
  node: RenderFrameNode,
): { readonly fillParts: readonly SvgNode[]; readonly strokeParts: readonly SvgNode[] } {
  const background = node.background;
  if (background === null) {
    return { fillParts: [], strokeParts: [] };
  }
  const sr = background.strokeRendering;
  const fillStrokeAttrs = getUniformStrokeAttrs(sr);
  const fillParts = formatFrameBackgroundFillParts(node, background, fillStrokeAttrs);
  const strokeParts = sr === undefined ? [] : formatStrokeRendering(sr);
  return { fillParts, strokeParts };
}

function formatFrameBackgroundFillParts(
  node: RenderFrameNode,
  background: NonNullable<RenderFrameNode["background"]>,
  fillStrokeAttrs: SvgPaintAttrs,
): readonly SvgNode[] {
  if (background.fillLayers) {
    return formatMultiFillFrameSurfaceLayers(node, fillStrokeAttrs);
  }
  const fillAttrs = fillToSvgAttrs(background.fill);
  return formatFrameSurfaceShape(node, fillAttrs, fillStrokeAttrs);
}

function assembleFrameNode(
  node: RenderFrameNode,
  defsParts: readonly SvgNode[],
  backgroundBlurPart: SvgNode | undefined,
  foregroundParts: readonly SvgNode[],
): SvgNode {
  if (backgroundBlurPart === undefined) {
    return g(wrapperAttrs(node), ...defsParts, ...foregroundParts);
  }
  if (node.wrapper.filterAttr === undefined) {
    return g(wrapperAttrsWithoutFilter(node), ...defsParts, backgroundBlurPart, ...foregroundParts);
  }
  return g(
    wrapperAttrsWithoutFilter(node),
    ...defsParts,
    backgroundBlurPart,
    g(foregroundFilterAttrs(node.wrapper), ...foregroundParts),
  );
}

function formatFrameSurfaceEffectGroup(
  node: RenderFrameNode,
  surfaceParts: readonly SvgNode[],
): readonly SvgNode[] {
  const filterAttr = node.background?.filterAttr;
  if (filterAttr === undefined || surfaceParts.length === 0) {
    return surfaceParts;
  }
  return [g({ filter: filterAttr }, ...surfaceParts)];
}

function formatOptionalBackgroundBlur(backgroundBlur: RenderBackgroundBlur | undefined): SvgNode | undefined {
  if (backgroundBlur === undefined) {
    return undefined;
  }
  return formatBackgroundBlur(backgroundBlur);
}

function formatRectNodeContent(node: RenderRectNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgNode[] {
  const strokeAttrs = fillStrokeAttrs ?? {};
  if (node.fillLayers) {
    return formatMultiFillRectLayers(node.fillLayers, node.width, node.height, node.cornerRadius, strokeAttrs, node.cornerSmoothing);
  }
  return [formatRectNodeSingleFillShape(
    node,
    { ...fillToSvgAttrs(node.fill), ...nodeWrapperShapeRendering(node) },
    strokeAttrs,
  )];
}

function formatRectNodeSingleFillShape(
  node: RenderRectNode,
  fillAttrs: SvgPaintAttrs,
  strokeAttrs: SvgPaintAttrs,
): SvgNode {
  const attrs = directShapeAttrsWithNodeBlend(node, effectSourceFillAttrs(node, fillAttrs));
  if (node.wrapper.filterAttr !== undefined) {
    return formatPathBackedRectShape(
      node.width,
      node.height,
      node.cornerRadius,
      attrs,
      strokeAttrs,
      node.cornerSmoothing,
    );
  }
  return formatRectShape(
    node.width,
    node.height,
    node.cornerRadius,
    attrs,
    strokeAttrs,
    node.cornerSmoothing,
  );
}

function formatEllipseElement(node: RenderEllipseNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgNode {
  const fillAttrs = directShapeAttrsWithNodeBlend(node, {
    ...effectSourceFillAttrs(node, fillToSvgAttrs(node.fill)),
    ...nodeWrapperShapeRendering(node),
  });
  const strokeAttrs = fillStrokeAttrs ?? {};
  if (node.rx === node.ry) {
    return circle({ cx: node.cx, cy: node.cy, r: node.rx, ...fillAttrs, ...strokeAttrs });
  }
  return ellipse({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry, ...fillAttrs, ...strokeAttrs });
}

function formatEllipseNodeContent(node: RenderEllipseNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgNode[] {
  const strokeAttrs = fillStrokeAttrs ?? {};
  if (node.fillLayers) {
    return formatMultiFillEllipseLayers(node.fillLayers, node.cx, node.cy, node.rx, node.ry, strokeAttrs);
  }
  return [formatEllipseElement(node, fillStrokeAttrs)];
}

function formatPathElements(node: RenderPathNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgNode[] {
  const defaultFillAttrs = {
    ...effectSourceFillAttrs(node, fillToSvgAttrs(node.fill)),
    ...nodeWrapperShapeRendering(node),
  };
  const strokeAttrs = fillStrokeAttrs ?? {};
  return node.paths.map((p) => {
    const fa = fillAttrsForPath(p.fillOverride, defaultFillAttrs);
    return formatPathContourElement(p, directShapeAttrsWithNodeBlend(node, { ...fa, ...strokeAttrs }), pathNodeContourSize(node));
  });
}

function effectSourceFillAttrs<T extends { readonly filterSource?: "effect-shape" }>(
  node: T,
  attrs: ReturnType<typeof fillToSvgAttrs>,
): ReturnType<typeof fillToSvgAttrs>;
function effectSourceFillAttrs<T extends { readonly filterSource?: "effect-shape" }>(
  node: T,
  attrs: SvgPaintAttrs,
): SvgPaintAttrs;
function effectSourceFillAttrs<T extends { readonly filterSource?: "effect-shape" }>(
  node: T,
  attrs: SvgPaintAttrs,
): SvgPaintAttrs {
  if (node.filterSource !== "effect-shape") {
    return attrs;
  }
  return { fill: "#000000" };
}

function fillAttrsForPath(
  fillOverride: RenderPathNode["paths"][number]["fillOverride"],
  defaultFillAttrs: ReturnType<typeof fillToSvgAttrs>,
): ReturnType<typeof fillToSvgAttrs> {
  if (fillOverride) {
    return fillToSvgAttrs(fillOverride);
  }
  return defaultFillAttrs;
}

function nodeWrapperShapeRendering(node: RenderNodeBase): Pick<SvgPaintAttrs, "shape-rendering"> {
  if (node.wrapper.filterAttr === undefined || !hasDropShadowEffect(node.source.effects)) {
    return {};
  }
  return { "shape-rendering": "crispEdges" };
}

function frameBackgroundShapeRendering(node: RenderFrameNode): Pick<SvgPaintAttrs, "shape-rendering"> {
  if (node.background?.filterAttr === undefined || !hasDropShadowEffect(node.source.effects)) {
    return {};
  }
  if (node.childClipId !== undefined && !node.omitChildClip) {
    return {};
  }
  return { "shape-rendering": "crispEdges" };
}

function hasDropShadowEffect(effects: RenderNodeBase["source"]["effects"]): boolean {
  return effects.some((effect) => effect.type === "drop-shadow");
}

function formatPathNodeContent(node: RenderPathNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgNode[] {
  if (node.fillLayers) {
    return formatMultiFillPathLayers(node.fillLayers, node.paths, fillStrokeAttrs ?? {});
  }
  return formatPathElements(node, fillStrokeAttrs);
}

function clipSvgContent(content: SvgNode, clipId: string | undefined): SvgNode {
  if (!clipId) { return content; }
  return g({ "clip-path": `url(#${clipId})` }, content);
}

function clipSvgChildren(clipId: string, children: readonly SvgNode[]): SvgNode {
  const liftedMask = liftSingleMaskGroupAcrossClip(clipId, children);
  if (liftedMask !== undefined) {
    return liftedMask;
  }
  return g({ "clip-path": `url(#${clipId})` }, ...children);
}

function liftSingleMaskGroupAcrossClip(clipId: string, children: readonly SvgNode[]): SvgNode | undefined {
  if (children.length !== 1) {
    return undefined;
  }
  const child = children[0];
  if (child.kind !== "element" || child.name !== "g") {
    return undefined;
  }
  const maskAttr = child.attrs.mask;
  if (typeof maskAttr !== "string") {
    return undefined;
  }
  const nonMaskAttrs = definedSvgAttributeNames(child.attrs).filter((name) => name !== "mask");
  if (nonMaskAttrs.length > 0) {
    return undefined;
  }
  const { defChildren, contentChildren } = splitDefsFromContent(child.children);
  return g(
    { mask: maskAttr },
    ...defChildren,
    g({ "clip-path": `url(#${clipId})` }, ...contentChildren),
  );
}

function splitDefsFromContent(children: readonly SvgNode[]): {
  readonly defChildren: readonly SvgNode[];
  readonly contentChildren: readonly SvgNode[];
} {
  return {
    defChildren: children.filter(isSvgDefsElement),
    contentChildren: children.filter((child) => !isSvgDefsElement(child)),
  };
}

function isSvgDefsElement(node: SvgNode): node is SvgElementNode {
  return node.kind === "element" && node.name === "defs";
}

function definedSvgAttributeNames(attrs: SvgElementNode["attrs"]): readonly string[] {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
}

function fontVariationStyle(fontVariationSettings: string | undefined): string | undefined {
  if (!fontVariationSettings) { return undefined; }
  return `font-variation-settings:${fontVariationSettings}`;
}

function groupMultipleTextElements(textElements: readonly SvgNode[]): SvgNode {
  if (textElements.length === 1) { return textElements[0]; }
  return g({}, ...textElements);
}

function textAnchorValue(textAnchor: string): "middle" | "end" | undefined {
  if (textAnchor === "middle" || textAnchor === "end") {
    return textAnchor;
  }
  return undefined;
}

function formatRectNode(node: RenderRectNode): SvgNode {
  const sr = node.strokeRendering;
  const fillStrokeAttrs = getUniformStrokeAttrs(sr);

  if (node.fillLayers || sr) {
    return assembleShapeNode(node, formatShapeContentWithStroke(formatRectNodeContent(node, fillStrokeAttrs), sr));
  }

  const rectEl = formatRectNodeSingleFillShape(node, fillToSvgAttrs(node.fill), fillStrokeAttrs);

  if (node.needsWrapper) {
    return assembleShapeNode(node, [rectEl]);
  }
  return rectEl;
}

function formatEllipseNode(node: RenderEllipseNode): SvgNode {
  const sr = node.strokeRendering;
  const fillStrokeAttrs = getUniformStrokeAttrs(sr);

  if (node.fillLayers || sr) {
    return assembleShapeNode(node, formatShapeContentWithStroke(formatEllipseNodeContent(node, fillStrokeAttrs), sr));
  }

  const el = formatEllipseElement(node, fillStrokeAttrs);

  if (node.needsWrapper) {
    return assembleShapeNode(node, [el]);
  }
  return el;
}

function formatPathNode(node: RenderPathNode): SvgNode {
  if (node.paths.length === 0) {
    return EMPTY_SVG;
  }

  const sr = node.strokeRendering;
  const fillStrokeAttrs = getUniformStrokeAttrs(sr);
  if (node.fillLayers || sr) {
    return assembleShapeNode(node, formatShapeContentWithStroke(formatPathNodeContent(node, fillStrokeAttrs), sr));
  }

  const defaultFillAttrs = effectSourceFillAttrs(node, fillToSvgAttrs(node.fill));
  const pathElements: SvgNode[] = node.paths.map((p) => {
    const fa = fillAttrsForPath(p.fillOverride, defaultFillAttrs);
    return formatPathContourElement(p, { ...fa, ...fillStrokeAttrs }, pathNodeContourSize(node));
  });

  if (node.needsWrapper) {
    return assembleShapeNode(node, pathElements);
  }
  return pathElements[0];
}

function pathNodeContourSize(node: RenderPathNode): PathContourRectSize | undefined {
  const source = node.source;
  if (source.type !== "path") {
    return undefined;
  }
  if (typeof source.width !== "number" || typeof source.height !== "number") {
    return undefined;
  }
  return { width: source.width, height: source.height };
}

function formatShapeContentWithStroke(
  fillContent: readonly SvgNode[],
  strokeRendering: StrokeRendering | undefined,
): readonly SvgNode[] {
  if (strokeRendering === undefined) {
    return fillContent;
  }
  return [...fillContent, ...formatStrokeRendering(strokeRendering)];
}

function formatTextNode(node: RenderTextNode): SvgNode {
  const defsStr = formatDefs(node.defs);

  if (node.content.mode === "glyphs") {
    return formatGlyphTextNode(node, defsStr);
  }

  // Text line layout: <text> elements
  const fb = node.content.layout;
  if (fb.lines.length === 0) {
    return EMPTY_SVG;
  }

  const textAnchor = textAnchorValue(fb.textAnchor);
  const fontVarStyle = fontVariationStyle(fb.fontVariationSettings);

  const textElements: SvgNode[] = fb.lines.map((line) =>
    text(
      {
        x: line.x,
        y: line.y,
        fill: node.fillColor,
        "fill-opacity": node.fillOpacity,
        "font-family": fb.fontFamily,
        "font-size": fb.fontSize,
        "font-weight": fb.fontWeight,
        "font-style": fb.fontStyle,
        "letter-spacing": fb.letterSpacing,
        "text-anchor": textAnchor,
        style: fontVarStyle,
      },
      line.text,
    ),
  );

  const groupedTextContent = groupMultipleTextElements(textElements);
  const textContent = node.hyperlink ? svgAnchor({ href: node.hyperlink }, groupedTextContent) : groupedTextContent;

  const clippedContent = clipSvgContent(textContent, node.textClipId);

  return g(wrapperAttrs(node), ...formatDefsAndContent(defsStr, clippedContent));
}

function formatGlyphTextNode(node: RenderTextNode, defsStr: SvgNode): SvgNode {
  if (node.content.mode !== "glyphs") {
    throw new Error("formatGlyphTextNode requires glyph text content");
  }
  const runs = node.content.runs;
  if (runs.length === 0) {
    return EMPTY_SVG;
  }
  // One <path> per fill run. The render-tree resolver already grouped
  // glyph contours by their TextRun and attached the resolved
  // fillColor/fillOpacity/blendMode, so the formatter just emits
  // each run as-is. `style="mix-blend-mode:…"` is applied when the
  // source paint carries a non-NORMAL blend (Event metadata's
  // `[{black @0.15 NORMAL}, {black @1 OVERLAY}]` stack relies on
  // the OVERLAY pass to land at mid-grey instead of solid black).
  const runPaths = runs.map((run) => path({
    d: run.d,
    fill: run.fillColor,
    "fill-opacity": run.fillOpacity < 1 ? run.fillOpacity : undefined,
    style: blendModeStyle(run.blendMode),
  }));
  const glyphBody: SvgNode = runPaths.length === 1 ? runPaths[0] : g({}, ...runPaths);
  const glyphContent = node.hyperlink ? svgAnchor({ href: node.hyperlink }, glyphBody) : glyphBody;
  const content = clipSvgContent(glyphContent, node.textClipId);
  return g(wrapperAttrs(node), ...formatDefsAndContent(defsStr, content));
}

function formatDefsAndContent(defsStr: SvgNode, content: SvgNode): readonly SvgNode[] {
  if (defsStr === EMPTY_SVG) {
    return [content];
  }
  return [defsStr, content];
}

function formatImageNode(node: RenderImageNode): SvgNode {
  if (!node.dataUri) {
    return EMPTY_SVG;
  }

  const imageEl = image({
    href: node.dataUri,
    x: 0,
    y: 0,
    width: node.width,
    height: node.height,
    preserveAspectRatio: node.preserveAspectRatio,
    style: directShapeStyleWithNodeBlend(node, undefined),
  });

  if (node.needsWrapper) {
    return g(wrapperAttrs(node), imageEl);
  }
  return imageEl;
}

function formatNode(node: RenderNode): SvgNode {
  switch (node.type) {
    case "group":
      return formatGroupNode(node);
    case "frame":
      return formatFrameNode(node);
    case "rect":
      return formatRectNode(node);
    case "ellipse":
      return formatEllipseNode(node);
    case "path":
      return formatPathNode(node);
    case "text":
      return formatTextNode(node);
    case "image":
      return formatImageNode(node);
  }
}

/**
 * Format a RenderNode as forced mask geometry for OUTLINE masks.
 *
 * ALPHA and LUMINANCE masks render the source node through the normal
 * formatter because the source alpha/luminance is semantically
 * meaningful. OUTLINE masks use geometry with an opaque white source, so
 * this walker preserves transforms while overriding primitive paint.
 */
type MaskStrokeAttrs = { readonly stroke: "white"; readonly "stroke-width": number };
type MaskInlineGeometryStroke = {
  readonly attrs: MaskStrokeAttrs;
  readonly suppressGeometryPaths: true;
};

const MASK_RECT_STROKE_GEOMETRY_EPSILON = 0.02;

function formatNodeAsMaskShape(node: RenderNode, fill: string): SvgNode {
  const wrapper = node.wrapper;
  const wrapperAttrs: Record<string, string | number | undefined> = {
    transform: wrapper.transform,
  };
  const body = formatNodeAsMaskShapeBody(node, fill);
  // Wrap in <g transform=...> when the node carries a transform so child
  // coordinates stay local to the node's own frame, matching the way the
  // node would render in its non-mask path.
  if (wrapper.transform === undefined) {
    return body;
  }
  return g(wrapperAttrs, body);
}

function maskStrokeAttrsForNode(node: RenderNode): MaskStrokeAttrs | undefined {
  const strokeRendering = strokeRenderingForMaskNode(node);
  const width = maskStrokeWidth(strokeRendering);
  if (width === undefined) {
    return undefined;
  }
  return { stroke: "white", "stroke-width": width };
}

function strokeRenderingForMaskNode(node: RenderNode): StrokeRendering | undefined {
  switch (node.type) {
    case "rect":
    case "ellipse":
    case "path":
      return node.strokeRendering;
    case "frame":
      return node.background?.strokeRendering;
    case "group":
    case "text":
    case "image":
      return undefined;
  }
}

function maskStrokeWidth(strokeRendering: StrokeRendering | undefined): number | undefined {
  if (strokeRendering === undefined) {
    return undefined;
  }
  switch (strokeRendering.mode) {
    case "uniform":
    case "masked":
      return positiveStrokeWidth(strokeRendering.attrs.strokeWidth);
    case "layers": {
      const first = strokeRendering.layers[0];
      if (first === undefined) {
        throw new Error("Resolved OUTLINE mask stroke layers were empty");
      }
      return positiveStrokeWidth(first.attrs.strokeWidth);
    }
    case "geometry":
    case "individual":
      return undefined;
  }
}

function positiveStrokeWidth(width: number): number | undefined {
  if (width <= 0) {
    return undefined;
  }
  return width;
}

function formatMaskStrokeGeometry(strokeRendering: StrokeRendering | undefined, fill: string): SvgNode[] {
  if (strokeRendering?.mode !== "geometry") {
    return [];
  }
  return strokeRendering.paths.map((p) => formatPathContourElement(p, { fill }));
}

function maskInlineGeometryStrokeForPathNode(node: RenderPathNode): MaskInlineGeometryStroke | undefined {
  const strokeRendering = node.strokeRendering;
  if (strokeRendering?.mode !== "geometry") {
    return undefined;
  }
  const sourceContour = singleItem(node.paths);
  const strokeContour = singleItem(strokeRendering.paths);
  if (sourceContour === undefined || strokeContour === undefined) {
    return undefined;
  }
  const strokeWidth = uniformPositiveGeometryStrokeWidth(strokeRendering.layers);
  if (strokeWidth === undefined) {
    return undefined;
  }
  const sourceRect = resolvePathContourRectPrimitive(sourceContour, pathNodeContourSize(node));
  if (sourceRect === undefined) {
    return undefined;
  }
  const strokeBounds = pathCommandsBoundingBox(parseSvgPathD(strokeContour.d));
  if (!rectStrokeBoundsMatchSourceRect(sourceRect, strokeBounds, strokeWidth)) {
    return undefined;
  }
  return {
    attrs: { stroke: "white", "stroke-width": strokeWidth },
    suppressGeometryPaths: true,
  };
}

function singleItem<T>(items: readonly T[]): T | undefined {
  if (items.length !== 1) {
    return undefined;
  }
  return items[0];
}

function uniformPositiveGeometryStrokeWidth(layers: readonly ResolvedStrokeLayer[]): number | undefined {
  const first = singleItem(layers);
  if (first === undefined) {
    return undefined;
  }
  const strokeWidth = positiveStrokeWidth(first.attrs.strokeWidth);
  if (strokeWidth === undefined) {
    return undefined;
  }
  return strokeWidth;
}

function rectStrokeBoundsMatchSourceRect(
  sourceRect: Extract<RectShapePrimitive, { readonly kind: "rect" }>,
  strokeBounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  strokeWidth: number,
): boolean {
  const inset = strokeWidth / 2;
  const expected = {
    x: sourceRect.x - inset,
    y: sourceRect.y - inset,
    width: sourceRect.width + strokeWidth,
    height: sourceRect.height + strokeWidth,
  };
  return (
    nearMaskRectStrokeGeometry(strokeBounds.x, expected.x) &&
    nearMaskRectStrokeGeometry(strokeBounds.y, expected.y) &&
    nearMaskRectStrokeGeometry(strokeBounds.w, expected.width) &&
    nearMaskRectStrokeGeometry(strokeBounds.h, expected.height)
  );
}

function nearMaskRectStrokeGeometry(a: number, b: number): boolean {
  return Math.abs(a - b) <= MASK_RECT_STROKE_GEOMETRY_EPSILON;
}

function formatNodeAsMaskShapeBody(node: RenderNode, fill: string): SvgNode {
  switch (node.type) {
    case "path": {
      const inlineGeometryStroke = maskInlineGeometryStrokeForPathNode(node);
      const strokeAttrs = maskStrokeAttrsForNode(node) ?? inlineGeometryStroke?.attrs;
      const sa = strokeAttrs ?? {};
      const parts = [
        ...node.paths.map((p) => formatPathContourElement(p, { fill, ...sa }, pathNodeContourSize(node))),
        ...(inlineGeometryStroke?.suppressGeometryPaths === true ? [] : formatMaskStrokeGeometry(node.strokeRendering, fill)),
      ];
      if (parts.length === 1) {
        return parts[0];
      }
      return g({}, ...parts);
    }
    case "rect": {
      const strokeAttrs = maskStrokeAttrsForNode(node);
      return formatMaskRectShape({
        width: node.width,
        height: node.height,
        cornerRadius: node.cornerRadius,
        cornerSmoothing: node.cornerSmoothing,
        fill,
        strokeAttrs,
      });
    }
    case "ellipse": {
      const strokeAttrs = maskStrokeAttrsForNode(node);
      const sa = strokeAttrs ?? {};
      if (node.rx === node.ry) {
        return circle({ cx: node.cx, cy: node.cy, r: node.rx, fill, ...sa });
      }
      return ellipse({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry, fill, ...sa });
    }
    case "group": {
      const children = node.children.map((c) => formatNodeAsMaskShape(c, fill));
      if (children.length === 1) {
        return children[0];
      }
      return g({}, ...children);
    }
    case "frame": {
      const strokeAttrs = maskStrokeAttrsForNode(node);
      // Frame as a mask: emit its rounded-rect background as the shape.
      // Children of a frame-as-mask are unusual and would each need to
      // be treated as additive mask geometry — drop through to a group.
      const bgEl = formatFrameMaskBackground(node, fill, strokeAttrs);
      if (node.children.length === 0) {
        return bgEl;
      }
      const childEls = node.children.map((c) => formatNodeAsMaskShape(c, fill));
      return g({}, bgEl, ...childEls);
    }
    case "text": {
      return formatTextMaskShape(node, fill);
    }
    case "image": {
      return formatImageMaskShape(node);
    }
  }
}

function formatTextMaskShape(node: RenderTextNode, fill: string): SvgNode {
  // Text used as a mask emits its glyph contours with the requested
  // mask fill — every mask shape body uses the same constant so the
  // rasterised mask source matches Figma's exporter byte-for-byte.
  if (node.content.mode !== "glyphs") {
    throw new Error(`Text mask node ${node.id} requires glyph geometry`);
  }
  const parts = node.content.runs.map((run) => path({ d: run.d, fill }));
  if (parts.length === 1) { return parts[0]; }
  return g({}, ...parts);
}

function formatFrameMaskBackground(node: RenderFrameNode, fill: string, strokeAttrs: MaskStrokeAttrs | undefined): SvgNode {
  return formatMaskRectShape({
    width: node.width,
    height: node.height,
    cornerRadius: node.cornerRadius,
    cornerSmoothing: node.cornerSmoothing,
    fill,
    strokeAttrs,
  });
}

function formatMaskRectShape(
  {
    width,
    height,
    cornerRadius,
    cornerSmoothing,
    fill,
    strokeAttrs,
  }: {
    readonly width: number;
    readonly height: number;
    readonly cornerRadius?: CornerRadius;
    readonly cornerSmoothing?: number;
    readonly fill: string;
    readonly strokeAttrs?: MaskStrokeAttrs;
  },
): SvgNode {
  const uniform = uniformCornerRadius(cornerRadius);
  if (cornerRadius !== undefined && uniform === undefined) {
    const radii = coerceCornerRadius(cornerRadius);
    const d = maskRoundedRectPathD({ width, height, radii, cornerSmoothing });
    return path({
      d,
      fill,
      ...strokeAttrs,
    });
  }
  const rxValue = uniform ?? 0;
  const rxAttr = rxValue > 0 ? { rx: rxValue } : {};
  return rect({ x: 0, y: 0, width, height, ...rxAttr, fill, ...strokeAttrs });
}

function maskRoundedRectPathD(
  {
    width,
    height,
    radii,
    cornerSmoothing,
  }: {
    readonly width: number;
    readonly height: number;
    readonly radii: readonly [number, number, number, number];
    readonly cornerSmoothing?: number;
  },
): string {
  if (cornerSmoothing !== undefined && cornerSmoothing > 0) {
    return buildSmoothedRoundedRectPathD(width, height, radii, cornerSmoothing);
  }
  return buildRoundedRectPathD(width, height, radii);
}

function formatImageMaskShape(node: RenderImageNode): SvgNode {
  // Image-as-mask uses the image's intrinsic alpha; Figma users
  // would set this up via maskType=ALPHA on the bitmap. Emit the
  // image so resvg can apply the alpha channel through luminance.
  if (node.dataUri === undefined) {
    throw new Error(`Image mask node ${node.id} is missing SVG image data`);
  }
  return image({
    href: node.dataUri,
    x: 0,
    y: 0,
    width: node.width,
    height: node.height,
    preserveAspectRatio: node.preserveAspectRatio,
  });
}

function coerceCornerRadius(cr: CornerRadius | undefined): readonly [number, number, number, number] {
  if (cr === undefined) { return [0, 0, 0, 0]; }
  if (typeof cr === "number") { return [cr, cr, cr, cr]; }
  return cr;
}

function createSvgImageAssetRegistry(): SvgImageAssetRegistry {
  const generation = svgImageAssetGeneration;
  svgImageAssetGeneration += 1;
  return {
    generation,
    byKey: new Map(),
    nextIndex: 0,
  };
}

function isDataImageHref(value: SvgAttributeValue): value is string {
  return typeof value === "string" && value.startsWith(DATA_IMAGE_URI_PREFIX);
}

function requireSvgImageAssetDimension(
  value: SvgAttributeValue,
  attributeName: "width" | "height",
): number | string {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  throw new Error(`SVG image asset hoisting requires image ${attributeName}`);
}

function optionalSvgNumberOrStringAttribute(
  value: SvgAttributeValue,
  attributeName: string,
): number | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  throw new Error(`SVG image asset hoisting requires ${attributeName} to be numeric or string when present`);
}

function optionalSvgStringAttribute(
  value: SvgAttributeValue,
  attributeName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`SVG image asset hoisting requires ${attributeName} to be a string when present`);
}

function svgImageAssetKey(
  attrs: SvgAttributes,
): string {
  return JSON.stringify([
    attrs.href,
    attrs.width,
    attrs.height,
    attrs.preserveAspectRatio,
  ]);
}

function getSvgImageAsset(
  attrs: SvgAttributes,
  registry: SvgImageAssetRegistry,
): SvgImageAsset {
  const key = svgImageAssetKey(attrs);
  const existing = registry.byKey.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const id = `higma-svg-image-asset-g${registry.generation}-${registry.nextIndex}`;
  registry.nextIndex += 1;
  const asset = {
    id,
    node: image({
      id,
      href: attrs.href as string,
      width: requireSvgImageAssetDimension(attrs.width, "width"),
      height: requireSvgImageAssetDimension(attrs.height, "height"),
      preserveAspectRatio: optionalSvgStringAttribute(attrs.preserveAspectRatio, "image preserveAspectRatio"),
    }),
  };
  registry.byKey.set(key, asset);
  return asset;
}

function replaceImageWithAssetUse(
  node: SvgElementNode,
  registry: SvgImageAssetRegistry,
): SvgNode {
  const asset = getSvgImageAsset(node.attrs, registry);
  return useElement({
    href: `#${asset.id}`,
    x: optionalSvgNumberOrStringAttribute(node.attrs.x, "image x"),
    y: optionalSvgNumberOrStringAttribute(node.attrs.y, "image y"),
    transform: optionalSvgStringAttribute(node.attrs.transform, "image transform"),
    opacity: optionalSvgNumberOrStringAttribute(node.attrs.opacity, "image opacity"),
    filter: optionalSvgStringAttribute(node.attrs.filter, "image filter"),
    mask: optionalSvgStringAttribute(node.attrs.mask, "image mask"),
  });
}

function rewriteSvgImageAssets(
  node: SvgNode,
  registry: SvgImageAssetRegistry,
): SvgNode {
  switch (node.kind) {
    case "fragment":
      return { ...node, children: node.children.map((child) => rewriteSvgImageAssets(child, registry)) };
    case "text":
      return node;
    case "element":
      if (node.name === "image" && isDataImageHref(node.attrs.href)) {
        return replaceImageWithAssetUse(node, registry);
      }
      return {
        ...node,
        children: node.children.map((child) => rewriteSvgImageAssets(child, registry)),
      };
  }
}

function hoistSvgImageAssets(root: SvgElementNode): SvgElementNode {
  const registry = createSvgImageAssetRegistry();
  const rewritten = rewriteSvgImageAssets(root, registry);
  if (registry.byKey.size === 0) {
    return root;
  }
  if (rewritten.kind !== "element") {
    throw new Error("SVG image asset hoisting requires an SVG root element");
  }
  return {
    ...rewritten,
    children: [
      defs(...Array.from(registry.byKey.values(), (asset) => asset.node)),
      ...rewritten.children,
    ],
  };
}

// =============================================================================
// RenderTree → SVG string
// =============================================================================

/**
 * Options for SVG formatting of a RenderTree.
 */
export type FormatRenderTreeToSvgOptions = {
  /**
   * Optional canvas background color (CSS color string). When provided,
   * emitted as a full-canvas <rect> before children — matches the original
   * SVG renderer's output ordering (defs are on nodes, not root-level).
   */
  readonly backgroundColor?: string;
};

/**
 * Format a RenderTree to the structured SVG element used as the SVG formatter SoT.
 *
 * This is a pure formatter — no attribute resolution happens here.
 * All rendering decisions were made by resolveRenderTree().
 */
export function formatRenderTreeToSvgElement(
  renderTree: RenderTree,
  options?: FormatRenderTreeToSvgOptions,
): SvgElementNode {
  const children = renderTree.children.map(formatNode);

  const body: SvgNode[] = [];
  if (options?.backgroundColor) {
    body.push(
      rect({
        x: renderTree.viewport.x,
        y: renderTree.viewport.y,
        width: renderTree.viewport.width,
        height: renderTree.viewport.height,
        fill: options.backgroundColor,
      }),
    );
  }
  // No root-level `<g clip-path>` wrapper. Figma's own SVG exporter
  // relies on (a) the `viewBox` attribute for visual clipping and
  // (b) callers pruning off-canvas subtrees before render.
  //
  // We mirror that here for two reasons:
  //
  //   1. SoT alignment — `pruneSceneGraphToViewport` already drops
  //      every subtree whose world-space bbox lies entirely outside
  //      the viewport (with a 64-unit safety pad for effect halos)
  //      *before* the render tree is built, so a defensive
  //      root-level clip-path was double-protection that no longer
  //      pulled weight.
  //
  //   2. resvg `<g clip-path>` quirk — every `<g clip-path="url(#…)">`
  //      isolates its descendants for compositing, so any inner
  //      `mix-blend-mode:…` paint blends against a transparent
  //      backdrop instead of the actual page background. The App
  //      Store template's Event metadata Light-variant Description /
  //      "Special event" text (`[{black @0.15 NORMAL}, {black @1
  //      OVERLAY}]`) collapsed to near-`#000` under this isolation
  //      where Figma's flat structure rasterises the expected
  //      mid-`#B3` overlay composite. Removing the root wrapper is
  //      what unblocks the blend.

  const svgChildren = projectChildrenToSvgViewportSpace(renderTree.viewport, [...body, ...children]);
  const built = svg(
    {
      width: renderTree.width,
      height: renderTree.height,
      viewBox: `0 0 ${formatSvgNumber(renderTree.viewport.width)} ${formatSvgNumber(renderTree.viewport.height)}`,
      fill: "none",
    },
    ...svgChildren,
  );
  const projected = projectFigmaExportTransforms(built);
  if (projected.kind !== "element" || projected.name !== "svg") {
    throw new Error("formatRenderTreeToSvgElement requires an SVG root element");
  }
  return hoistSvgImageAssets(projected);
}

/**
 * Format a RenderTree to an SVG string.
 *
 * This is a pure formatter — no attribute resolution happens here.
 * All rendering decisions were made by resolveRenderTree().
 */
export function formatRenderTreeToSvg(
  renderTree: RenderTree,
  options?: FormatRenderTreeToSvgOptions,
): SvgString {
  return serializeFigmaExportSvg(formatRenderTreeToSvgElement(renderTree, options));
}

function formatSvgNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }
  return String(value);
}

function projectChildrenToSvgViewportSpace(
  viewport: RenderTree["viewport"],
  children: readonly SvgNode[],
): readonly SvgNode[] {
  if (viewport.x === 0 && viewport.y === 0) {
    return children;
  }
  const translateX = formatSvgNumber(-viewport.x);
  const translateY = formatSvgNumber(-viewport.y);
  return [g({ transform: `translate(${translateX} ${translateY})` }, ...children)];
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Render a scene graph to SVG string.
 *
 * Resolves the SceneGraph to a RenderTree, then formats to SVG.
 */
export function renderSceneGraphToSvg(sceneGraph: SceneGraph, options?: SceneGraphRenderOptions): SvgString {
  const renderTree = resolveRenderTree(sceneGraph, options);
  return formatRenderTreeToSvg(renderTree);
}
