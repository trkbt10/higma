/**
 * @file Image pattern finalization — applies element size to image fill patterns
 *
 * Image fill patterns in Figma use objectBoundingBox coordinates (0..1 space).
 * The image element within the pattern needs a transform that accounts for:
 * - Natural image dimensions (from PNG/JPEG header)
 * - Element dimensions (the shape being filled)
 * - Scale mode (FILL = cover + center-crop, STRETCH = distort, etc.)
 * - Optional paint transform (user rotation/position)
 *
 * This mirrors the old SVG renderer's computeImagePatternTransform logic,
 * applied via finalizeImagePatternDefs after element size is known.
 */


import type { RenderDef } from "../render-tree/types";
import {
  getImageDimensions,
  resampleImage,
  type ImageDimensions,
  type RgbaRaster,
} from "@higma-codecs/raster";
import { decodeRasterImage, pngMetadataFromDecodedRaster } from "./image-raster-decode";
import { uint8ArrayToBase64 } from "./color";
import {
  resolveFigmaRenderExportSettings,
  type FigmaRenderExportSettings,
  type ResolvedFigmaRenderExportSettings,
} from "./export-settings";
import { writePng } from "@higma-codecs/png";
import type { AffineMatrix } from "@higma-primitives/path";

type ElementSize = { readonly width: number; readonly height: number };
type ImagePatternLayout = {
  readonly patternWidth: number;
  readonly patternHeight: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly preserveAspectRatio: string;
  readonly imageTransform: string;
};

/**
 * Finalize image pattern defs with element size.
 *
 * Called by each node resolver (rect, ellipse, frame, path) after
 * element size is known. Updates pattern defs with proper image
 * transforms based on natural image dimensions and scale mode.
 *
 * Mutates the defs array entries in-place (same approach as
 * finalizeGradientDefs for consistency).
 */
export function finalizeImagePatternDefs(
  defs: RenderDef[],
  elementSize: ElementSize,
  exportSettings?: FigmaRenderExportSettings,
): void {
  finalizeImagePatternDefsWithRenderSettings(defs, elementSize, resolveFigmaRenderExportSettings(exportSettings));
}

/** Finalize image patterns with resolved render settings. */
export function finalizeImagePatternDefsWithRenderSettings(
  defs: RenderDef[],
  elementSize: ElementSize,
  exportSettings: ResolvedFigmaRenderExportSettings,
): void {
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (def.type !== "pattern") { continue; }

    const pattern = def.def;
    if (pattern.type !== "image") { continue; }

    // Extract image dimensions from the base64 data
    const imgDim = extractDimensionsFromDataUri(pattern.dataUri);

    if (!imgDim) {
      throw new Error(`Image pattern ${pattern.id} requires decodable image dimensions`);
    }

    const layout = computeImagePatternLayout({
      imgDim,
      elementSize,
      scaleMode: pattern.scaleMode,
      paintTransform: pattern.sourceTransform,
      scalingFactor: pattern.scalingFactor,
    });
    const dataUri = finalizePatternDataUri(pattern.dataUri, pattern.scaleMode, elementSize, exportSettings);
    const finalizedLayout = dataUri.kind === "resampled" ? createBakedImagePatternLayout(dataUri.width, dataUri.height) : layout;

    // Replace the pattern def with finalized version.
    //
    // `patternTransform` is cleared because the finalized layout
    // expresses all positioning through `imageTransform` (which
    // transforms the inner <image> element). Leaving the
    // pre-finalization `patternTransform` (the raw paint.transform)
    // stacks two transforms — the wanted `imageTransform` AND the
    // outer pattern transform — squashing/offsetting the image
    // (e.g. Contact Avatar image was being vertically scaled to
    // 0.87 and translated down by 0.063 because patternTransform
    // was a residual of the raw paint.transform rather than an
    // identity).
    defs[i] = {
      type: "pattern",
      def: {
        ...pattern,
        // In objectBoundingBox space, the image uses its natural pixel dimensions
        // and the transform maps those pixels to 0..1 space
        dataUri: dataUri.value,
        width: finalizedLayout.patternWidth,
        height: finalizedLayout.patternHeight,
        imageWidth: finalizedLayout.imageWidth,
        imageHeight: finalizedLayout.imageHeight,
        preserveAspectRatio: finalizedLayout.preserveAspectRatio,
        imageTransform: finalizedLayout.imageTransform,
        patternTransform: undefined,
      },
    };
  }
}

type FinalizedPatternDataUri =
  | { readonly kind: "source"; readonly value: string }
  | { readonly kind: "resampled"; readonly value: string; readonly width: number; readonly height: number };

function createBakedImagePatternLayout(width: number, height: number): ImagePatternLayout {
  return {
    patternWidth: 1,
    patternHeight: 1,
    imageWidth: width,
    imageHeight: height,
    preserveAspectRatio: "none",
    imageTransform: formatImageTransform({ sa: 1 / width, sb: 0, sc: 0, sd: 1 / height, stx: 0, sty: 0 }),
  };
}

function decodeDataUri(dataUri: string): { readonly data: Uint8Array; readonly mimeType: string } {
  const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
  if (!mimeMatch) {
    throw new Error("Image pattern data URI requires a base64 mime type prefix");
  }
  const base64Data = dataUri.slice(dataUri.indexOf(",") + 1);
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return { data: bytes, mimeType: mimeMatch[1] };
}

function targetRasterLength(value: number, rasterScale: number, label: string): number {
  const scaled = value * rasterScale;
  if (!Number.isFinite(scaled) || scaled <= 0) {
    throw new Error(`Image resampling requires a positive finite ${label}`);
  }
  return Math.max(1, Math.round(scaled));
}

function resampleFitForScaleMode(scaleMode: string): "cover" | "stretch" {
  if (scaleMode === "FILL") {
    return "cover";
  }
  if (scaleMode === "STRETCH") {
    return "stretch";
  }
  throw new Error(`Image resampling for SVG/React currently requires FILL or STRETCH imageScaleMode, got ${scaleMode}`);
}

function encodeResampledPng(image: RgbaRaster, source: ReturnType<typeof decodeRasterImage>): Uint8Array {
  const metadata = pngMetadataFromDecodedRaster(source);
  return writePng({
    width: image.width,
    height: image.height,
    data: image.data,
    gamma: metadata.gamma,
    srgbIntent: metadata.srgbIntent,
    chromaticity: metadata.iccProfile ? undefined : metadata.chromaticity,
    iccProfile: metadata.iccProfile,
  });
}

function finalizePatternDataUri(
  dataUri: string,
  scaleMode: string,
  elementSize: ElementSize,
  exportSettings: ResolvedFigmaRenderExportSettings,
): FinalizedPatternDataUri {
  const resampling = exportSettings.imageResampling;
  if (resampling.kind === "source") {
    return { kind: "source", value: dataUri };
  }
  const decodedUri = decodeDataUri(dataUri);
  const source = decodeRasterImage(decodedUri.data, decodedUri.mimeType);
  const width = targetRasterLength(elementSize.width, resampling.rasterScale, "target width");
  const height = targetRasterLength(elementSize.height, resampling.rasterScale, "target height");
  const resampled = resampleImage({
    source: { width: source.width, height: source.height, data: source.data },
    width,
    height,
    method: resampling.method,
    fit: resampleFitForScaleMode(scaleMode),
  });
  const png = encodeResampledPng(resampled, source);
  return {
    kind: "resampled",
    value: `data:image/png;base64,${uint8ArrayToBase64(png)}`,
    width,
    height,
  };
}

/**
 * Extract image dimensions from a data URI's binary content.
 */
function extractDimensionsFromDataUri(
  dataUri: string,
): ImageDimensions | undefined {
  // Determine mimeType from the data URI
  const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
  if (!mimeMatch) { return undefined; }
  const mimeType = mimeMatch[1];

  // Decode the full header-bearing payload. JPEG SOF markers can appear after
  // APP/ICC metadata, so a fixed prefix can incorrectly hide valid dimensions.
  const base64Data = dataUri.slice(dataUri.indexOf(",") + 1);
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return getImageDimensions(bytes, mimeType);
}

/**
 * Compute the SVG transform for an image inside an objectBoundingBox pattern.
 *
 * In objectBoundingBox space:
 * - 1 unit in X = element width in pixels
 * - 1 unit in Y = element height in pixels
 *
 * The image uses its natural pixel dimensions (imgW × imgH).
 * The transform maps those pixels into the 0..1 oBB space.
 *
 * For FILL mode with identity paint transform:
 *   pixelScale = max(elemW/imgW, elemH/imgH)   // cover both axes
 *   sx_obb = pixelScale / elemW   (maps imgW pixels to oBB units)
 *   sy_obb = pixelScale / elemH
 *   Center-crop offset = -(obbImageSize - 1) / 2
 *
 * For general case with paint transform:
 *   T = inv(paintTransform) × diag(1/imgW, 1/imgH)
 */
type ImagePatternLayoutParams = {
  readonly imgDim: ImageDimensions;
  readonly elementSize: ElementSize;
  readonly scaleMode: string;
  readonly paintTransform: AffineMatrix | undefined;
  readonly scalingFactor: number | undefined;
};

function computeImagePatternLayout(params: ImagePatternLayoutParams): ImagePatternLayout {
  const { imgDim, elementSize, scaleMode, paintTransform, scalingFactor } = params;
  const imgW = imgDim.width;
  const imgH = imgDim.height;
  if (imgW <= 0 || imgH <= 0 || elementSize.width <= 0 || elementSize.height <= 0) {
    throw new Error("Image pattern layout requires positive image and element dimensions");
  }

  // Figma's SVG export for FILL/FIT/STRETCH computes the scale purely from
  // element × image dimensions and ignores paint.transform. paint.transform
  // is only applied for CROP mode. This matches Figma's own SVG output.
  if (scaleMode === "STRETCH") {
    return {
      patternWidth: 1,
      patternHeight: 1,
      imageWidth: imgW,
      imageHeight: imgH,
      preserveAspectRatio: "none",
      imageTransform: formatImageTransform({ sa: 1 / imgW, sb: 0, sc: 0, sd: 1 / imgH, stx: 0, sty: 0 }),
    };
  }

  if (scaleMode === "FIT") {
    return createScaledImagePatternLayout({
      imgW,
      imgH,
      elementSize,
      pixelScale: Math.min(elementSize.width / imgW, elementSize.height / imgH),
      centerMode: "letterbox",
    });
  }

  if (scaleMode === "FILL") {
    return createScaledImagePatternLayout({
      imgW,
      imgH,
      elementSize,
      pixelScale: Math.max(elementSize.width / imgW, elementSize.height / imgH),
      centerMode: "crop",
    });
  }

  if (scaleMode === "TILE") {
    return createTiledImagePatternLayout({ imgW, imgH, elementSize, scalingFactor });
  }

  // CROP (and any other explicit mode with paint.transform) — invert paint transform.
  // inv(paintTransform) × diag(1/imgW, 1/imgH)
  if (paintTransform === undefined) {
    throw new Error("Image pattern layout requires an explicit paint transform for CROP mode");
  }
  const pm00 = paintTransform.m00;
  const pm01 = paintTransform.m01;
  const pm10 = paintTransform.m10;
  const pm11 = paintTransform.m11;
  const pm02 = paintTransform.m02;
  const pm12 = paintTransform.m12;
  const det = pm00 * pm11 - pm01 * pm10;
  if (Math.abs(det) < 1e-12) {
    throw new Error("Image pattern layout requires an invertible paint transform for CROP mode");
  }

  const invA = pm11 / det;
  const invB = -pm10 / det;
  const invC = -pm01 / det;
  const invD = pm00 / det;
  const invTx = invA * (-pm02) + invC * (-pm12);
  const invTy = invB * (-pm02) + invD * (-pm12);

  const sa = invA / imgW;
  const sb = invB / imgW;
  const sc = invC / imgH;
  const sd = invD / imgH;
  const stx = invTx;
  const sty = invTy;

  return {
    patternWidth: 1,
    patternHeight: 1,
    imageWidth: imgW,
    imageHeight: imgH,
    preserveAspectRatio: "none",
    imageTransform: formatImageTransform({ sa, sb, sc, sd, stx, sty }),
  };
}

type ScaledImagePatternParams = {
  readonly imgW: number;
  readonly imgH: number;
  readonly elementSize: ElementSize;
  readonly pixelScale: number;
  readonly centerMode: "crop" | "letterbox";
};

/** Create a one-pattern image layout for FILL/FIT modes. */
function createScaledImagePatternLayout(params: ScaledImagePatternParams): ImagePatternLayout {
  const { imgW, imgH, elementSize, pixelScale, centerMode } = params;
  const sx = pixelScale / elementSize.width;
  const sy = pixelScale / elementSize.height;
  const obbW = imgW * sx;
  const obbH = imgH * sy;
  const tx = computeCenteredOffset(obbW, centerMode);
  const ty = computeCenteredOffset(obbH, centerMode);

  return {
    patternWidth: 1,
    patternHeight: 1,
    imageWidth: imgW,
    imageHeight: imgH,
    preserveAspectRatio: "none",
    imageTransform: formatImageTransform({ sa: sx, sb: 0, sc: 0, sd: sy, stx: tx, sty: ty }),
  };
}

type TiledImagePatternParams = {
  readonly imgW: number;
  readonly imgH: number;
  readonly elementSize: ElementSize;
  readonly scalingFactor: number | undefined;
};

/** Create a repeating pattern layout for TILE mode. */
function createTiledImagePatternLayout(params: TiledImagePatternParams): ImagePatternLayout {
  const { imgW, imgH, elementSize } = params;
  if (params.scalingFactor === undefined) {
    throw new Error("TILE image pattern layout requires explicit scalingFactor");
  }
  const scale = params.scalingFactor;
  const patternWidth = (imgW * scale) / elementSize.width;
  const patternHeight = (imgH * scale) / elementSize.height;

  return {
    patternWidth,
    patternHeight,
    imageWidth: imgW,
    imageHeight: imgH,
    preserveAspectRatio: "none",
    imageTransform: formatImageTransform({
      sa: scale / elementSize.width,
      sb: 0,
      sc: 0,
      sd: scale / elementSize.height,
      stx: 0,
      sty: 0,
    }),
  };
}

/** Compute centered image offset for objectBoundingBox image size. */
function computeCenteredOffset(size: number, centerMode: "crop" | "letterbox"): number {
  if (centerMode === "crop") {
    return -(size - 1) / 2;
  }
  return (1 - size) / 2;
}

type ImageTransformParts = {
  readonly sa: number;
  readonly sb: number;
  readonly sc: number;
  readonly sd: number;
  readonly stx: number;
  readonly sty: number;
};

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Image pattern layout produced a non-finite transform value: ${n}`);
  }
  if (n === 0) { return "0"; }
  const s = n.toPrecision(15);
  const asNum = Number.parseFloat(s);
  if (Number.isInteger(asNum)) { return String(asNum); }
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Format SVG image transform from matrix components. */
function formatImageTransform(parts: ImageTransformParts): string {
  const { sa, sb, sc, sd, stx, sty } = parts;
  if (sb === 0 && sc === 0) {
    const sax = fmt(sa);
    const sdx = fmt(sd);
    if (stx === 0 && sty === 0) {
      if (sax === sdx) {
        return `scale(${sax})`;
      }
      return `scale(${sax} ${sdx})`;
    }
    return `matrix(${sax} 0 0 ${sdx} ${fmt(stx)} ${fmt(sty)})`;
  }

  return `matrix(${fmt(sa)} ${fmt(sb)} ${fmt(sc)} ${fmt(sd)} ${fmt(stx)} ${fmt(sty)})`;
}
