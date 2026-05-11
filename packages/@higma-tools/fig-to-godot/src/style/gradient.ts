/**
 * @file Render a fig GRADIENT_LINEAR fill as a Godot
 * `GradientTexture2D` + parent `Gradient` sub-resource pair.
 *
 * Coverage:
 *   - GRADIENT_LINEAR with arbitrary stops at any angle.
 *   - Other gradient types (RADIAL/ANGULAR/DIAMOND) return undefined;
 *     callers fall back to existing transparent-Control placeholder.
 *
 * Godot 4 `GradientTexture2D`:
 *   - `gradient`: a `Gradient` resource (inline as another sub_resource)
 *     carrying `offsets: PackedFloat32Array` + `colors: PackedColorArray`.
 *   - `width`, `height`: the texture size; we set to the node size so
 *     the texture renders 1:1 in the parent `TextureRect`.
 *   - `fill`: 0=Linear, 1=Radial.
 *   - `fill_from`, `fill_to`: Vector2 in [0,1]² describing the gradient
 *     direction. Derived from fig's gradientHandlePositions or
 *     transform.
 *
 * Fig's coordinate convention (per docs / probe output):
 *   - Stop position 0 lives at gradient_handle 1 (the "start").
 *   - Stop position 1 lives at gradient_handle 0 (the "end").
 *   - The transform maps [0,1]² object space into gradient space:
 *     (1,0) → start, (0,0) → end. So for a horizontal left-to-right
 *     gradient, transform is identity → start=(1,0), end=(0,0).
 *
 * Mapping to Godot:
 *   - fill_from = (transform * (0,0,1)) wrapped to [0,1]²  (start)
 *   - fill_to   = (transform * (1,0,1)) wrapped to [0,1]²  (end? no,
 *     fig stop 0 is at handle 1 = (1,0) in *gradient* space; that
 *     space's origin is at fig's "end". Easier rule: derive
 *     start/end in object space from the inverse transform).
 *
 * We keep it concrete: convert fig transform → start/end points in
 * normalized object space, then write fill_from / fill_to.
 */
import type {
  FigGradientPaint,
  FigGradientStop,
  FigGradientTransform,
  FigPaint,
} from "@higma-document-models/fig/types";
import {
  colorVal,
  property,
  subResource,
  type GodotProperty,
  type GodotSubResource,
  type GodotValue,
  vector2,
} from "../godot-tree";

/**
 * Pick the first visible LINEAR or RADIAL gradient paint. Other
 * gradient kinds (ANGULAR, DIAMOND) need a custom shader and fall
 * through.
 */
function firstVisibleGodotGradient(
  paints: readonly FigPaint[] | undefined,
): FigGradientPaint | undefined {
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL") {
      return paint as FigGradientPaint;
    }
  }
  return undefined;
}

/** Read stops in either Kiwi (`stops`) or API (`gradientStops`) shape. */
function readStops(paint: FigGradientPaint): readonly FigGradientStop[] {
  if (paint.stops && paint.stops.length > 0) {
    return paint.stops;
  }
  if (paint.gradientStops && paint.gradientStops.length > 0) {
    return paint.gradientStops;
  }
  return [];
}

/**
 * Apply a 2x3 affine transform to a 2D point. Treats undefined matrix
 * components as identity (per `FigGradientTransform`'s optional fields).
 */
function applyTransform(t: FigGradientTransform, p: { x: number; y: number }): { x: number; y: number } {
  const m00 = t.m00 ?? 1;
  const m01 = t.m01 ?? 0;
  const m02 = t.m02 ?? 0;
  const m10 = t.m10 ?? 0;
  const m11 = t.m11 ?? 1;
  const m12 = t.m12 ?? 0;
  return {
    x: m00 * p.x + m01 * p.y + m02,
    y: m10 * p.x + m11 * p.y + m12,
  };
}

/**
 * Resolve the gradient direction in normalised object space. Fig's
 * `transform` maps object space → gradient space where (1,0) is the
 * 0% stop (start) and (0,0) is the 100% stop (end). Inverting that
 * gives us the start/end in object space:
 *
 *   start_obj = transform⁻¹ · (1, 0)
 *   end_obj   = transform⁻¹ · (0, 0)
 *
 * For the common identity transform: start_obj=(1,0), end_obj=(0,0)
 * — i.e. a right-to-left gradient. Most fig fixtures author left-to-
 * right by setting `m00=-1, m02=1` so the start is at (0,0) and the
 * end at (1,0).
 *
 * We invert the 2x2 part and apply.
 */
function gradientEndpoints(
  transform: FigGradientTransform,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const m00 = transform.m00 ?? 1;
  const m01 = transform.m01 ?? 0;
  const m02 = transform.m02 ?? 0;
  const m10 = transform.m10 ?? 0;
  const m11 = transform.m11 ?? 1;
  const m12 = transform.m12 ?? 0;
  const det = m00 * m11 - m01 * m10;
  if (Math.abs(det) < 1e-9) {
    // Degenerate transform — fall back to horizontal LTR.
    return { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
  }
  const inv = {
    m00: m11 / det,
    m01: -m01 / det,
    m02: (m01 * m12 - m11 * m02) / det,
    m10: -m10 / det,
    m11: m00 / det,
    m12: (m10 * m02 - m00 * m12) / det,
  };
  // Empirically: fig stop position 0 lives at gradient-space (0, 0)
  // (NOT (1,0) as the docs suggest in some places). So fill_from
  // (corresponding to Godot's offset 0 = stop 0) maps from (0,0),
  // and fill_to from (1,0). Verified against decoration-combo's
  // grad-radius-linear (blue→green left-to-right with identity-like
  // transform).
  return {
    start: applyTransform(inv, { x: 0, y: 0 }),
    end: applyTransform(inv, { x: 1, y: 0 }),
  };
}

/**
 * Resolve a RADIAL gradient's centre and rim point in object space.
 *
 * Fig's RADIAL transform stores the centre directly at (m02, m12)
 * and the radius at m00 — the renderer's
 * `getRadialGradientCenterAndRadius` is the SoT and documents this.
 * Godot's `GradientTexture2D` (with `fill = 1` for Radial) takes
 * `fill_from` (centre) and `fill_to` (a point on the rim). We pick
 * a rim point along the +x axis of object space so the radius
 * matches Godot's `length(fill_to - fill_from)`.
 */
function radialEndpoints(
  transform: FigGradientTransform,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const cx = transform.m02 ?? 0.5;
  const cy = transform.m12 ?? 0.5;
  const r = transform.m00 ?? 0.5;
  return { start: { x: cx, y: cy }, end: { x: cx + r, y: cy } };
}

/** Dispatch endpoints by gradient kind. */
function pickEndpoints(
  isRadial: boolean,
  transform: FigGradientTransform,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  if (isRadial) {
    return radialEndpoints(transform);
  }
  return gradientEndpoints(transform);
}

/**
 * Build the `Gradient` + `GradientTexture2D` pair of sub-resources
 * for a node's first GRADIENT_LINEAR fill, plus the property the
 * caller should set on a `TextureRect` to display it.
 *
 * Returns `undefined` when the node has no LINEAR gradient fill.
 *
 * `gradientId` and `textureId` are caller-supplied unique ids.
 */
export type LinearGradientResult = {
  readonly subResources: readonly GodotSubResource[];
  /** Property to set on the TextureRect: `texture = SubResource("textureId")`. */
  readonly textureProperty: GodotProperty;
};

/**
 * Build a `Gradient` + `GradientTexture2D` sub-resource pair for the
 * node's first visible LINEAR or RADIAL gradient fill. ANGULAR /
 * DIAMOND gradients return `undefined` because Godot's
 * `GradientTexture2D` doesn't have a built-in mode for them — those
 * cases need a custom shader.
 */
export function buildLinearGradient(
  node: { readonly fillPaints?: readonly FigPaint[]; readonly size?: { x: number; y: number } },
  gradientId: string,
  textureId: string,
): LinearGradientResult | undefined {
  const paint = firstVisibleGodotGradient(node.fillPaints);
  if (!paint) {
    return undefined;
  }
  return buildGradientFromPaint(paint, node.size, gradientId, textureId);
}

/**
 * Like `buildLinearGradient` but takes the gradient paint explicitly,
 * so multi-paint stacks can build one gradient texture per paint
 * (each at its own z-order in the polygon list).
 */
export function buildGradientFromPaint(
  paint: FigGradientPaint,
  size: { readonly x: number; readonly y: number } | undefined,
  gradientId: string,
  textureId: string,
): LinearGradientResult | undefined {
  if (paint.type !== "GRADIENT_LINEAR" && paint.type !== "GRADIENT_RADIAL") {
    return undefined;
  }
  const stops = readStops(paint);
  if (stops.length === 0) {
    return undefined;
  }
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  const offsets: GodotValue = {
    kind: "raw",
    text: `PackedFloat32Array(${stops.map((s) => s.position).join(", ")})`,
  };
  // Gradient stop colours are emitted raw (no compensation): Godot's
  // `Gradient` resource quantises stops with `round(c*255)` (round-
  // half-up) when rasterising to its byte texture, which matches the
  // WebGL reference's own byte rounding. Compensating with the
  // `(byte+0.5)/255` offset used for Polygon2D vertex colours pushes
  // the stop one byte high here (`0.2 → 51` raw vs `0.2019... → 52`
  // compensated, verified against `decoration-combo/grad-radius-
  // linear`).
  const colors: GodotValue = {
    kind: "raw",
    text: `PackedColorArray(${stops
      .map((s) => {
        const a = s.color.a * paintOpacity;
        return `${s.color.r}, ${s.color.g}, ${s.color.b}, ${a}`;
      })
      .join(", ")})`,
  };
  const gradient = subResource(gradientId, "Gradient", [
    property("offsets", offsets),
    property("colors", colors),
  ]);
  const transform = paint.transform ?? {};
  const w = size ? Math.max(1, Math.round(size.x)) : 100;
  const h = size ? Math.max(1, Math.round(size.y)) : 100;
  // Godot's `GradientTexture2D.fill`: 0=Linear, 1=Radial.
  //
  // The two endpoint conventions diverge on RADIAL:
  //
  //   - LINEAR: fig transform maps object→gradient where (0,0) is
  //     stop 0 and (1,0) is stop 1. Invert the matrix to recover
  //     stop positions in object space — that's `gradientEndpoints`.
  //   - RADIAL: fig stores the centre directly at (m02, m12) and
  //     the radius at m00. The renderer's
  //     `getRadialGradientCenterAndRadius` documents this. Putting
  //     the linear-style inverse here lands the centre outside the
  //     element on most fixtures (mask-rounded, grad-radial).
  //
  // We split the two cases so each carries the right math.
  const isRadial = paint.type === "GRADIENT_RADIAL";
  const fillKind = isRadial ? 1 : 0;
  const endpoints = pickEndpoints(isRadial, transform);
  const fillFrom = endpoints.start;
  const fillTo = endpoints.end;
  const texture = subResource(textureId, "GradientTexture2D", [
    property("gradient", { kind: "sub-resource", id: gradientId }),
    property("width", { kind: "int", value: w }),
    property("height", { kind: "int", value: h }),
    property("fill", { kind: "int", value: fillKind }),
    property("fill_from", vector2(fillFrom.x, fillFrom.y)),
    property("fill_to", vector2(fillTo.x, fillTo.y)),
  ]);
  void colorVal; // (used by SOLID emit; gradient stop colors are inlined raw above)
  return {
    subResources: [gradient, texture],
    textureProperty: property("texture", { kind: "sub-resource", id: textureId }),
  };
}

