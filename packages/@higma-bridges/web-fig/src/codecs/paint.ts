/**
 * @file FigPaint ↔ PaintIR conversion.
 *
 * Coverage:
 *   - SOLID                ↔ solid
 *   - GRADIENT_LINEAR      ↔ linear-gradient
 *   - IMAGE                ↔ image
 *
 * The other Fig paint types (GRADIENT_RADIAL / GRADIENT_ANGULAR /
 * GRADIENT_DIAMOND / EMOJI / VIDEO) are *not* part of the bridge
 * vocabulary. The codec throws on encounter rather than silently
 * approximating, per the project's fail-fast policy. A web-to-fig
 * tool that needs to emit a radial gradient must extend the IR
 * (and its CSS parser) first.
 *
 * Gradient angle round-trip: Kiwi stores a paint transform. The bridge
 * IR uses an explicit angle in degrees, CSS convention (0deg = up,
 * 90deg = right). The conversion derives the angle from the transform;
 * the inverse writes a transform aligned to that angle.
 */
import type {
  FigGradientPaint,
  FigGradientTransform,
  FigImagePaint,
  FigImageScaleMode,
  KiwiEnumValue,
  FigPaint,
  FigSolidPaint,
} from "@higma-document-models/fig/types";
import { asGradientPaint, asImagePaint, asSolidPaint, getPaintType } from "@higma-document-models/fig/color";
import { PAINT_TYPE_VALUES, SCALE_MODE_VALUES, kiwiEnumName } from "@higma-document-models/fig/constants";
import type {
  GradientStopIR,
  ImagePaintIR,
  LinearGradientPaintIR,
  PaintIR,
  SolidPaintIR,
} from "../ir/types";
import { figColorToIR, irColorToFig } from "./color";

/** FigPaint → IR paint. Throws on paint kinds outside the bridge vocabulary. */
export function figPaintToIR(paint: FigPaint): PaintIR {
  switch (getPaintType(paint)) {
    case "SOLID": {
      const solid = asSolidPaint(paint);
      if (solid === undefined) { throw new Error("figPaintToIR: SOLID paint failed FigSolidPaint narrowing"); }
      return figSolidToIR(solid);
    }
    case "GRADIENT_LINEAR": {
      const gradient = asGradientPaint(paint);
      if (gradient === undefined) { throw new Error("figPaintToIR: GRADIENT_LINEAR paint failed FigGradientPaint narrowing"); }
      return figLinearGradientToIR(gradient);
    }
    case "IMAGE": {
      const image = asImagePaint(paint);
      if (image === undefined) { throw new Error("figPaintToIR: IMAGE paint failed FigImagePaint narrowing"); }
      return figImageToIR(image);
    }
    default:
      throw new Error(
        `figPaintToIR: paint type "${getPaintType(paint)}" is not part of the bridge IR. `
        + `Extend PaintIR before emitting it.`,
      );
  }
}

/** Inverse of `figPaintToIR` — IR paint → FigPaint. */
export function irPaintToFig(paint: PaintIR): FigPaint {
  switch (paint.kind) {
    case "solid":
      return irSolidToFig(paint);
    case "linear-gradient":
      return irLinearGradientToFig(paint);
    case "image":
      return irImageToFig(paint);
    default: {
      const exhaustive: never = paint;
      throw new Error(`irPaintToFig: unknown IR paint kind ${JSON.stringify(exhaustive)}`);
    }
  }
}

// =============================================================================
// SOLID
// =============================================================================

function figSolidToIR(paint: FigSolidPaint): SolidPaintIR {
  return {
    kind: "solid",
    color: figColorToIR(paint.color),
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

function irSolidToFig(paint: SolidPaintIR): FigSolidPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color: irColorToFig(paint.color),
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

// =============================================================================
// LINEAR GRADIENT
// =============================================================================

function figLinearGradientToIR(paint: FigGradientPaint): LinearGradientPaintIR {
  const direction = gradientDirectionFromTransform(paint.transform);
  const angle = vectorToCssAngle(direction.end.x - direction.start.x, direction.end.y - direction.start.y);
  const sourceStops = paint.stops;
  if (!sourceStops || sourceStops.length === 0) {
    throw new Error("figPaintToIR: GRADIENT_LINEAR paint has no stops");
  }
  const stops = sourceStops.map<GradientStopIR>((s) => ({
    position: s.position,
    color: figColorToIR(s.color),
  }));
  return {
    kind: "linear-gradient",
    angle,
    stops,
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

function irLinearGradientToFig(paint: LinearGradientPaintIR): FigGradientPaint {
  const { sx, sy, ex, ey } = cssAngleToUnitEndpoints(paint.angle);
  return {
    type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
    transform: gradientTransformFromUnitEndpoints({ x: sx, y: sy }, { x: ex, y: ey }),
    stops: paint.stops.map((s) => ({
      position: s.position,
      color: irColorToFig(s.color),
    })),
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

/**
 * Convert a (dx, dy) gradient direction in unit object space to a
 * CSS gradient angle. CSS angle convention: 0deg points up (along
 * negative Y in browser coordinates); the angle increases clockwise.
 *
 * Figma's gradient direction goes from transform-derived grad_x=0 to
 * grad_x=1. Object space has Y pointing down. The CSS
 * `linear-gradient` angle gives the direction of the gradient line —
 * 0deg means colour 0 at the bottom, colour 1 at the top.
 */
function vectorToCssAngle(dx: number, dy: number): number {
  // atan2 returns radians counter-clockwise from +x. Convert to CSS
  // clockwise-from-up: degrees = atan2(dx, -dy) * 180 / PI.
  const radians = Math.atan2(dx, -dy);
  const degrees = radians * (180 / Math.PI);
  return degrees < 0 ? degrees + 360 : degrees;
}

function cssAngleToUnitEndpoints(angle: number): {
  readonly sx: number;
  readonly sy: number;
  readonly ex: number;
  readonly ey: number;
} {
  // Inverse of vectorToCssAngle, anchored at the unit square's centre.
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  return {
    sx: 0.5 - dx / 2,
    sy: 0.5 - dy / 2,
    ex: 0.5 + dx / 2,
    ey: 0.5 + dy / 2,
  };
}

function gradientTransformFromUnitEndpoints(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): FigGradientTransform {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    throw new Error("irPaintToFig: linear-gradient angle produced a zero-length direction");
  }
  const px = -dy;
  const py = dx;
  return {
    m00: dx / lengthSquared,
    m01: dy / lengthSquared,
    m02: -((start.x * dx + start.y * dy) / lengthSquared),
    m10: px / lengthSquared,
    m11: py / lengthSquared,
    m12: -((start.x * px + start.y * py) / lengthSquared),
  };
}

function gradientDirectionFromTransform(transform: FigGradientTransform | undefined): {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
} {
  if (!transform) {
    throw new Error("figPaintToIR: GRADIENT_LINEAR paint requires transform");
  }
  const m00 = transform.m00 ?? 1;
  const m01 = transform.m01 ?? 0;
  const m02 = transform.m02 ?? 0;
  const m10 = transform.m10 ?? 0;
  const m11 = transform.m11 ?? 1;
  const m12 = transform.m12 ?? 0;
  const det = m00 * m11 - m01 * m10;
  if (det === 0) {
    throw new Error("figPaintToIR: GRADIENT_LINEAR transform is non-invertible");
  }
  const invDet = 1 / det;
  const inv00 = m11 * invDet;
  const inv10 = -m10 * invDet;
  const invTx = -(inv00 * m02 + (-m01 * invDet) * m12);
  const invTy = -(inv10 * m02 + (m00 * invDet) * m12);
  return {
    start: { x: invTx, y: invTy },
    end: { x: inv00 + invTx, y: inv10 + invTy },
  };
}

// =============================================================================
// IMAGE
// =============================================================================

function figImageToIR(paint: FigImagePaint): ImagePaintIR {
  const ref = imageHashToRef(paint.image?.hash);
  const mode = paint.imageScaleMode;
  if (!mode) {
    throw new Error("figPaintToIR: IMAGE paint missing imageScaleMode");
  }
  return {
    kind: "image",
    imageId: ref,
    scaleMode: figScaleModeToIR(imageScaleModeName(mode)),
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

function irImageToFig(paint: ImagePaintIR): FigImagePaint {
  const figScale = irScaleModeToFig(paint.scaleMode);
  // TILE paints in Figma always carry a `scalingFactor` (the
  // multiplier applied to the image's natural dimensions before it
  // tiles). The IR doesn't carry per-paint scaling yet, so default
  // to `1` — the image paints at its intrinsic size, which matches
  // CSS `background-size: auto`. The renderer's
  // `image-pattern-finalize` rejects TILE without a factor; emitting
  // `1` here keeps the pipeline lossless for the natural-size case.
  return {
    type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
    image: { hash: refToImageHash(paint.imageId) },
    imageScaleMode: figScale,
    visible: paint.visible,
    opacity: paint.opacity,
    scale: imageScalingFactor(figScale.name),
  };
}

function imageScalingFactor(scaleMode: FigImageScaleMode): number | undefined {
  if (scaleMode === "TILE") {
    return 1;
  }
  return undefined;
}

function figScaleModeToIR(
  mode: FigImageScaleMode,
): ImagePaintIR["scaleMode"] {
  switch (mode) {
    case "FILL":
      return "cover";
    case "FIT":
      return "contain";
    case "TILE":
      return "tile";
    case "STRETCH":
      return "stretch";
  }
}

function imageScaleModeName(mode: NonNullable<FigImagePaint["imageScaleMode"]>): FigImageScaleMode {
  const name = kiwiEnumName<FigImageScaleMode>(mode, "FigImagePaint.imageScaleMode");
  if (name === undefined) {
    throw new Error("figPaintToIR: IMAGE paint scaleMode is present but resolved to undefined");
  }
  return name;
}

function irScaleModeToFig(mode: ImagePaintIR["scaleMode"]): KiwiEnumValue<FigImageScaleMode> {
  switch (mode) {
    case "cover":
      return { value: SCALE_MODE_VALUES.FILL, name: "FILL" };
    case "contain":
      return { value: SCALE_MODE_VALUES.FIT, name: "FIT" };
    case "tile":
      return { value: SCALE_MODE_VALUES.TILE, name: "TILE" };
    case "stretch":
      return { value: SCALE_MODE_VALUES.STRETCH, name: "STRETCH" };
  }
}

function imageHashToRef(hash: readonly number[] | undefined): string {
  if (!hash || hash.length === 0) {
    throw new Error("figPaintToIR: IMAGE paint requires image.hash");
  }
  return hash.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function refToImageHash(ref: string): readonly number[] {
  if (ref.length === 0 || ref.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(ref)) {
    throw new Error(`irPaintToFig: IMAGE imageId must be an even-length hex image hash, got "${ref}"`);
  }
  const bytes: number[] = [];
  for (let i = 0; i < ref.length; i += 2) {
    bytes.push(Number.parseInt(ref.slice(i, i + 2), 16));
  }
  return bytes;
}
