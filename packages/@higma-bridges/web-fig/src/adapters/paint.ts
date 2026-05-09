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
 * vocabulary. The adapter throws on encounter rather than silently
 * approximating, per the project's fail-fast policy. A web-to-fig
 * tool that needs to emit a radial gradient must extend the IR
 * (and its CSS parser) first.
 *
 * Gradient angle round-trip: Figma's gradient is described by handle
 * positions (start, end, width). The bridge IR uses an explicit
 * angle in degrees, CSS convention (0deg = up, 90deg = right). The
 * conversion derives the angle from the handle vector — the inverse
 * direction reconstructs handles aligned with that angle, anchored at
 * the box centre.
 */
import type {
  FigGradientPaint,
  FigImagePaint,
  FigPaint,
  FigSolidPaint,
} from "@higma-document-models/fig/types";
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
  switch (paint.type) {
    case "SOLID":
      return figSolidToIR(paint);
    case "GRADIENT_LINEAR":
      return figLinearGradientToIR(paint);
    case "IMAGE":
      return figImageToIR(paint);
    default:
      throw new Error(
        `figPaintToIR: paint type "${paint.type}" is not part of the bridge IR. `
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
    type: "SOLID",
    color: irColorToFig(paint.color),
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

// =============================================================================
// LINEAR GRADIENT
// =============================================================================

function figLinearGradientToIR(paint: FigGradientPaint): LinearGradientPaintIR {
  const handles = paint.gradientHandlePositions;
  if (!handles || handles.length < 2) {
    throw new Error(
      "figPaintToIR: GRADIENT_LINEAR paints must carry gradientHandlePositions of length >= 2 to be representable as IR. "
      + "Kiwi-form transforms are not yet supported by the bridge.",
    );
  }
  const start = handles[0]!;
  const end = handles[1]!;
  const angle = handleVectorToCssAngle(end.x - start.x, end.y - start.y);
  const stops = (paint.gradientStops ?? paint.stops ?? []).map<GradientStopIR>((s) => ({
    position: s.position,
    color: figColorToIR(s.color),
  }));
  if (stops.length === 0) {
    throw new Error("figPaintToIR: GRADIENT_LINEAR paint has no gradientStops");
  }
  return {
    kind: "linear-gradient",
    angle,
    stops,
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

function irLinearGradientToFig(paint: LinearGradientPaintIR): FigGradientPaint {
  const { sx, sy, ex, ey } = cssAngleToHandleEndpoints(paint.angle);
  return {
    type: "GRADIENT_LINEAR",
    gradientHandlePositions: [
      { x: sx, y: sy },
      { x: ex, y: ey },
      // Width handle perpendicular to the start→end vector. Kept at the
      // start point's perpendicular so the gradient is square in the
      // box's normalised space — this is the default Figma uses for a
      // freshly-authored linear gradient.
      perpendicularHandle({ x: sx, y: sy }, { x: ex, y: ey }),
    ],
    gradientStops: paint.stops.map((s) => ({
      position: s.position,
      color: irColorToFig(s.color),
    })),
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

/**
 * Convert a (dx, dy) gradient direction in normalised object space to a
 * CSS gradient angle. CSS angle convention: 0deg points up (along
 * negative Y in browser coordinates); the angle increases clockwise.
 *
 * Figma's gradient direction goes from `gradientHandlePositions[0]`
 * (start) to `[1]` (end). Object space has Y pointing down. The CSS
 * `linear-gradient` angle gives the direction of the gradient line —
 * 0deg means colour 0 at the bottom, colour 1 at the top.
 */
function handleVectorToCssAngle(dx: number, dy: number): number {
  // atan2 returns radians counter-clockwise from +x. Convert to CSS
  // clockwise-from-up: degrees = atan2(dx, -dy) * 180 / PI.
  const radians = Math.atan2(dx, -dy);
  const degrees = radians * (180 / Math.PI);
  return degrees < 0 ? degrees + 360 : degrees;
}

function cssAngleToHandleEndpoints(angle: number): {
  readonly sx: number;
  readonly sy: number;
  readonly ex: number;
  readonly ey: number;
} {
  // Inverse of handleVectorToCssAngle, anchored at the unit square's
  // centre (0.5, 0.5). The handle vector goes from centre - half * dir
  // to centre + half * dir. Half-length 0.5 places endpoints on the
  // unit-square boundary for axis-aligned angles.
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

function perpendicularHandle(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return { x: start.x + dy / 2, y: start.y - dx / 2 };
}

// =============================================================================
// IMAGE
// =============================================================================

function figImageToIR(paint: FigImagePaint): ImagePaintIR {
  const ref = paint.imageRef;
  if (!ref) {
    throw new Error("figPaintToIR: IMAGE paint without imageRef cannot be expressed in IR");
  }
  const mode = paint.scaleMode ?? paint.imageScaleMode;
  if (!mode) {
    throw new Error("figPaintToIR: IMAGE paint missing scaleMode");
  }
  return {
    kind: "image",
    imageId: ref,
    scaleMode: figScaleModeToIR(mode),
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

function irImageToFig(paint: ImagePaintIR): FigImagePaint {
  return {
    type: "IMAGE",
    imageRef: paint.imageId,
    scaleMode: irScaleModeToFig(paint.scaleMode),
    visible: paint.visible,
    opacity: paint.opacity,
  };
}

function figScaleModeToIR(
  mode: "FILL" | "FIT" | "CROP" | "TILE" | "STRETCH",
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
    case "CROP":
      // Figma's CROP carries an authored transform; without a way to
      // round-trip that transform in the IR we'd be silently dropping
      // it. Throw rather than approximate.
      throw new Error("figPaintToIR: IMAGE paint with CROP scaleMode is not yet supported by the bridge");
  }
}

function irScaleModeToFig(mode: ImagePaintIR["scaleMode"]): FigImagePaint["scaleMode"] {
  switch (mode) {
    case "cover":
      return "FILL";
    case "contain":
      return "FIT";
    case "tile":
      return "TILE";
    case "stretch":
      return "STRETCH";
  }
}
