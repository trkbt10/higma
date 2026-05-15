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

import type { SceneGraph } from "@higma-document-models/fig/scene-graph";
import type { SceneGraphRenderOptions } from "../scene-graph/render";
import {
  resolveRenderTree,
  type RenderTree,
  type RenderNode,
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
  type RenderBackgroundBlur,
  type RenderNodeBase,
} from "../scene-graph/render-tree";

import type { ResolvedStrokeAttrs, ResolvedAngularGradient, ResolvedDiamondGradient } from "../scene-graph/render";

import type { ResolvedFilterPrimitive } from "../scene-graph/render";

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
  unsafeSvg,
  type SvgString,
  type SvgPaintAttrs,
  EMPTY_SVG,
} from "./primitives";

// =============================================================================
// Def Formatting
// =============================================================================

function formatClipPathShape(shape: ClipPathShape): SvgString {
  switch (shape.kind) {
    case "path":
      return path({ d: shape.d });
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

function formatFilterPrimitive(p: ResolvedFilterPrimitive): SvgString {
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
        k2: p.k2,
        k3: p.k3,
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

function formatAngularGradientDef(d: ResolvedAngularGradient): SvgString {
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

  const parts: SvgString[] = [];
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
function formatDiamondGradientDef(d: ResolvedDiamondGradient): SvgString {
  const w = d.elementWidth ?? 1;
  const h = d.elementHeight ?? 1;
  const cx = parseFloat(d.cx) * (d.cx.endsWith("%") ? w / 100 : 1) || (w / 2);
  const cy = parseFloat(d.cy) * (d.cy.endsWith("%") ? h / 100 : 1) || (h / 2);
  // Sample 32 concentric polygons, each a diamond (rhombus) at decreasing
  // scale; inner polygon uses the first stop, outer the last.
  const parts: SvgString[] = [];
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

function formatDef(def: RenderDef): SvgString {
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
      return clipPath({ id: def.id }, formatClipPathShape(def.shape));
    }
    case "mask": {
      // The mask's RenderNode tree carries its own resolved fills (e.g. a
      // BOOLEAN_OPERATION node's #000 fill) — emitting those verbatim makes
      // the entire mask render BLACK in luminance mode, which collapses to
      // "everything is hidden". The mask shape's geometry is what defines
      // the alpha; the colour is irrelevant. `formatNodeAsMaskShape` walks
      // the tree and emits each geometric shape with an explicit white fill
      // so the luminance mask actually exposes the masked content.
      //
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
      const maskContent = formatNodeAsMaskShape(def.maskContent);
      return mask(
        { id: def.id, style: "mask-type:luminance", maskUnits: "userSpaceOnUse" },
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
          { id: def.id, style: "mask-type:luminance", maskUnits: "userSpaceOnUse" },
          rect({ x: -100, y: -100, width: 10000, height: 10000, fill: "white" }),
          g({ fill: "black" }, shape),
        );
      }
      return mask(
        { id: def.id, style: "mask-type:luminance", maskUnits: "userSpaceOnUse" },
        g({ fill: "white" }, shape),
      );
    }
  }
}

function formatDefs(renderDefs: readonly RenderDef[]): SvgString {
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
  const w = node.wrapper;
  // Stacking-context isolation is added ONLY when a wrapper carries a
  // filter without a blend mode. The Figma SVG export does not isolate
  // a node that has `mix-blend-mode` set — the blend needs the parent's
  // pre-rendered contents as its backdrop, and `isolation:isolate`
  // would constrain the backdrop to the wrapper's own descendants and
  // void the blend (a HUE-blended world-map-style overlay was the
  // canary — the masked region rendered solid because the underlying
  // pattern from the grandparent never reached the blend's backdrop).
  //
  // We still isolate filter-only wrappers because SVG filters compose
  // their own rendering pass and historically benefit from a clean
  // stacking context boundary when no blend is in play (FRAMEs whose
  // SCREEN-blended descendants live on a different node are not
  // affected by this branch).
  const parts: string[] = [];
  if (w.blendMode) {parts.push(`mix-blend-mode:${w.blendMode}`);}
  if (w.filterAttr && !w.blendMode) {parts.push("isolation:isolate");}
  const style = parts.length > 0 ? parts.join(";") : undefined;
  return {
    transform: w.transform,
    opacity: w.opacity,
    filter: w.filterAttr,
    mask: node.mask?.maskAttr,
    style,
  };
}

// =============================================================================
// Corner Radius Helpers
// =============================================================================

import type { BlendMode } from "@higma-document-models/fig/scene-graph";
import type { ResolvedFillLayer } from "../scene-graph/render-tree";
import type { ResolvedStrokeLayer } from "../scene-graph/render";

import { buildRoundedRectPathD, type CornerRadius } from "@higma-primitives/path";

/**
 * Render a rectangle shape.
 *
 * Sharp-cornered rects (cr === undefined or 0) use `<rect>` because
 * there's no AA cost and `<rect>` produces smaller markup. Rounded
 * rects always use `<path>` with cubic Bézier corners — matching
 * Figma's SVG exporter's exact path d-string ensures the rounded
 * corner AA aligns to the same sub-pixels as actual exports, which
 * SVG's `<rect rx>` (rasterised by resvg-js via arc primitives) does
 * not consistently match.
 */
function formatRectShape(
  w: number, h: number, cr: CornerRadius | undefined,
  fillAttrs: SvgPaintAttrs,
  strokeAttrs: SvgPaintAttrs,
): SvgString {
  if (cr !== undefined && typeof cr !== "number") {
    return path({
      d: buildRoundedRectPathD(w, h, cr),
      ...fillAttrs,
      ...strokeAttrs,
    });
  }
  if (cr !== undefined && cr > 0) {
    return path({
      d: buildRoundedRectPathD(w, h, [cr, cr, cr, cr]),
      ...fillAttrs,
      ...strokeAttrs,
    });
  }
  return rect({
    x: 0, y: 0,
    width: w, height: h,
    ...fillAttrs,
    ...strokeAttrs,
  });
}

// =============================================================================
// Multi-fill Layer Helpers
// =============================================================================

function blendModeStyle(bm: BlendMode | undefined): string | undefined {
  return bm ? `mix-blend-mode:${bm}` : undefined;
}

/**
 * Render stacked rect shapes for multi-paint fills.
 * Each fill layer becomes its own rect/path element, bottom-to-top.
 */
function formatMultiFillRectLayers(
  layers: readonly ResolvedFillLayer[],
  w: number, h: number, cr: CornerRadius | undefined,
  strokeAttrs: SvgPaintAttrs,
): SvgString[] {
  return layers.map((layer, i): SvgString => {
    const fillAttrs: SvgPaintAttrs = {
      fill: layer.attrs.fill,
      "fill-opacity": layer.attrs.fillOpacity,
    };
    // Only last layer gets stroke
    const sAttrs: SvgPaintAttrs = i === layers.length - 1 ? strokeAttrs : {};
    const style = blendModeStyle(layer.blendMode);
    if (cr !== undefined && typeof cr !== "number") {
      return path({
        d: buildRoundedRectPathD(w, h, cr),
        ...fillAttrs,
        ...sAttrs,
        style,
      });
    }
    if (cr !== undefined && cr > 0) {
      return path({
        d: buildRoundedRectPathD(w, h, [cr, cr, cr, cr]),
        ...fillAttrs,
        ...sAttrs,
        style,
      });
    }
    return rect({
      x: 0, y: 0,
      width: w, height: h,
      ...fillAttrs,
      ...sAttrs,
      style,
    });
  });
}

/**
 * Render stacked ellipse shapes for multi-paint fills.
 */
function formatMultiFillEllipseLayers(
  layers: readonly ResolvedFillLayer[],
  cx: number, cy: number, rx: number, ry: number,
  strokeAttrs: StrokeSvgAttrs,
): SvgString[] {
  return layers.map((layer, i) => {
    const fillAttrs = {
      fill: layer.attrs.fill,
      "fill-opacity": layer.attrs.fillOpacity,
    };
    const sAttrs = i === layers.length - 1 ? strokeAttrs : {};
    const style = blendModeStyle(layer.blendMode);
    return ellipse({
      cx, cy, rx, ry,
      ...fillAttrs,
      ...sAttrs,
      style,
    });
  });
}

/**
 * Render stacked path shapes for multi-paint fills.
 */
function formatMultiFillPathLayers(
  layers: readonly ResolvedFillLayer[],
  paths: readonly { d: string; fillRule?: "evenodd" }[],
  strokeAttrs: StrokeSvgAttrs,
): SvgString[] {
  const result: SvgString[] = [];
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const fillAttrs = {
      fill: layer.attrs.fill,
      "fill-opacity": layer.attrs.fillOpacity,
    };
    const sAttrs = li === layers.length - 1 ? strokeAttrs : {};
    const style = blendModeStyle(layer.blendMode);
    for (const p of paths) {
      result.push(path({
        d: p.d,
        "fill-rule": p.fillRule,
        ...fillAttrs,
        ...sAttrs,
        style,
      }));
    }
  }
  return result;
}

// =============================================================================
// Multi-stroke Layer Helpers
// =============================================================================

/**
 * Render stacked rect strokes for multi-paint stroke layers.
 * Each stroke layer draws the same shape outline with its own color/gradient and blend mode.
 */
function formatMultiStrokeRectLayers(
  layers: readonly ResolvedStrokeLayer[],
  w: number, h: number, cr: CornerRadius | undefined,
): SvgString[] {
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
): SvgString[] {
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
): SvgString[] {
  const result: SvgString[] = [];
  for (const layer of layers) {
    const sAttrs = strokeToSvgAttrs(layer.attrs);
    const style = blendModeStyle(layer.blendMode);
    for (const p of paths) {
      result.push(path({
        d: p.d,
        "fill-rule": p.fillRule,
        fill: "none",
        ...sAttrs,
        style,
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
 * containing a div with `backdrop-filter: blur(Npx)`, clipped to the node's
 * shape via a clipPath.
 */
function formatBackgroundBlur(bgBlur: RenderBackgroundBlur): SvgString {
  const foContent = unsafeSvg(
    `<div xmlns="http://www.w3.org/1999/xhtml" style="backdrop-filter:blur(${bgBlur.radius}px);width:100%;height:100%"></div>`,
  );
  const fo = foreignObject(
    { x: bgBlur.bounds.x, y: bgBlur.bounds.y, width: bgBlur.bounds.width, height: bgBlur.bounds.height },
    foContent,
  );
  return g({ "clip-path": `url(#${bgBlur.clipId})` }, fo);
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

import type { StrokeRendering, StrokeShape } from "../scene-graph/render-tree";

/**
 * Format a stroked shape element from StrokeShape + stroke attrs.
 */
function formatStrokedShape(shape: StrokeShape, sAttrs: StrokeSvgAttrs): SvgString {
  switch (shape.kind) {
    case "rect":
      return formatRectShape(shape.width, shape.height, shape.cornerRadius, { fill: "none" }, sAttrs);
    case "ellipse":
      if (shape.rx === shape.ry) {
        return circle({ cx: shape.cx, cy: shape.cy, r: shape.rx, fill: "none", ...sAttrs });
      }
      return ellipse({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry, fill: "none", ...sAttrs });
    case "path": {
      const els = shape.paths.map((p) =>
        path({ d: p.d, "fill-rule": p.fillRule, fill: "none", ...sAttrs }),
      );
      return els.length === 1 ? els[0] : g({}, ...els);
    }
  }
}

/**
 * Format multi-paint stroke layers from StrokeShape.
 */
function formatStrokeLayersForShape(layers: readonly ResolvedStrokeLayer[], shape: StrokeShape): SvgString[] {
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
function formatStrokeRendering(sr: StrokeRendering): SvgString[] {
  switch (sr.mode) {
    case "uniform":
      return [];

    case "masked": {
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

    case "individual": {
      const { sides, color, opacity, width: w, height: h, cornerRadius, strokeAlign } = sr;
      const lines: SvgString[] = [];
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
      if (cornerRadius && cornerRadius > 0 && strokeAlign !== "OUTSIDE") {
        // Clip to the rounded rect so per-side strokes don't bleed past
        // the rounded corners. Without this, an 8-px top stroke on a
        // r=24 rounded frame paints a horizontal band from y=0 to y=8
        // straight across the corner curve, producing a square-cornered
        // band visibly mismatched with Figma's exporter (which emits a
        // path-based inside-stroke that follows the rounded perimeter).
        const clipId = `inside-stroke-clip-${w}-${h}-${cornerRadius}`.replace(/\./g, "_");
        const clipDef = unsafeSvg(`<clipPath id="${clipId}"><rect x="0" y="0" width="${w}" height="${h}" rx="${cornerRadius}" ry="${cornerRadius}"/></clipPath>`);
        return [g({ "clip-path": `url(#${clipId})` }, clipDef, ...lines)];
      }
      return lines;
    }
  }
}

// =============================================================================
// Shape Node Assembly
// =============================================================================

/**
 * Assemble a shape node's parts into a wrapped SVG group.
 *
 * All shape nodes (rect, ellipse, path, frame) share the same final assembly:
 * 1. Prepend defs
 * 2. Append background blur (if present)
 * 3. Wrap in <g> with wrapper attrs
 *
 * This prevents scattered backgroundBlur/defs handling across every formatter.
 */
function assembleShapeNode(
  node: { readonly defs: readonly RenderDef[]; readonly backgroundBlur?: RenderBackgroundBlur } & RenderNodeBase,
  shapeContent: readonly SvgString[],
): SvgString {
  const parts: SvgString[] = [];
  const defsStr = formatDefs(node.defs);
  if (defsStr !== EMPTY_SVG) { parts.push(defsStr); }
  parts.push(...shapeContent);
  if (node.backgroundBlur) { parts.push(formatBackgroundBlur(node.backgroundBlur)); }
  return g(wrapperAttrs(node), ...parts);
}

// =============================================================================
// Node Formatters
// =============================================================================

/**
 * True when a frame's clamped corner radius implies a non-rectangular
 * visible boundary. Square-cornered frames (radius 0 / undefined) have a
 * bg fill that fully covers the frame interior, so the bg-on-top trick
 * works for clip-elision; rounded frames have transparent corner-curve
 * regions that a child fill can paint into, so the clip MUST stay.
 */
function hasNonZeroCornerRadius(cr: CornerRadius | undefined): boolean {
  if (cr === undefined) { return false; }
  if (typeof cr === "number") { return cr > 0; }
  return cr.some((r: number) => r > 0);
}

/**
 * Returns true if the children subtree contains a `mix-blend-mode` whose
 * backdrop *requires* the current frame's bg to render correctly.
 *
 * resvg-js's mix-blend-mode resolves the blend's backdrop by walking up
 * to the nearest stacking-context-introducing ancestor. Each `<g
 * clip-path="…">` along the chain creates a fresh stacking context, so
 * a blend node deep inside nested clipped frames samples the wrong
 * layer (it sees the inner clip's contents only, not the outer frame's
 * backdrop fill). When this returns true, we elide the current frame's
 * children-clip wrapper so the blend reaches the frame's bg directly.
 *
 * Heuristic: traverse children, but DON'T descend into a child frame
 * that already has its own `childClipId` — that frame owns its own
 * elision decision and its bg is the proper backdrop for any blend
 * inside it. Eliding a clip on behalf of such a deep blend would lose
 * visible clipping for unrelated siblings without helping the blend
 * (which is sampled relative to the deeper frame's bg, not ours).
 *
 * Both wrapper-level blend modes (CSS `mix-blend-mode` set on `<g>`
 * via `node.wrapper.blendMode`) and paint-level blend modes (set on a
 * single fill layer in `node.background.fillLayers[i].blendMode` or on
 * `node.fillLayers[i]` for shape nodes) trigger elision, since the
 * same backdrop-sampling rule applies regardless of which level the
 * blend mode lives at.
 */
function subtreeHasBlendModeRequiringThisBackdrop(nodes: readonly RenderNode[]): boolean {
  for (const n of nodes) {
    if (n.wrapper.blendMode !== undefined) { return true; }
    if (n.type === "frame") {
      if (n.background?.fillLayers?.some((l) => l.blendMode !== undefined)) { return true; }
      // Stop descending into a child frame that owns its own clip —
      // its bg is the proper backdrop for any deeper blend.
      if (n.childClipId === undefined) {
        if (subtreeHasBlendModeRequiringThisBackdrop(n.children)) { return true; }
      }
    } else if (n.type === "group") {
      if (subtreeHasBlendModeRequiringThisBackdrop(n.children)) { return true; }
    } else if (n.type === "rect" || n.type === "ellipse" || n.type === "path") {
      if (n.fillLayers?.some((l) => l.blendMode !== undefined)) { return true; }
    }
  }
  return false;
}

function formatGroupNode(node: RenderGroupNode): SvgString {
  const children = node.children.map(formatNode);
  const defsStr = formatDefs(node.defs);

  // Optimization: unwrap single child if no wrapper attrs needed
  if (node.canUnwrapSingleChild && children.length === 1 && node.defs.length === 0) {
    return children[0];
  }

  const parts: SvgString[] = [];
  if (defsStr !== EMPTY_SVG) { parts.push(defsStr); }
  parts.push(...children);

  return g(wrapperAttrs(node), ...parts);
}

function formatFrameNode(node: RenderFrameNode): SvgString {
  const parts: SvgString[] = [];
  const defsStr = formatDefs(node.defs);
  if (defsStr !== EMPTY_SVG) { parts.push(defsStr); }

  // Build background fragments separately so we can choose where to
  // splice them: outside the clip wrapper for the standard case, or
  // INSIDE it when a child has `mix-blend-mode`. resvg-js applies
  // mix-blend-mode by sampling the immediate parent's backdrop — when
  // the bg lives outside the clip group, the blend's backdrop becomes
  // the SVG canvas behind the clip group instead of the frame's own
  // background, and the blend silently degrades to source-over. Putting
  // the bg inside the same clip group restores the correct backdrop and
  // mirrors Figma's own SVG export structure (which always nests the
  // frame's path-1-inside-1 / radial fills inside the clip wrapper).
  //
  // Strokes (especially OUTSIDE/CENTER align with `strokeRendering`)
  // need to live OUTSIDE the clip wrapper so the half of the stroke
  // that extends beyond the frame edge isn't clipped — Figma's exporter
  // always emits the bg stroke as a sibling of the clip group, not as
  // its child. Without this split, Flag's 1px white SOFT_LIGHT outline
  // disappears at the rounded corners (Flag part diff was 9% before
  // separating stroke out).
  const bgFillParts: SvgString[] = [];
  const bgStrokeParts: SvgString[] = [];
  if (node.background) {
    const sr = node.background.strokeRendering;
    const fillStrokeAttrs = getUniformStrokeAttrs(sr);

    if (node.background.fillLayers) {
      bgFillParts.push(...formatMultiFillRectLayers(
        node.background.fillLayers, node.width, node.height, node.cornerRadius, fillStrokeAttrs,
      ));
    } else {
      const fillAttrs = fillToSvgAttrs(node.background.fill);
      bgFillParts.push(formatRectShape(node.width, node.height, node.cornerRadius, fillAttrs, fillStrokeAttrs));
    }

    if (sr) {
      bgStrokeParts.push(...formatStrokeRendering(sr));
    }
  }

  if (node.backgroundBlur) {
    bgFillParts.push(formatBackgroundBlur(node.backgroundBlur));
  }

  const childElements = node.children.map(formatNode);
  const childClipId = node.omitChildClip ? undefined : node.childClipId;
  if (childClipId && childElements.length > 0) {
    // Clip elision is only safe for SQUARE-CORNERED frames. When the
    // frame has a non-zero corner radius, children that paint past the
    // bg's rounded edge (e.g. an IMAGE/LIGHTEN-blended fill on a child
    // frame whose own bbox is rectangular) bleed past the rounded
    // corners — no amount of bg-on-top compensates because the bg is
    // transparent in the corner-curve area. The clip MUST stay even
    // when blend modes prefer it gone.
    const hasRoundedCorners = hasNonZeroCornerRadius(node.cornerRadius);
    if (!hasRoundedCorners && subtreeHasBlendModeRequiringThisBackdrop(node.children)) {
      // Skip the inner clip wrapper — resvg-js's stacking context
      // discipline breaks `mix-blend-mode` backdrop sampling for any
      // descendant that sits inside a nested clip-path. The frame's
      // own rect bg above already enforces the visible boundary
      // exactly because the frame is square-cornered.
      parts.push(...bgFillParts, ...childElements, ...bgStrokeParts);
    } else {
      parts.push(g({ "clip-path": `url(#${childClipId})` }, ...bgFillParts, ...childElements));
      parts.push(...bgStrokeParts);
    }
  } else {
    parts.push(...bgFillParts, ...childElements, ...bgStrokeParts);
  }

  return g(wrapperAttrs(node), ...parts);
}

function formatRectNodeContent(node: RenderRectNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgString[] {
  const strokeAttrs = fillStrokeAttrs ?? {};
  if (node.fillLayers) {
    return formatMultiFillRectLayers(node.fillLayers, node.width, node.height, node.cornerRadius, strokeAttrs);
  }
  return [formatRectShape(node.width, node.height, node.cornerRadius, fillToSvgAttrs(node.fill), strokeAttrs)];
}

function formatEllipseElement(node: RenderEllipseNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgString {
  const fillAttrs = fillToSvgAttrs(node.fill);
  const strokeAttrs = fillStrokeAttrs ?? {};
  if (node.rx === node.ry) {
    return circle({ cx: node.cx, cy: node.cy, r: node.rx, ...fillAttrs, ...strokeAttrs });
  }
  return ellipse({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry, ...fillAttrs, ...strokeAttrs });
}

function formatEllipseNodeContent(node: RenderEllipseNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgString[] {
  const strokeAttrs = fillStrokeAttrs ?? {};
  if (node.fillLayers) {
    return formatMultiFillEllipseLayers(node.fillLayers, node.cx, node.cy, node.rx, node.ry, strokeAttrs);
  }
  return [formatEllipseElement(node, fillStrokeAttrs)];
}

function formatPathElements(node: RenderPathNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgString[] {
  const defaultFillAttrs = fillToSvgAttrs(node.fill);
  const strokeAttrs = fillStrokeAttrs ?? {};
  return node.paths.map((p) => {
    const fa = fillAttrsForPath(p.fillOverride, defaultFillAttrs);
    return path({ d: p.d, "fill-rule": p.fillRule, ...fa, ...strokeAttrs });
  });
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

function formatPathNodeContent(node: RenderPathNode, fillStrokeAttrs: StrokeSvgAttrs | undefined): SvgString[] {
  if (node.fillLayers) {
    return formatMultiFillPathLayers(node.fillLayers, node.paths, fillStrokeAttrs ?? {});
  }
  return formatPathElements(node, fillStrokeAttrs);
}

function clipSvgContent(content: SvgString, clipId: string | undefined): SvgString {
  if (!clipId) { return content; }
  return g({ "clip-path": `url(#${clipId})` }, content);
}

function fontVariationStyle(fontVariationSettings: string | undefined): string | undefined {
  if (!fontVariationSettings) { return undefined; }
  return `font-variation-settings:${fontVariationSettings}`;
}

function groupMultipleTextElements(textElements: readonly SvgString[]): SvgString {
  if (textElements.length === 1) { return textElements[0]; }
  return g({}, ...textElements);
}

function textAnchorValue(textAnchor: string): "middle" | "end" | undefined {
  if (textAnchor === "middle" || textAnchor === "end") {
    return textAnchor;
  }
  return undefined;
}

function formatRectNode(node: RenderRectNode): SvgString {
  const sr = node.strokeRendering;
  const fillStrokeAttrs = getUniformStrokeAttrs(sr);

  if (node.fillLayers || sr) {
    const content = formatRectNodeContent(node, fillStrokeAttrs);
    if (sr) {
      content.push(...formatStrokeRendering(sr));
    }
    return assembleShapeNode(node, content);
  }

  const rectEl = formatRectShape(node.width, node.height, node.cornerRadius, fillToSvgAttrs(node.fill), fillStrokeAttrs);

  if (node.needsWrapper) {
    return assembleShapeNode(node, [rectEl]);
  }
  return rectEl;
}

function formatEllipseNode(node: RenderEllipseNode): SvgString {
  const sr = node.strokeRendering;
  const fillStrokeAttrs = getUniformStrokeAttrs(sr);

  if (node.fillLayers || sr) {
    const content = formatEllipseNodeContent(node, fillStrokeAttrs);
    if (sr) {
      content.push(...formatStrokeRendering(sr));
    }
    return assembleShapeNode(node, content);
  }

  const el = formatEllipseElement(node, fillStrokeAttrs);

  if (node.needsWrapper) {
    return assembleShapeNode(node, [el]);
  }
  return el;
}

function formatPathNode(node: RenderPathNode): SvgString {
  if (node.paths.length === 0) {
    return EMPTY_SVG;
  }

  const sr = node.strokeRendering;
  const fillStrokeAttrs = getUniformStrokeAttrs(sr);
  if (node.fillLayers || sr) {
    const content = formatPathNodeContent(node, fillStrokeAttrs);
    if (sr) { content.push(...formatStrokeRendering(sr)); }
    return assembleShapeNode(node, content);
  }

  const defaultFillAttrs = fillToSvgAttrs(node.fill);
  const pathElements: SvgString[] = node.paths.map((p) => {
    const fa = fillAttrsForPath(p.fillOverride, defaultFillAttrs);
    return path({ d: p.d, "fill-rule": p.fillRule, ...fa, ...fillStrokeAttrs });
  });

  if (node.needsWrapper) {
    return assembleShapeNode(node, pathElements);
  }
  return pathElements[0];
}

function formatTextNode(node: RenderTextNode): SvgString {
  const defsStr = formatDefs(node.defs);

  if (node.content.mode === "glyphs") {
    const runs = node.content.runs;
    if (runs.length === 0) {
      return EMPTY_SVG;
    }
    // One <path> per fill run. The render-tree resolver already grouped
    // glyph contours by their TextRun and attached the resolved
    // fillColor/fillOpacity, so the formatter just emits each run as-is.
    const runPaths: SvgString[] = runs.map((run) => path({
      d: run.d,
      fill: run.fillColor,
      "fill-opacity": run.fillOpacity < 1 ? run.fillOpacity : undefined,
    }));
    const glyphBody: SvgString = runPaths.length === 1 ? runPaths[0] : g({}, ...runPaths);
    const glyphContent = node.hyperlink ? svgAnchor({ href: node.hyperlink }, glyphBody) : glyphBody;
    const content = clipSvgContent(glyphContent, node.textClipId);

    const parts: SvgString[] = [];
    if (defsStr !== EMPTY_SVG) { parts.push(defsStr); }
    parts.push(content);

    return g(wrapperAttrs(node), ...parts);
  }

  // Text line layout: <text> elements
  const fb = node.content.layout;
  if (fb.lines.length === 0) {
    return EMPTY_SVG;
  }

  const textAnchor = textAnchorValue(fb.textAnchor);
  const fontVarStyle = fontVariationStyle(fb.fontVariationSettings);

  const textElements: SvgString[] = fb.lines.map((line) =>
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

  const parts: SvgString[] = [];
  if (defsStr !== EMPTY_SVG) { parts.push(defsStr); }
  parts.push(clippedContent);

  return g(wrapperAttrs(node), ...parts);
}

function formatImageNode(node: RenderImageNode): SvgString {
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
  });

  if (node.needsWrapper) {
    return g(wrapperAttrs(node), imageEl);
  }
  return imageEl;
}

function formatNode(node: RenderNode): SvgString {
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
 * Format a RenderNode as the alpha source of an SVG luminance mask.
 *
 * The geometry of the node tree is the only thing that matters for the
 * mask shape — colours, gradients, strokes, blur, blend modes are all
 * irrelevant because the luminance mask only consumes per-pixel
 * luminance. Emitting the node through the normal `formatNode` pipeline
 * paints every shape with its resolved fill (often the source node's
 * #000 colour), which renders the mask black and hides everything.
 *
 * This helper walks the tree and emits each geometric primitive with an
 * explicit `fill="white"` (so the rendered luminance is 1.0 inside the
 * shape, 0.0 outside — exactly the alpha pattern the mask shape
 * encodes). Transforms and the node's own wrapper are preserved so
 * nested masks/groups land in the correct coordinate system.
 *
 * The pattern matches Figma's SVG export: every `<mask>` body the
 * exporter emits is a single `<path fill="white">` (or `<rect
 * fill="white">`) regardless of what colour the source node carries.
 */
function formatNodeAsMaskShape(node: RenderNode): SvgString {
  const wrapper = node.wrapper;
  const wrapperAttrs: Record<string, string | number | undefined> = {
    transform: wrapper.transform,
  };
  const body = formatNodeAsMaskShapeBody(node);
  // Wrap in <g transform=...> when the node carries a transform so child
  // coordinates stay local to the node's own frame, matching the way the
  // node would render in its non-mask path.
  if (wrapper.transform === undefined) {
    return body;
  }
  return g(wrapperAttrs, body);
}

function formatNodeAsMaskShapeBody(node: RenderNode): SvgString {
  switch (node.type) {
    case "path": {
      const parts = node.paths.map((p) =>
        path({ d: p.d, "fill-rule": p.fillRule, fill: "white" }),
      );
      if (parts.length === 1) {
        return parts[0];
      }
      return g({}, ...parts);
    }
    case "rect": {
      if (node.cornerRadius !== undefined) {
        return path({
          d: buildRoundedRectPathD(node.width, node.height, coerceCornerRadius(node.cornerRadius)),
          fill: "white",
        });
      }
      return rect({ x: 0, y: 0, width: node.width, height: node.height, fill: "white" });
    }
    case "ellipse": {
      if (node.rx === node.ry) {
        return circle({ cx: node.cx, cy: node.cy, r: node.rx, fill: "white" });
      }
      return ellipse({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry, fill: "white" });
    }
    case "group": {
      const children = node.children.map(formatNodeAsMaskShape);
      if (children.length === 1) {
        return children[0];
      }
      return g({}, ...children);
    }
    case "frame": {
      // Frame as a mask: emit its rounded-rect background as the shape.
      // Children of a frame-as-mask are unusual and would each need to
      // be treated as additive mask geometry — fall through to a group.
      const bgEl = path({
        d: buildRoundedRectPathD(
          node.width,
          node.height,
          coerceCornerRadius(node.cornerRadius),
        ),
        fill: "white",
      });
      if (node.children.length === 0) {
        return bgEl;
      }
      const childEls = node.children.map(formatNodeAsMaskShape);
      return g({}, bgEl, ...childEls);
    }
    case "text": {
      // Text used as a mask emits its glyph contours with white fill —
      // colour-carrying runs collapse to the same alpha because each run
      // is fully opaque inside the glyph contour.
      if (node.content.mode === "glyphs") {
        const parts = node.content.runs.map((run) => path({ d: run.d, fill: "white" }));
        if (parts.length === 1) { return parts[0]; }
        return g({}, ...parts);
      }
      // Line-mode text is not meaningfully usable as a mask shape (the
      // glyph contours aren't resolved). Emit empty so the mask falls
      // through to its background (black → invisible).
      return EMPTY_SVG;
    }
    case "image": {
      // Image-as-mask uses the image's intrinsic alpha; Figma users
      // would set this up via maskType=ALPHA on the bitmap. Emit the
      // image so resvg can apply the alpha channel through luminance.
      return image({
        href: node.dataUri,
        x: 0,
        y: 0,
        width: node.width,
        height: node.height,
        preserveAspectRatio: node.preserveAspectRatio,
      });
    }
  }
}

function coerceCornerRadius(cr: CornerRadius | undefined): readonly [number, number, number, number] {
  if (cr === undefined) { return [0, 0, 0, 0]; }
  if (typeof cr === "number") { return [cr, cr, cr, cr]; }
  return cr;
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
 * Format a RenderTree to an SVG string.
 *
 * This is a pure formatter — no attribute resolution happens here.
 * All rendering decisions were made by resolveRenderTree().
 */
export function formatRenderTreeToSvg(
  renderTree: RenderTree,
  options?: FormatRenderTreeToSvgOptions,
): SvgString {
  const children = renderTree.children.map(formatNode);

  const body: SvgString[] = [];
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

  // Root viewport clip-path — Figma's own SVG exporter always wraps the
  // canvas-rooted `<g>` in a clip whose shape is the viewport rect. We
  // mirror that for two reasons:
  //
  //   1. Correctness anchor — content that lives outside the viewport
  //      (auto-layout overflow, off-canvas INSTANCEs, etc.) should not
  //      bleed onto neighbouring exports when the user composes our
  //      output into a larger document.
  //
  //   2. Resvg robustness — empirically, masked subtrees translated
  //      fully outside the SVG viewport crash resvg with
  //      `geom.rs:27 unwrap None`. The root clip prunes them at parse
  //      time so the renderer never tries to compute a bounding box on
  //      content with no visible footprint.
  //
  // The clipPath def is emitted alongside the content; SVG's lookup
  // scope makes a sibling `<defs>` and a `<g clip-path>` reference each
  // other regardless of order, but emitting the def first matches
  // Figma's output layout and keeps the diff harness happier.
  const viewportClipId = "root-viewport-clip";
  body.unshift(
    defs(
      clipPath(
        { id: viewportClipId },
        rect({
          x: renderTree.viewport.x,
          y: renderTree.viewport.y,
          width: renderTree.viewport.width,
          height: renderTree.viewport.height,
        }),
      ),
    ),
  );
  // Wrap content children (everything after the optional background and
  // the defs we just unshifted) inside the clip group.
  const bgCount = options?.backgroundColor ? 1 : 0;
  const defsCount = 1;
  const leading = body.slice(0, bgCount + defsCount);
  const wrappedChildren = g({ "clip-path": `url(#${viewportClipId})` }, ...children);

  return svg(
    {
      width: renderTree.width,
      height: renderTree.height,
      viewBox: `${renderTree.viewport.x} ${renderTree.viewport.y} ${renderTree.viewport.width} ${renderTree.viewport.height}`,
    },
    ...leading,
    wrappedChildren,
  );
}

// =============================================================================
// Public API (backward-compatible)
// =============================================================================

/**
 * Render a scene graph to SVG string.
 *
 * Resolves the SceneGraph to a RenderTree, then formats to SVG.
 * This is the backward-compatible entry point.
 */
export function renderSceneGraphToSvg(sceneGraph: SceneGraph, options?: SceneGraphRenderOptions): SvgString {
  const renderTree = resolveRenderTree(sceneGraph, options);
  return formatRenderTreeToSvg(renderTree);
}
