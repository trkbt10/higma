/**
 * @file Render a fig GRADIENT_LINEAR fill as a Godot
 * `GradientTexture2D` + parent `Gradient` sub-resource pair.
 *
 * Coverage:
 *   - GRADIENT_LINEAR with arbitrary stops at any angle.
 *   - Other gradient types (ANGULAR/DIAMOND) return undefined because
 *     Godot has no built-in GradientTexture2D mode for them.
 *
 * Godot 4 `GradientTexture2D`:
 *   - `gradient`: a `Gradient` resource (inline as another sub_resource)
 *     carrying `offsets: PackedFloat32Array` + `colors: PackedColorArray`.
 *   - `width`, `height`: the texture size; we set to the node size so
 *     the texture renders 1:1 in the parent `TextureRect`.
 *   - `fill`: 0=Linear, 1=Radial.
 *   - `fill_from`, `fill_to`: Vector2 in [0,1]² describing the gradient
 *     direction. Derived from fig's Kiwi transform.
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
  FigPaint,
} from "@higma-document-models/fig/types";
import { getPaintType } from "@higma-document-models/fig/color";
import {
  getGradientDirection,
  getGradientStops,
  getRadialGradientCenterAndRadius,
} from "@higma-document-renderers/fig/paint";
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
    const paintType = getPaintType(paint);
    if (paintType === "GRADIENT_LINEAR" || paintType === "GRADIENT_RADIAL") {
      return paint as FigGradientPaint;
    }
  }
  return undefined;
}

function radialEndpoints(paint: FigGradientPaint): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const params = getRadialGradientCenterAndRadius(paint);
  return {
    start: params.center,
    end: { x: params.center.x + params.radius, y: params.center.y },
  };
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
  const paintType = getPaintType(paint);
  if (paintType !== "GRADIENT_LINEAR" && paintType !== "GRADIENT_RADIAL") {
    return undefined;
  }
  if (!size) {
    throw new Error("buildGradientFromPaint requires node size");
  }
  const stops = getGradientStops(paint);
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
  const w = Math.max(1, Math.round(size.x));
  const h = Math.max(1, Math.round(size.y));
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
  const isRadial = paintType === "GRADIENT_RADIAL";
  const fillKind = isRadial ? 1 : 0;
  const endpoints = isRadial ? radialEndpoints(paint) : getGradientDirection(paint);
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
