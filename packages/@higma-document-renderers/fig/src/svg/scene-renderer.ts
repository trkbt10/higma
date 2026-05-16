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
      // Match Figma's SVG-exporter byte pattern for mask layers. The
      // exporter picks one of three styles depending on the source
      // node's geometry and stroke:
      //
      //   • Simple single-subpath shapes with NO stroke (a plain
      //     rounded rect, a circle, a closed path) →
      //     `mask-type:alpha` + `fill="#D9D9D9"`.
      //   • Compound multi-subpath shapes (typically the flattened
      //     output of a BOOLEAN_OPERATION mask — outer outline plus
      //     interior holes joined with even-odd fill) →
      //     `mask-type:luminance` + `fill="white"`.
      //   • Shapes whose source node carries a non-zero stroke (e.g.
      //     the iPhone screen-interior mask — a 165.81×360.49 rounded
      //     rect with `strokeWeight=1` in the SYMBOL that renders as
      //     `stroke-width≈0.825` after scaling) →
      //     `mask-type:luminance` + `fill="white" stroke="white"
      //     stroke-width="…"`. The stroke pass widens the visible mask
      //     region by half the stroke width on each side, matching
      //     Figma's behaviour where the mask area equals the source
      //     shape's painted bounds (fill + stroke).
      //
      // Per SVG spec `mask-type:alpha` reads the source's alpha
      // channel; for an opaque fill (alpha=1.0) every spec-compliant
      // renderer should treat the masked region as fully visible.
      // resvg however always derives mask alpha from RGB luminance
      // regardless of `mask-type`, so `#D9D9D9` collapses to ≈85%
      // pass-through and `white` stays at 100%. By matching Figma's
      // per-shape style choice we end up with the same cumulative
      // alpha as Figma's own export under resvg — critical for nested
      // masks (e.g. iPhone outer outline mask ×85% × Screen-mask
      // ×100% = 85%, vs the wrong 85% × 85% ≈ 72% we'd get if every
      // mask used the alpha+#D9D9D9 form). For the stroked-source
      // case, leaving the mask at alpha+#D9D9D9 would let the wave
      // gradient bleed through the screen interior at ~85% pass-
      // through — the visible "cyan tint" in App page screenshots.
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
      const compound = isCompoundMaskGeometry(def.maskContent);
      const maskStroke = getMaskSourceStrokeWidth(def.maskContent);
      const luminance = compound || maskStroke !== undefined;
      const maskFill = luminance ? "white" : MASK_SHAPE_FILL;
      const maskStyle = luminance ? "mask-type:luminance" : "mask-type:alpha";
      const strokeAttrs = maskStroke !== undefined
        ? { stroke: "white" as const, "stroke-width": maskStroke }
        : undefined;
      const maskContent = formatNodeAsMaskShape(def.maskContent, maskFill, strokeAttrs);
      return mask(
        { id: def.id, style: maskStyle, maskUnits: "userSpaceOnUse" },
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

import { buildRoundedRectPathD, buildSmoothedRoundedRectPathD, type CornerRadius } from "@higma-primitives/path";

/**
 * Render a rectangle shape.
 *
 * Sharp-cornered rects (`cr` undefined or 0) and equal-corner rounded
 * rects emit as native `<rect>` / `<rect rx>` — matching Figma's SVG
 * exporter's byte pattern. Theirs uses `<rect rx="…"/>` exclusively for
 * uniform-corner rounded rects (App page screenshots iPhone bezels
 * `rx=24`, AppStore Search Cell icon mounts, the Metadata icon outline)
 * and our renderer previously emitted these as `<path>` with cubic-
 * Bezier corners, producing a slightly different sub-pixel AA pattern
 * along rounded boundaries (the App page screenshots / AppStore Search
 * Cell bezel-edge diff). Only per-corner-differing radii fall back to
 * `<path>` because SVG `<rect rx>` cannot express that shape.
 *
 * When `cornerSmoothing > 0` (Figma's iOS-style continuous-curvature
 * toggle, on by default for App Store template assets at 0.6), the
 * standard SVG `<rect rx>` and quarter-circle path no longer match
 * the visible corner: the smoothed corner extends `r·(1+s)` along
 * each edge with a continuous-curvature transition. We route those
 * through `buildSmoothedRoundedRectPathD`, which produces the same
 * three-cubic-Bezier-per-corner byte pattern Figma's exporter emits.
 */
function formatRectShape(
  w: number, h: number, cr: CornerRadius | undefined,
  fillAttrs: SvgPaintAttrs,
  strokeAttrs: SvgPaintAttrs,
  cornerSmoothing?: number,
): SvgString {
  const smoothing = typeof cornerSmoothing === "number" && cornerSmoothing > 0 ? cornerSmoothing : 0;
  if (smoothing > 0) {
    const radii = cornerRadiusToTuple(cr);
    if (radii) {
      return path({
        d: buildSmoothedRoundedRectPathD(w, h, radii, smoothing),
        ...fillAttrs,
        ...strokeAttrs,
      });
    }
  }
  const uniform = uniformCornerRadius(cr);
  if (uniform === undefined && cr !== undefined && typeof cr !== "number") {
    return path({
      d: buildRoundedRectPathD(w, h, cr),
      ...fillAttrs,
      ...strokeAttrs,
    });
  }
  const rxValue = uniform ?? (typeof cr === "number" ? cr : 0);
  const rxAttr = rxValue > 0 ? { rx: rxValue } : {};
  return rect({
    x: 0, y: 0,
    width: w, height: h,
    ...rxAttr,
    ...fillAttrs,
    ...strokeAttrs,
  });
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
    if (cr <= 0) { return undefined; }
    return [cr, cr, cr, cr];
  }
  const [tl, tr, br, bl] = cr;
  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) { return undefined; }
  return [tl, tr, br, bl];
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
  cornerSmoothing?: number,
): SvgString[] {
  const smoothing = typeof cornerSmoothing === "number" && cornerSmoothing > 0 ? cornerSmoothing : 0;
  return layers.map((layer, i): SvgString => {
    const fillAttrs: SvgPaintAttrs = {
      fill: layer.attrs.fill,
      "fill-opacity": layer.attrs.fillOpacity,
    };
    // Only last layer gets stroke
    const sAttrs: SvgPaintAttrs = i === layers.length - 1 ? strokeAttrs : {};
    const style = blendModeStyle(layer.blendMode);
    if (smoothing > 0) {
      const radii = cornerRadiusToTuple(cr);
      if (radii) {
        return path({
          d: buildSmoothedRoundedRectPathD(w, h, radii, smoothing),
          ...fillAttrs,
          ...sAttrs,
          style,
        });
      }
    }
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
      return formatRectShape(shape.width, shape.height, shape.cornerRadius, { fill: "none" }, sAttrs, shape.cornerSmoothing);
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
): SvgString | undefined {
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
  const smoothing = shape.kind === "rect" && typeof shape.cornerSmoothing === "number" && shape.cornerSmoothing > 0
    ? shape.cornerSmoothing
    : 0;
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
  if (smoothing > 0) {
    // For smoothed corners, pass the SOURCE radii (not the inset
    // ones) and the stroke half-width; `buildSmoothedRoundedRectPathD`
    // applies Figma's hybrid inset formula internally so the smoothing
    // extent `p` and arc curvature are reconciled correctly. Passing
    // the already-inset radii via the no-inset path would tighten the
    // arc but leave `p` un-adjusted, producing a corner that overshoots
    // theirs's emission by ~0.4 unit on `p` (calibration: iPhone
    // bezel Aluminum stroke at scale 0.2009).
    const sourceRadii = cornerRadiusToTuple(shape.cornerRadius);
    if (sourceRadii) {
      const d = buildSmoothedRoundedRectPathD(w, h, sourceRadii, smoothing, { x, y }, sign * half);
      return path({ d, ...fillAttrs, ...sAttrs });
    }
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
    const adjusted = cr - delta;
    return adjusted > 0 ? adjusted : 0;
  }
  return cr.map((r) => (r - delta > 0 ? r - delta : 0)) as unknown as CornerRadius;
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
      // Rect/rounded-rect with INSIDE/OUTSIDE alignment: emit Figma's
      // canonical inset/outset-rect pattern so the stroke's dash phase
      // matches Figma's exporter. The masked-doubled-stroke fallback
      // remains for ellipse/path shapes, where the offset transform is
      // more involved.
      const aligned = tryFormatAlignedRectStroke(sr.shape, sr.attrs);
      if (aligned !== undefined) {
        if (sr.blendMode) {
          return [g({ style: blendModeStyle(sr.blendMode) }, aligned)];
        }
        return [aligned];
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
        node.background.fillLayers, node.width, node.height, node.cornerRadius, fillStrokeAttrs, node.cornerSmoothing,
      ));
    } else {
      const fillAttrs = fillToSvgAttrs(node.background.fill);
      bgFillParts.push(formatRectShape(node.width, node.height, node.cornerRadius, fillAttrs, fillStrokeAttrs, node.cornerSmoothing));
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
    return formatMultiFillRectLayers(node.fillLayers, node.width, node.height, node.cornerRadius, strokeAttrs, node.cornerSmoothing);
  }
  return [formatRectShape(node.width, node.height, node.cornerRadius, fillToSvgAttrs(node.fill), strokeAttrs, node.cornerSmoothing)];
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

  const rectEl = formatRectShape(node.width, node.height, node.cornerRadius, fillToSvgAttrs(node.fill), fillStrokeAttrs, node.cornerSmoothing);

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
    // fillColor/fillOpacity/blendMode, so the formatter just emits
    // each run as-is. `style="mix-blend-mode:…"` is applied when the
    // source paint carries a non-NORMAL blend (Event metadata's
    // `[{black @0.15 NORMAL}, {black @1 OVERLAY}]` stack relies on
    // the OVERLAY pass to land at mid-grey instead of solid black).
    const runPaths: SvgString[] = runs.map((run) => path({
      d: run.d,
      fill: run.fillColor,
      "fill-opacity": run.fillOpacity < 1 ? run.fillOpacity : undefined,
      style: blendModeStyle(run.blendMode),
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
type MaskStrokeAttrs = { readonly stroke: "white"; readonly "stroke-width": number };

function formatNodeAsMaskShape(node: RenderNode, fill: string, strokeAttrs?: MaskStrokeAttrs): SvgString {
  const wrapper = node.wrapper;
  const wrapperAttrs: Record<string, string | number | undefined> = {
    transform: wrapper.transform,
  };
  const body = formatNodeAsMaskShapeBody(node, fill, strokeAttrs);
  // Wrap in <g transform=...> when the node carries a transform so child
  // coordinates stay local to the node's own frame, matching the way the
  // node would render in its non-mask path.
  if (wrapper.transform === undefined) {
    return body;
  }
  return g(wrapperAttrs, body);
}

/**
 * Return the SVG `stroke-width` to emit when a mask source node carries
 * a stroke. Returns undefined when the source has no stroke (the normal
 * fill-only mask path). Figma's SVG exporter widens the visible mask
 * region by half the stroke width on each side via `stroke="white"
 * stroke-width="…"`, matching the source shape's painted bounds (fill
 * + stroke). Without this, the stroke-painted area outside the fill
 * rectangle would not be masked through, producing a too-tight mask
 * (the visible "wave bleeding into the iPhone screen interior" diff in
 * App page screenshots / AppStore Search Cell).
 */
function getMaskSourceStrokeWidth(node: RenderNode): number | undefined {
  switch (node.type) {
    case "rect":
    case "ellipse":
    case "path": {
      const sr = node.strokeRendering;
      if (!sr) { return undefined; }
      const attrs = sr.mode === "uniform" || sr.mode === "masked"
        ? sr.attrs
        : sr.mode === "layers"
          ? sr.layers[0]?.attrs
          : undefined;
      if (!attrs || !(attrs.strokeWidth > 0)) { return undefined; }
      return attrs.strokeWidth;
    }
    case "group":
    case "frame":
    case "text":
    case "image":
      return undefined;
  }
}

// Figma's SVG exporter writes simple-shape mask sources as
// `fill="#D9D9D9"` inside `<mask style="mask-type:alpha">`. Per spec the
// rect's RGB is irrelevant to alpha-mode masking (only the alpha channel
// matters, which is 1.0 for any opaque color), but resvg always reads
// RGB luminance — so the constant becomes an effective ≈85% pass-through
// there. Emitting the same byte-pattern is the SoT-aligned way to
// reproduce Figma's exporter output under the same rasteriser.
const MASK_SHAPE_FILL = "#D9D9D9";

// Detect compound mask geometry — multiple disjoint subpaths within a
// single `<path>` element. Figma's exporter emits these via
// `mask-type:luminance` + `fill="white"`, where simpler single-subpath
// shapes use `mask-type:alpha` + `fill="#D9D9D9"`. The choice matters
// under resvg because stacked masks multiply their luminance values; a
// nested compound mask using the alpha-mode placeholder would compound
// to ~72% pass-through instead of the ~85% Figma's export produces.
function isCompoundMaskGeometry(node: RenderNode): boolean {
  switch (node.type) {
    case "path": {
      if (node.paths.length > 1) { return true; }
      return node.paths.some((p) => pathHasMultipleSubpaths(p.d));
    }
    case "group":
    case "frame":
      return node.children.some(isCompoundMaskGeometry);
    case "rect":
    case "ellipse":
    case "text":
    case "image":
      return false;
  }
}

// SVG path `d` strings encode disjoint subpaths via additional `M` or
// `m` commands after the first. A single-subpath rounded rect therefore
// starts with `M` and contains no other moveto, while a boolean-op
// flattened path interleaves outer/inner contours with extra moves.
function pathHasMultipleSubpaths(d: string): boolean {
  let count = 0;
  for (let i = 0; i < d.length; i++) {
    const ch = d.charCodeAt(i);
    if (ch === 77 /* M */ || ch === 109 /* m */) {
      count++;
      if (count > 1) { return true; }
    }
  }
  return false;
}

function formatNodeAsMaskShapeBody(node: RenderNode, fill: string, strokeAttrs?: MaskStrokeAttrs): SvgString {
  const sa = strokeAttrs ?? {};
  switch (node.type) {
    case "path": {
      const parts = node.paths.map((p) =>
        path({ d: p.d, "fill-rule": p.fillRule, fill, ...sa }),
      );
      if (parts.length === 1) {
        return parts[0];
      }
      return g({}, ...parts);
    }
    case "rect": {
      const uniform = uniformCornerRadius(node.cornerRadius);
      if (uniform === undefined && node.cornerRadius !== undefined && typeof node.cornerRadius !== "number") {
        return path({
          d: buildRoundedRectPathD(node.width, node.height, coerceCornerRadius(node.cornerRadius)),
          fill,
          ...sa,
        });
      }
      const rxValue = uniform ?? 0;
      const rxAttr = rxValue > 0 ? { rx: rxValue } : {};
      return rect({ x: 0, y: 0, width: node.width, height: node.height, ...rxAttr, fill, ...sa });
    }
    case "ellipse": {
      if (node.rx === node.ry) {
        return circle({ cx: node.cx, cy: node.cy, r: node.rx, fill });
      }
      return ellipse({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry, fill });
    }
    case "group": {
      const children = node.children.map((c) => formatNodeAsMaskShape(c, fill));
      if (children.length === 1) {
        return children[0];
      }
      return g({}, ...children);
    }
    case "frame": {
      // Frame as a mask: emit its rounded-rect background as the shape.
      // Children of a frame-as-mask are unusual and would each need to
      // be treated as additive mask geometry — fall through to a group.
      const uniform = uniformCornerRadius(node.cornerRadius);
      const bgEl = (() => {
        if (uniform === undefined && node.cornerRadius !== undefined && typeof node.cornerRadius !== "number") {
          return path({
            d: buildRoundedRectPathD(
              node.width,
              node.height,
              coerceCornerRadius(node.cornerRadius),
            ),
            fill,
          });
        }
        const rxValue = uniform ?? 0;
        const rxAttr = rxValue > 0 ? { rx: rxValue } : {};
        return rect({ x: 0, y: 0, width: node.width, height: node.height, ...rxAttr, fill });
      })();
      if (node.children.length === 0) {
        return bgEl;
      }
      const childEls = node.children.map((c) => formatNodeAsMaskShape(c, fill));
      return g({}, bgEl, ...childEls);
    }
    case "text": {
      // Text used as a mask emits its glyph contours with the requested
      // mask fill — every mask shape body uses the same constant so the
      // rasterised mask source matches Figma's exporter byte-for-byte.
      if (node.content.mode === "glyphs") {
        const parts = node.content.runs.map((run) => path({ d: run.d, fill }));
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
  /**
   * When true, prepend Figma's "no-fill frame" indicator — a 1-px purple
   * dashed rectangle inset by 0.5 along each viewport edge. Figma's own
   * SVG exporter writes this rect for any root FRAME exported with no
   * visible fill paint, as a visual cue that the frame's interior is
   * transparent. Matching this byte pattern is what closes the residual
   * pixel diff on the App Store template's `Metadata`, `Event metadata`,
   * and `Tab Bar` fixtures (all FRAMEs with empty `fillPaints`).
   */
  readonly figmaEmptyFrameIndicator?: boolean;
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
  if (options?.figmaEmptyFrameIndicator) {
    // Figma's SVG exporter emits this exact byte pattern for the
    // root FRAME of any export whose root has no visible fill paint:
    //
    //   <rect x="0.5" y="0.5" width="W-1" height="H-1" rx="4.5"
    //         stroke="#9747FF" stroke-dasharray="10 5"/>
    //
    // The 0.5 inset centers the 1-px stroke on the viewport boundary
    // (so the dashes sit inside the canvas), the `rx="4.5"` constant
    // gives the indicator its signature soft-rounded corners, and the
    // `#9747FF` purple + `10 5` dashes are the Figma exporter's
    // canonical "internal-only frame" cue. The rect carries no fill
    // (we set it explicitly so the rect doesn't inherit a default
    // black from a parent `<g fill>` — Figma relies on inheritance
    // from `<svg fill="none">`, which we don't emit).
    body.push(
      rect({
        x: renderTree.viewport.x + 0.5,
        y: renderTree.viewport.y + 0.5,
        width: renderTree.viewport.width - 1,
        height: renderTree.viewport.height - 1,
        rx: 4.5,
        fill: "none",
        stroke: "#9747FF",
        "stroke-dasharray": "10 5",
      }),
    );
  }

  // No root-level `<g clip-path>` wrapper. Figma's own SVG exporter
  // emits content flat at the `<svg>` root and relies on (a) the
  // `viewBox` attribute for visual clipping and (b) callers pruning
  // off-canvas subtrees before render.
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

  const built = svg(
    {
      width: renderTree.width,
      height: renderTree.height,
      viewBox: `${renderTree.viewport.x} ${renderTree.viewport.y} ${renderTree.viewport.width} ${renderTree.viewport.height}`,
    },
    ...body,
    ...children,
  );
  return unsafeSvg(applyFigmaPrecisionRule(built));
}

/**
 * Walk the rendered SVG and rewrite every coordinate with the
 * precision Figma's SVG exporter would have used for that point's
 * world position.
 *
 * Figma's emit rule, derived empirically from the App Store template
 * exports: `|world coord| >= 100` → 3 decimal places; `|world coord|
 * < 100` → 4 decimal places. The same source glyph emits
 * `M110.656 71.1113` in Metadata context (world x≥100) and
 * `M94.6559 294.111` in Feature context (world x<100, world y≥100) —
 * per-coordinate, not per-path. The same rule applies to
 * `<g transform="translate(...)">` values: theirs emits
 * `translate(36.7881 175.138)` (X<100 → 4-dec, Y≥100 → 3-dec) and
 * `translate(160.788 175.138)` (both ≥100 → 3-dec).
 *
 * Implementation rewrites both kinds of coordinates:
 *
 * - `<g transform="matrix(1,0,0,1,tx,ty)">` and
 *   `<g transform="translate(tx, ty)">` — the translation values are
 *   themselves world-coord deltas (assuming a flat-or-nested
 *   integer-prefixed transform tree), so we apply the magnitude rule
 *   directly to each component.
 * - `<path d="...">` command points — convert local→world using the
 *   accumulated parent translation, apply the magnitude rule, then
 *   back-subtract the (already-rounded) parent translation to
 *   produce the local coord resvg will reconstruct.
 *
 * Non-translation transforms (scale/rotation/skew) leave the local
 * coords as-is because the RenderTree pre-bakes those into the path
 * commands and surfaces only translations at the wrapper level.
 *
 * Calibration: Metadata's "u" right stem at world x=110.65586090
 * rasterised at 50% column-112 coverage where Figma's `110.656` gives
 * 75% — a 64-channel-diff stem pixel. The rule snaps our local
 * `37.6559` to `37.656` so the column-coverage estimate matches.
 */
function applyFigmaPrecisionRule(svgText: string): string {
  // Stack tracks BOTH the unrounded cumulative world translation
  // (`txRaw`/`tyRaw`) and the rounded one that's actually emitted in
  // the SVG (`tx`/`ty`). The unrounded value is needed to decide which
  // 3-decimal bucket each child's world coord falls into — accumulating
  // rounded values layer-by-layer loses fractional precision (e.g.
  // 50.91916 → 50.919, then +1.20548 → 172.124 instead of 172.125).
  // The rounded value is what the SVG parser will see, so the emitted
  // delta = roundMag(parent_raw + dx) − parent_rounded.
  type Trans = { readonly tx: number; readonly ty: number; readonly txRaw: number; readonly tyRaw: number };
  const stack: Trans[] = [{ tx: 0, ty: 0, txRaw: 0, tyRaw: 0 }];
  const top = () => stack[stack.length - 1];

  function roundMag(v: number): number {
    // Figma's SVG exporter uses 6 significant figures per coordinate
    // (calibrated against App page screenshots / Search Cell exports):
    //
    //   |v| ≥ 100   →  3 decimals  ("172.728")
    //   10 ≤ |v| <100 → 4 decimals  ("96.1387")
    //   1  ≤ |v| < 10 →  5 decimals  ("1.20548")
    //   |v| < 1       →  6 decimals  ("0.401826")
    //
    // Earlier our rule used 3-or-4 decimals only, which truncated
    // stroke-width and gradient stop values (e.g. 1.20548 → "1.2055")
    // and shifted resvg's AA coverage by ≤2 sub-pixels at iPhone
    // bezel corners on Search Cell and App page screenshots.
    const a = Math.abs(v);
    const precision = a >= 100 ? 3 : a >= 10 ? 4 : a >= 1 ? 5 : 6;
    const factor = 10 ** precision;
    return Math.round(v * factor) / factor;
  }

  // Rewrite a `<rect>` / `<circle>` / `<ellipse>` / `<linearGradient>`
  // / `<radialGradient>` tag's numeric attributes. Position-like
  // attributes (X-axis: x, cx, x1, x2, fx; Y-axis: y, cy, y1, y2, fy)
  // get the magnitude rule applied on the WORLD coord (local +
  // parent translation), then back-subtracted. Size/radius-like
  // attributes (width, height, r, rx, ry) get the magnitude rule
  // applied on the value itself.
  function rewriteCoordAttrs(tag: string, cur: { tx: number; ty: number }): string {
    const X_POS = new Set(["x", "cx", "x1", "x2", "fx"]);
    const Y_POS = new Set(["y", "cy", "y1", "y2", "fy"]);
    const SIZE = new Set(["width", "height", "r", "rx", "ry", "stroke-width", "fill-opacity", "stroke-opacity", "opacity"]);
    return tag.replace(/\b([a-zA-Z-]+)="(-?[\d.]+(?:[eE][-+]?\d+)?)"/g, (full, name, val) => {
      const v = parseFloat(val);
      if (!Number.isFinite(v)) return full;
      if (X_POS.has(name)) {
        const r = roundMag(v + cur.tx) - cur.tx;
        return `${name}="${r}"`;
      }
      if (Y_POS.has(name)) {
        const r = roundMag(v + cur.ty) - cur.ty;
        return `${name}="${r}"`;
      }
      if (SIZE.has(name)) {
        return `${name}="${roundMag(v)}"`;
      }
      return full;
    });
  }

  let result = "";
  let lastIndex = 0;
  const tagRe = /<\/g>|<g([^>]*)>|<(?:path|rect|circle|ellipse|linearGradient|radialGradient|line|stop)([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(svgText)) !== null) {
    result += svgText.slice(lastIndex, m.index);
    lastIndex = m.index + m[0].length;

    if (m[0] === "</g>") {
      stack.pop();
      result += m[0];
      continue;
    }
    if (m[0].startsWith("<g")) {
      const cur = top();
      // Match translation-only transforms — these are the only
      // wrappers whose translation can be rounded without changing
      // the geometric meaning. Non-translation transforms
      // (scale/rotation/skew) are pre-baked into the path d by the
      // RenderTree resolver.
      const matrixRe = /transform="matrix\(1,0,0,1,(-?[\d.]+),(-?[\d.]+)\)"/;
      const translateRe = /transform="translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)"/;
      const matrixMatch = matrixRe.exec(m[0]);
      const translateMatch = translateRe.exec(m[0]);
      let dxRaw = 0;
      let dyRaw = 0;
      let newDx = 0;
      let newDy = 0;
      let isTranslateLayer = false;
      let rewrittenTag = m[0];
      if (matrixMatch !== null) {
        dxRaw = parseFloat(matrixMatch[1]);
        dyRaw = parseFloat(matrixMatch[2]);
        // Decide rounding against the UNROUNDED cumulative world
        // coordinate, then back-subtract the ROUNDED parent so the
        // emitted local delta lands at `roundMag(world_raw) − parent_rounded`.
        // This preserves the right rounding bucket when nested
        // translations accumulate (e.g. 50.91916 + 1.20549 → 172.12465
        // rounds to 172.125, where naïve `cur.ty + dy` against the
        // rounded parent 170.919 would have rounded down to 172.124).
        newDx = roundMag(cur.txRaw + dxRaw) - cur.tx;
        newDy = roundMag(cur.tyRaw + dyRaw) - cur.ty;
        isTranslateLayer = true;
        rewrittenTag = m[0].replace(matrixRe, `transform="matrix(1,0,0,1,${newDx},${newDy})"`);
      } else if (translateMatch !== null) {
        dxRaw = parseFloat(translateMatch[1]);
        dyRaw = parseFloat(translateMatch[2]);
        newDx = roundMag(cur.txRaw + dxRaw) - cur.tx;
        newDy = roundMag(cur.tyRaw + dyRaw) - cur.ty;
        isTranslateLayer = true;
        rewrittenTag = m[0].replace(translateRe, `transform="translate(${newDx} ${newDy})"`);
      }
      if (isTranslateLayer) {
        stack.push({
          tx: cur.tx + newDx,
          ty: cur.ty + newDy,
          txRaw: cur.txRaw + dxRaw,
          tyRaw: cur.tyRaw + dyRaw,
        });
      } else {
        // Non-translation transform (or no transform at all) — both
        // rounded and raw cumulative stay at the parent's values.
        stack.push({ tx: cur.tx, ty: cur.ty, txRaw: cur.txRaw, tyRaw: cur.tyRaw });
      }
      result += rewrittenTag;
      continue;
    }
    // <path|rect|...>
    const cur = top();
    if (m[0].startsWith("<path")) {
      const dMatch = /d="([^"]+)"/.exec(m[0]);
      if (!dMatch) {
        // Still apply attr rounding (stroke-width etc.) even when d is absent.
        result += rewriteCoordAttrs(m[0], cur);
        continue;
      }
      const rewrittenD = rewritePathDWithMagnitudeRule(dMatch[1], cur);
      const withD = m[0].replace(/d="[^"]+"/, `d="${rewrittenD}"`);
      // Path tags also carry stroke-width / fill-opacity / opacity etc.
      // that the magnitude rule should round (theirs emits
      // `stroke-width="1.20548"`, ours emits raw FP `1.2054784...`).
      result += rewriteCoordAttrs(withD, cur);
      continue;
    }
    // rect/circle/ellipse/gradient/line/stop
    result += rewriteCoordAttrs(m[0], cur);
  }
  result += svgText.slice(lastIndex);
  return result;
}

function rewritePathDWithMagnitudeRule(d: string, parent: { readonly tx: number; readonly ty: number }): string {
  function precisionForMag(a: number): number {
    return a >= 100 ? 3 : a >= 10 ? 4 : a >= 1 ? 5 : 6;
  }
  function r(local: number, isX: boolean): string {
    const offset = isX ? parent.tx : parent.ty;
    const world = local + offset;
    const factor = 10 ** precisionForMag(Math.abs(world));
    const roundedWorld = Math.round(world * factor) / factor;
    return (roundedWorld - offset).toString();
  }
  const cmdRe = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let out = "";
  let cm: RegExpExecArray | null;
  while ((cm = cmdRe.exec(d)) !== null) {
    const cmd = cm[1];
    const upper = cmd.toUpperCase();
    if (upper === "Z") { out += cmd; continue; }
    const args = (cm[2] || "").trim().split(/[\s,]+/).filter((s) => s.length > 0).map(parseFloat);
    // Lowercase commands are RELATIVE — magnitude rule should apply
    // to the relative offset itself (since the relative delta is what
    // gets rasterised against the current point). Treat the same way
    // but use a zero offset (relative deltas don't accumulate with
    // parent translation).
    const useParent = cmd === upper;
    const isX = (k: number) => k % 2 === 0;
    function emit(values: readonly number[], xMask: readonly boolean[]): string {
      const parts = values.map((v, i) =>
        xMask[i] === undefined
          ? v.toString()
          : useParent
            ? r(v, xMask[i])
            : (() => {
                const factor = 10 ** precisionForMag(Math.abs(v));
                return (Math.round(v * factor) / factor).toString();
              })(),
      );
      return parts.join(" ");
    }
    let segments: string[] = [];
    switch (upper) {
      case "M":
      case "L":
      case "T": {
        for (let k = 0; k < args.length; k += 2) {
          segments.push(emit([args[k], args[k+1]], [true, false]));
        }
        break;
      }
      case "C": {
        for (let k = 0; k < args.length; k += 6) {
          segments.push(emit([args[k], args[k+1], args[k+2], args[k+3], args[k+4], args[k+5]], [true, false, true, false, true, false]));
        }
        break;
      }
      case "Q":
      case "S": {
        for (let k = 0; k < args.length; k += 4) {
          segments.push(emit([args[k], args[k+1], args[k+2], args[k+3]], [true, false, true, false]));
        }
        break;
      }
      case "H": {
        segments.push(args.map((v) => useParent ? r(v, true) : v.toString()).join(" "));
        break;
      }
      case "V": {
        segments.push(args.map((v) => useParent ? r(v, false) : v.toString()).join(" "));
        break;
      }
      case "A": {
        // arc: rx ry x-axis-rotation large-arc-flag sweep-flag x y
        // rx/ry/rotation are not positions; flags are 0/1; only x/y get rounded.
        for (let k = 0; k < args.length; k += 7) {
          const xMask = [undefined, undefined, undefined, undefined, undefined, true, false] as readonly (boolean | undefined)[];
          segments.push(emit([args[k], args[k+1], args[k+2], args[k+3], args[k+4], args[k+5], args[k+6]], xMask as readonly boolean[]));
        }
        break;
      }
      default: {
        // Unknown — emit raw as-is.
        out += cm[0];
        continue;
      }
    }
    out += cmd + segments.join(" ");
  }
  return out;
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
