/**
 * @file Convert Figma paints to scene graph fills
 *
 * Consumes shared paint interpretation functions from paint/interpret.ts (the SoT)
 * to ensure parity with the SVG string renderer's fill handling.
 */

import type { FigPaint, FigColor, FigGradientPaint, FigImagePaint, FigImageScaleMode } from "@higma-document-models/fig/types";
import type { FigPackageImage } from "@higma-figma-containers/package";
import {
  getPaintType, asGradientPaint, asImagePaint, asSolidPaint, } from "@higma-document-models/fig/color";
import { requireVariableFloat, resolveConcreteVariableColor } from "@higma-document-models/fig/variables";
import {
  getGradientStops, getGradientDirection, getRadialGradientCenterAndRadius, getAngularGradientParams, getDiamondGradientParams, getImageHash, getImageTransform, getScaleMode, getScalingFactor, getPaintFilter, getImageShouldColorManage, } from "../../paint";
import type { Fill, Color, GradientStop, BlendMode } from "@higma-document-renderers/fig/scene-graph";
import { convertFigmaBlendMode } from "@higma-document-renderers/fig/scene-graph";

/**
 * Convert FigColor to scene graph Color
 */
export function figColorToSceneColor(color: FigColor): Color {
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}
import type { AffineMatrix } from "@higma-primitives/path";

export type SceneSolidPaintAlpha = {
  readonly color: Color;
  readonly opacity: number;
};

/**
 * Convert gradient stops to scene graph format
 */
function convertGradientStops(stops: readonly { color: FigColor; position: number }[]): GradientStop[] {
  return stops.map((s) => ({
    position: s.position,
    color: figColorToSceneColor(s.color),
  }));
}

function resolvePaintOpacity(paint: FigPaint, subject: string): number {
  if (paint.opacityVar !== undefined) {
    return requireVariableFloat(paint.opacityVar, `${subject}.opacityVar`);
  }
  return paint.opacity ?? 1;
}

function resolvePaintColor(paint: FigPaint & { readonly color: FigColor }, subject: string): FigColor {
  if (paint.colorVar !== undefined) {
    return resolveConcreteVariableColor(paint.colorVar, `${subject}.colorVar`) ?? paint.color;
  }
  return paint.color;
}

export function resolveSolidPaintSceneAlpha(
  paint: FigPaint & { readonly color: FigColor },
  subject: string,
): SceneSolidPaintAlpha {
  const color = figColorToSceneColor(resolvePaintColor(paint, subject));
  return {
    color: { r: color.r, g: color.g, b: color.b, a: 1 },
    opacity: color.a * resolvePaintOpacity(paint, subject),
  };
}

/**
 * Returns true when every gradient stop has alpha == 0. Such gradients
 * are visually identity — they leave the backdrop untouched — and Figma's
 * own SVG exporter omits them. Emitting them adds no visible pixels but
 * does add an extra <rect>+<radialGradient> definition into our output,
 * which has been observed to nudge resvg-js's rendering of subsequent
 * blend-mode layers (notably the `mix-blend-mode:hue` overlay used by
 * card-style backgrounds) and inflate diff metrics. Match the exporter's behavior
 * by skipping fully-transparent gradient stops at convert time.
 */
function isFullyTransparentGradient(
  stops: readonly { color: FigColor; position: number }[],
): boolean {
  if (stops.length === 0) { return true; }
  for (const s of stops) {
    if (s.color.a > 0) { return false; }
  }
  return true;
}

/**
 * Extract paint-level blend mode from a FigPaint.
 * `convertFigmaBlendMode` is the single renderer-side mapping from
 * Kiwi BlendMode to scene-graph BlendMode.
 */
function extractPaintBlendMode(paint: FigPaint): BlendMode | undefined {
  return convertFigmaBlendMode(paint.blendMode);
}

/**
 * Extract gradient transform matrix from a Figma gradient paint.
 * Returns undefined if no transform or identity transform.
 */
function extractGradientTransform(gradientPaint: FigGradientPaint): AffineMatrix | undefined {
  const t = gradientPaint.transform;
  if (!t) { return undefined; }
  const m: AffineMatrix = {
    m00: t.m00 ?? 1,
    m01: t.m01 ?? 0,
    m02: t.m02 ?? 0,
    m10: t.m10 ?? 0,
    m11: t.m11 ?? 1,
    m12: t.m12 ?? 0,
  };
  // Skip identity
  if (m.m00 === 1 && m.m01 === 0 && m.m02 === 0 && m.m10 === 0 && m.m11 === 1 && m.m12 === 0) {
    return undefined;
  }
  return m;
}

function isIdentityAffine(m: AffineMatrix): boolean {
  return m.m00 === 1 && m.m01 === 0 && m.m02 === 0 && m.m10 === 0 && m.m11 === 1 && m.m12 === 0;
}

/** Extract image transform matrix from any supported image paint field. */
function extractImageTransform(imagePaint: FigImagePaint): AffineMatrix | undefined {
  const t = getImageTransform(imagePaint);
  if (!t) {
    return undefined;
  }
  return {
    m00: t.m00 ?? 1,
    m01: t.m01 ?? 0,
    m02: t.m02 ?? 0,
    m10: t.m10 ?? 0,
    m11: t.m11 ?? 1,
    m12: t.m12 ?? 0,
  };
}

/**
 * Reconcile the wire-format `imageScaleMode` with the canonical UI-level
 * semantic the renderers consume.
 *
 * Figma's binary `ImageScaleMode` enum only declares STRETCH / FIT /
 * FILL / TILE — there is no `CROP` value. When the user picks "Crop"
 * in the editor, Figma keeps the underlying `imageScaleMode` (most
 * commonly STRETCH) and writes the user-positioned image placement
 * into `paint.transform`. So a non-identity image transform on a
 * STRETCH paint is the wire-format spelling of "Crop"; the renderer
 * must honour the transform instead of treating the paint as a plain
 * stretch (which would ignore the transform and incorrectly render
 * the whole image distorted into the element bounds).
 *
 * Done at convert time so SVG, WebGL, and any future renderer share
 * the same canonical scaleMode and do not each have to rediscover the
 * STRETCH-vs-CROP distinction from the raw transform.
 */
function resolveImageScaleMode(
  wireScaleMode: ReturnType<typeof getScaleMode>,
  imageTransform: AffineMatrix | undefined,
): FigImageScaleMode | "CROP" {
  if (wireScaleMode !== "STRETCH") {
    return wireScaleMode;
  }
  if (imageTransform === undefined || isIdentityAffine(imageTransform)) {
    return wireScaleMode;
  }
  return "CROP";
}

/**
 * Convert a single Figma paint to a scene graph Fill
 *
 * @param paint - Figma paint
 * @param images - Image lookup map
 * @returns Scene graph Fill, or null if unsupported
 */
export function convertPaintToFill(
  paint: FigPaint,
  images: ReadonlyMap<string, FigPackageImage>,
  subject = "Paint",
): Fill | null {
  const opacity = resolvePaintOpacity(paint, subject);
  const paintType = getPaintType(paint);
  const blendMode = extractPaintBlendMode(paint);

  switch (paintType) {
    case "SOLID": {
      const solidPaint = asSolidPaint(paint);
      if (!solidPaint) { return null; }
      const solid = resolveSolidPaintSceneAlpha(solidPaint, subject);
      return {
        type: "solid",
        color: solid.color,
        opacity: solid.opacity,
        blendMode,
      };
    }

    case "GRADIENT_LINEAR": {
      const gradientPaint = asGradientPaint(paint);
      if (!gradientPaint) { return null; }
      const rawStops = getGradientStops(gradientPaint, subject);
      if (isFullyTransparentGradient(rawStops)) { return null; }
      const { start, end } = getGradientDirection(gradientPaint);
      const stops = convertGradientStops(rawStops);
      return {
        type: "linear-gradient",
        start,
        end,
        stops,
        opacity,
        blendMode,
        gradientTransform: extractGradientTransform(gradientPaint),
      };
    }

    case "GRADIENT_RADIAL": {
      const gradientPaint = asGradientPaint(paint);
      if (!gradientPaint) { return null; }
      const rawStops = getGradientStops(gradientPaint, subject);
      if (isFullyTransparentGradient(rawStops)) { return null; }
      const { center, radius } = getRadialGradientCenterAndRadius(gradientPaint);
      const stops = convertGradientStops(rawStops);
      return {
        type: "radial-gradient",
        center,
        radius,
        stops,
        opacity,
        blendMode,
        gradientTransform: extractGradientTransform(gradientPaint),
      };
    }

    case "GRADIENT_ANGULAR": {
      const gradientPaint = asGradientPaint(paint);
      if (!gradientPaint) { return null; }
      const rawStops = getGradientStops(gradientPaint, subject);
      if (isFullyTransparentGradient(rawStops)) { return null; }
      // The angular-gradient centre is NOT `(m02, m12)` of paint.transform:
      // the Kiwi matrix maps object→gradient space, and `(m02, m12) =
      // T·(0,0)` is the gradient-space image of the object-space origin,
      // which for a rotated paint lies far outside the element (see
      // `getAngularGradientParams` for the derivation). For conic
      // gradients the centre in object space is always `(0.5, 0.5)`;
      // only the rotation angle varies.
      const { center, startAngle } = getAngularGradientParams(gradientPaint);
      const stops = convertGradientStops(rawStops);
      return {
        type: "angular-gradient",
        center,
        stops,
        opacity,
        blendMode,
        rotation: startAngle,
      };
    }

    case "GRADIENT_DIAMOND": {
      const gradientPaint = asGradientPaint(paint);
      if (!gradientPaint) { return null; }
      const rawStops = getGradientStops(gradientPaint, subject);
      if (isFullyTransparentGradient(rawStops)) { return null; }
      // Diamond gradients, like angular, are centred on the object —
      // delegating to the dedicated function keeps the convention
      // explicit and consistent with angular.
      const { center } = getDiamondGradientParams(gradientPaint);
      const stops = convertGradientStops(rawStops);
      return {
        type: "diamond-gradient",
        center,
        stops,
        opacity,
        blendMode,
      };
    }

    case "IMAGE": {
      const imagePaint = asImagePaint(paint);
      if (!imagePaint) { return null; }
      if (imagePaint.imageVar !== undefined) {
        throw new Error(`${subject}.imageVar requires a concrete image variable resolver`);
      }
      const imageHash = getImageHash(imagePaint);

      const figImage = images.get(imageHash);
      if (!figImage) {
        throw new Error(`IMAGE paint references missing package image "${imageHash}"`);
      }

      const imageTransform = extractImageTransform(imagePaint);
      const scaleMode = resolveImageScaleMode(getScaleMode(imagePaint), imageTransform);

      return {
        type: "image",
        imageHash,
        data: figImage.data,
        mimeType: figImage.mimeType,
        scaleMode,
        opacity,
        blendMode,
        scalingFactor: getScalingFactor(imagePaint),
        imageTransform,
        paintFilter: getPaintFilter(imagePaint),
        imageShouldColorManage: getImageShouldColorManage(imagePaint),
      };
    }

    default:
      return null;
  }
}

/**
 * Convert Figma paints array to scene graph fills
 *
 * Returns all visible fills in Figma's stacking order (bottom to top).
 * The renderer should draw them in array order, compositing each on top.
 */
export function convertPaintsToFills(
  paints: readonly FigPaint[] | undefined,
  images: ReadonlyMap<string, FigPackageImage>,
  subject = "Paint",
): Fill[] {
  if (!paints || paints.length === 0) {
    return [];
  }

  const fills: Fill[] = [];
  for (const [index, paint] of paints.entries()) {
    if (paint.visible === false) {
      continue;
    }
    const fill = convertPaintToFill(paint, images, `${subject}[${index}]`);
    if (fill) {
      fills.push(fill);
    }
  }
  return fills;
}
