/**
 * @file Fill resolution — shared SoT for SceneGraph Fill → SVG fill attributes
 *
 * This is the SINGLE place where Fill → SVG attributes conversion happens.
 * Both SVG string and React renderers MUST consume this output.
 *
 * The resolved attributes are format-agnostic (plain objects),
 * usable by both string concatenation and React JSX.
 */

import type { Fill, GradientStop } from "@higma-document-renderers/fig/scene-graph";
import type { ImagePaintFilter } from "@higma-codecs/raster";
import { writePng } from "@higma-codecs/png";
import { colorToHex, uint8ArrayToBase64 } from "./color";
import {
  applyImagePaintFilterToRgb,
  hasImagePaintFilter,
  resolveImagePaintFilterUniforms,
  convertRgbColorProfile,
} from "@higma-codecs/raster";
import {
  decodeRasterImage,
  pngMetadataFromDecodedRaster,
  resolveEncodedRasterSourceProfile,
  resolveManagedRasterSourceProfile,
} from "./image-raster-decode";
import { resolveFigmaSvgOpacity } from "./figma-svg-opacity";
import {
  resolveFigmaRenderExportSettings,
  renderExportSettingsCacheKey,
  requireManagedDisplayP3IccProfile,
  requireManagedImageColorProfile,
  type FigmaRenderExportSettings,
  type ResolvedFigmaRenderExportSettings,
} from "./export-settings";
import type { AffineMatrix } from "@higma-primitives/path";

// =============================================================================
// Resolved Types
// =============================================================================

/**
 * SVG fill attributes resolved from a SceneGraph Fill.
 */
export type ResolvedFillAttrs = {
  readonly fill: string;
  readonly fillOpacity?: number;
};

/**
 * SVG gradient stop definition.
 */
export type ResolvedGradientStop = {
  readonly offset: string;
  readonly stopColor: string;
  readonly stopOpacity?: number;
};

/**
 * A linear gradient def to be rendered by the consumer.
 */
export type ResolvedLinearGradient = {
  readonly type: "linear-gradient";
  readonly id: string;
  readonly x1: string;
  readonly y1: string;
  readonly x2: string;
  readonly y2: string;
  readonly stops: readonly ResolvedGradientStop[];
  /** When "userSpaceOnUse", x1/y1/x2/y2 are pixel coordinates */
  readonly gradientUnits?: "userSpaceOnUse";
  /**
   * Raw Figma gradient transform matrix — preserved for finalization.
   * finalizeGradientDefs() converts this to userSpaceOnUse pixel coords
   * using the element's bounding box size.
   * After finalization, this field is cleared (set to undefined).
   */
  readonly gradientTransform?: AffineMatrix;
};

/**
 * A radial gradient def to be rendered by the consumer.
 */
export type ResolvedRadialGradient = {
  readonly type: "radial-gradient";
  readonly id: string;
  readonly cx: string;
  readonly cy: string;
  readonly r: string;
  readonly stops: readonly ResolvedGradientStop[];
  /** When "userSpaceOnUse", cx/cy/r are pixel coordinates */
  readonly gradientUnits?: "userSpaceOnUse";
  /**
   * SVG gradientTransform string (after finalization) or raw AffineMatrix
   * (before finalization). After finalizeGradientDefs(), this is a string.
   */
  readonly gradientTransform?: string | AffineMatrix;
};

/**
 * An image pattern def to be rendered by the consumer.
 */
export type ResolvedImagePattern = {
  readonly type: "image";
  readonly id: string;
  readonly dataUri: string;
  readonly patternContentUnits: "objectBoundingBox" | "userSpaceOnUse";
  readonly width: number;
  readonly height: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly preserveAspectRatio: string;
  /** SVG patternTransform string (from image transform matrix) */
  readonly patternTransform?: string;
  /**
   * Image element transform (computed by finalizeImagePatternDefs).
   * When set, the image uses its natural pixel dimensions with this
   * transform mapping to objectBoundingBox 0..1 space.
   */
  readonly imageTransform?: string;
  /** Scale mode for image pattern finalization */
  readonly scaleMode: string;
  /** Tile scale multiplier for TILE image fills */
  readonly scalingFactor?: number;
  /** Source paint transform (AffineMatrix) for finalization */
  readonly sourceTransform?: AffineMatrix;
  readonly paintFilter?: ImagePaintFilter;
};

/**
 * An angular (conic) gradient def.
 * Rendered via foreignObject + CSS conic-gradient (SVG) or shader (WebGL).
 *
 * `elementWidth` / `elementHeight` are set by `finalizeAngularDiamondGradientDefs`
 * once the parent element size is known. They are needed because the SVG
 * <foreignObject> inside the <pattern> cannot use objectBoundingBox units —
 * its x/y/width/height are always in user-space pixels. Keeping the pattern
 * as a 1×1 bounding-box pattern (as we did previously) shrunk the
 * conic-gradient DIV to a single pixel and produced an invisible fill
 * (angular-gradient-filled FRAME with bbox-pattern bug).
 */
export type ResolvedAngularGradient = {
  readonly type: "angular-gradient";
  readonly id: string;
  readonly cx: string;
  readonly cy: string;
  readonly rotation: number;
  readonly stops: readonly ResolvedGradientStop[];
  readonly elementWidth?: number;
  readonly elementHeight?: number;
};

/**
 * A diamond gradient def.
 * Rendered via four mirrored gradient rects (SVG) or shader (WebGL).
 * Same `elementWidth/elementHeight` contract as the angular variant.
 */
export type ResolvedDiamondGradient = {
  readonly type: "diamond-gradient";
  readonly id: string;
  readonly cx: string;
  readonly cy: string;
  readonly stops: readonly ResolvedGradientStop[];
  readonly elementWidth?: number;
  readonly elementHeight?: number;
};

/**
 * Union of all fill def types.
 * The consumer must handle each variant (exhaustive switch enforced by TypeScript).
 */
export type ResolvedFillDef =
  | ResolvedLinearGradient
  | ResolvedRadialGradient
  | ResolvedAngularGradient
  | ResolvedDiamondGradient
  | ResolvedImagePattern;

/**
 * Complete fill resolution result.
 */
export type ResolvedFill = {
  readonly attrs: ResolvedFillAttrs;
  readonly def?: ResolvedFillDef;
};

// =============================================================================
// ID Generator interface
// =============================================================================

/**
 * SSoT ID generator interface for SVG defs (gradient, pattern, mask,
 * filter, clip-path, stroke-mask, etc.).
 *
 * The canonical implementation lives in
 * `scene-graph/render-tree/resolve.ts` and uses a module-level
 * `resolverGeneration` counter so every call to `createIdGenerator()`
 * produces a disjoint ID namespace (`${prefix}-g${gen}-${seq}`). This
 * guarantees no two scene-renderer instances mounted in the same HTML
 * document can emit colliding `<mask id="…">` definitions — a subtle
 * bug that caused Link INSTANCEs to lose their clip under certain
 * editor zoom states.
 *
 * Test specs may supply a simpler counter for unit-level isolation; any
 * production code that needs an ID generator MUST route through
 * resolveRenderTree rather than instantiating one ad-hoc.
 */
export type IdGenerator = {
  readonly getNextId: (prefix: string) => string;
};

// =============================================================================
// Resolution functions
// =============================================================================

function matrixToPatternTransform(m: AffineMatrix): string {
  return `matrix(${m.m00},${m.m10},${m.m01},${m.m11},${m.m02},${m.m12})`;
}

function resolveGradientStops(stops: readonly GradientStop[]): ResolvedGradientStop[] {
  return stops.map((s) => ({
    offset: `${s.position * 100}%`,
    stopColor: colorToHex(s.color),
    stopOpacity: s.color.a < 1 ? resolveFigmaSvgOpacity(s.color.a) : undefined,
  }));
}

function buildAttrs(fillValue: string, opacity: number): ResolvedFillAttrs {
  if (opacity < 1) {
    return { fill: fillValue, fillOpacity: resolveFigmaSvgOpacity(opacity) };
  }
  return { fill: fillValue };
}

function resolveSolidFillOpacity(fill: Extract<Fill, { readonly type: "solid" }>): number {
  return fill.color.a * fill.opacity;
}

function byteFromUnit(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

type ResolvedRasterImageData = {
  readonly data: Uint8Array;
  readonly mimeType: string;
};

const filteredImageDataCache = new WeakMap<Uint8Array, Map<string, ResolvedRasterImageData>>();
const imageDataUriCache = new WeakMap<Uint8Array, Map<string, string>>();

function resolveImageDataUri(data: Uint8Array, mimeType: string): string {
  const cachedByMime = imageDataUriCache.get(data);
  const cached = cachedByMime?.get(mimeType);
  if (cached !== undefined) {
    return cached;
  }
  const dataUri = `data:${mimeType};base64,${uint8ArrayToBase64(data)}`;
  if (cachedByMime) {
    cachedByMime.set(mimeType, dataUri);
  } else {
    imageDataUriCache.set(data, new Map([[mimeType, dataUri]]));
  }
  return dataUri;
}

function imageFilterCacheKey(
  mimeType: string,
  paintFilter: ImagePaintFilter | undefined,
  colorManage: boolean | undefined,
  exportSettings: ResolvedFigmaRenderExportSettings,
): string {
  return [
    mimeType,
    `color-managed-${String(colorManage)}`,
    renderExportSettingsCacheKey(exportSettings),
    JSON.stringify(resolveImagePaintFilterUniforms(paintFilter)),
  ].join(":");
}

function filteredPngSrgbIntent(
  sourceMimeType: string,
  sourceSrgbIntent: number | undefined,
  sourceIccProfile: ResolvedRasterImageData["data"] | undefined,
  colorManage: boolean | undefined,
): number | undefined {
  if (sourceIccProfile) {
    return undefined;
  }
  if (sourceSrgbIntent !== undefined) {
    return sourceSrgbIntent;
  }
  if ((sourceMimeType === "image/jpeg" || sourceMimeType === "image/jpg" || sourceMimeType === "image/png") && colorManage === true) {
    return 0;
  }
  return undefined;
}

function outputIccProfile(
  targetProfile: ReturnType<typeof requireManagedImageColorProfile> | undefined,
  sourceIccProfile: { readonly name: string; readonly data: Uint8Array } | undefined,
  exportSettings: ResolvedFigmaRenderExportSettings,
): { readonly name: string; readonly data: Uint8Array } | undefined {
  if (targetProfile === "DISPLAY_P3_V4") {
    return { name: "Display P3", data: requireManagedDisplayP3IccProfile(exportSettings.imageColorManagement) };
  }
  if (targetProfile) {
    return undefined;
  }
  if (!sourceIccProfile) {
    return undefined;
  }
  return sourceIccProfile;
}

function outputSrgbIntent(
  targetProfile: ReturnType<typeof requireManagedImageColorProfile> | undefined,
  sourceMimeType: string,
  sourceSrgbIntent: number | undefined,
  sourceIccProfile: ResolvedRasterImageData["data"] | undefined,
  colorManage: boolean | undefined,
): number | undefined {
  if (targetProfile === "SRGB") {
    return 0;
  }
  return filteredPngSrgbIntent(sourceMimeType, sourceSrgbIntent, sourceIccProfile, colorManage);
}

function resolveImageRasterData(
  data: Uint8Array,
  mimeType: string,
  paintFilter: ImagePaintFilter | undefined,
  colorManage: boolean | undefined,
  exportSettings: ResolvedFigmaRenderExportSettings,
): ResolvedRasterImageData {
  const hasFilter = hasImagePaintFilter(paintFilter);
  if (!hasFilter && colorManage !== true) {
    return { data, mimeType };
  }
  const targetProfile = colorManage === true ? requireManagedImageColorProfile(exportSettings.imageColorManagement) : undefined;
  if (!hasFilter && encodedRasterAlreadyMatchesTarget(data, mimeType, targetProfile)) {
    return { data, mimeType };
  }
  const cacheKey = imageFilterCacheKey(mimeType, paintFilter, colorManage, exportSettings);
  const dataCache = filteredImageDataCache.get(data);
  const cached = dataCache?.get(cacheKey);
  if (cached) {
    return cached;
  }
  const image = decodeRasterImage(data, mimeType);
  const sourceSpace = targetProfile ? resolveManagedRasterSourceProfile(image) : undefined;
  // `untagged` images carry an ICC payload that does not describe a
  // pixel encoding (e.g. macOS attaches the LG monitor's display
  // calibration profile to a JPEG when the user drops a photo into
  // Figma). The pixel bytes themselves are sRGB-equivalent — every
  // browser strips the profile and renders the bytes verbatim. We
  // mirror that here: no per-pixel conversion, but the paint-filter
  // pass still runs because that is a separate operation.
  const requiresColorConversion = !!(
    targetProfile && sourceSpace && sourceSpace.kind === "managed" && sourceSpace.profile !== targetProfile
  );
  const filtered = hasFilter || requiresColorConversion ? new Uint8Array(image.data) : image.data;
  if (requiresColorConversion && sourceSpace?.kind === "managed" && targetProfile) {
    for (let i = 0; i < filtered.length; i += 4) {
      const rgb = convertRgbColorProfile({
        r: filtered[i] / 255,
        g: filtered[i + 1] / 255,
        b: filtered[i + 2] / 255,
      }, sourceSpace.profile, targetProfile);
      filtered[i] = byteFromUnit(rgb.r);
      filtered[i + 1] = byteFromUnit(rgb.g);
      filtered[i + 2] = byteFromUnit(rgb.b);
    }
  }
  if (hasFilter) {
    for (let i = 0; i < filtered.length; i += 4) {
      const rgb = applyImagePaintFilterToRgb({
        r: filtered[i] / 255,
        g: filtered[i + 1] / 255,
        b: filtered[i + 2] / 255,
      }, paintFilter);
      filtered[i] = byteFromUnit(rgb.r);
      filtered[i + 1] = byteFromUnit(rgb.g);
      filtered[i + 2] = byteFromUnit(rgb.b);
    }
  }
  const pngMetadata = pngMetadataFromDecodedRaster(image);
  const iccProfile = pngMetadata.iccProfile;
  const outputIcc = outputIccProfile(targetProfile, iccProfile, exportSettings);
  const result = {
    data: writePng({
      width: image.width,
      height: image.height,
      data: filtered,
      gamma: pngMetadata.gamma,
      srgbIntent: outputSrgbIntent(targetProfile, mimeType, pngMetadata.srgbIntent, iccProfile?.data, colorManage),
      chromaticity: targetProfile ? undefined : (iccProfile ? undefined : pngMetadata.chromaticity),
      iccProfile: outputIcc,
    }),
    mimeType: "image/png",
  };
  if (dataCache) {
    dataCache.set(cacheKey, result);
  } else {
    filteredImageDataCache.set(data, new Map([[cacheKey, result]]));
  }
  return result;
}

function encodedRasterAlreadyMatchesTarget(
  data: Uint8Array,
  mimeType: string,
  targetProfile: ReturnType<typeof requireManagedImageColorProfile> | undefined,
): boolean {
  if (targetProfile === undefined) {
    return false;
  }
  const sourceSpace = resolveEncodedRasterSourceProfile(data, mimeType);
  // `untagged` images need no conversion regardless of target — the
  // pixel bytes are treated as the target space (matching what the
  // browser would show), so the encoded data can be passed through
  // unchanged. `managed` images bypass conversion only when source
  // and target colour space are already the same.
  if (sourceSpace.kind === "untagged") {
    return true;
  }
  return sourceSpace.profile === targetProfile;
}

/**
 * Resolve a single Fill to SVG attributes and an optional def.
 *
 * This is the exhaustive handler — adding a new Fill type without
 * handling it here will produce a TypeScript compile error.
 */
export function resolveFillWithRenderSettings(
  fill: Fill,
  ids: IdGenerator,
  exportSettings: ResolvedFigmaRenderExportSettings,
): ResolvedFill {
  switch (fill.type) {
    case "solid":
      return { attrs: buildAttrs(colorToHex(fill.color), resolveSolidFillOpacity(fill)) };

    case "linear-gradient": {
      const id = ids.getNextId("lg");
      return {
        attrs: buildAttrs(`url(#${id})`, fill.opacity),
        def: {
          type: "linear-gradient",
          id,
          x1: `${fill.start.x * 100}%`,
          y1: `${fill.start.y * 100}%`,
          x2: `${fill.end.x * 100}%`,
          y2: `${fill.end.y * 100}%`,
          stops: resolveGradientStops(fill.stops),
          gradientTransform: fill.gradientTransform,
        },
      };
    }

    case "radial-gradient": {
      const id = ids.getNextId("rg");
      return {
        attrs: buildAttrs(`url(#${id})`, fill.opacity),
        def: {
          type: "radial-gradient",
          id,
          cx: `${fill.center.x * 100}%`,
          cy: `${fill.center.y * 100}%`,
          r: `${Math.abs(fill.radius) * 100}%`,
          stops: resolveGradientStops(fill.stops),
          gradientTransform: fill.gradientTransform,
        },
      };
    }

    case "angular-gradient": {
      const id = ids.getNextId("ag");
      return {
        attrs: buildAttrs(`url(#${id})`, fill.opacity),
        def: {
          type: "angular-gradient",
          id,
          cx: `${fill.center.x * 100}%`,
          cy: `${fill.center.y * 100}%`,
          rotation: fill.rotation,
          stops: resolveGradientStops(fill.stops),
        },
      };
    }

    case "diamond-gradient": {
      const id = ids.getNextId("dg");
      return {
        attrs: buildAttrs(`url(#${id})`, fill.opacity),
        def: {
          type: "diamond-gradient",
          id,
          cx: `${fill.center.x * 100}%`,
          cy: `${fill.center.y * 100}%`,
          stops: resolveGradientStops(fill.stops),
        },
      };
    }

    case "image": {
      const id = ids.getNextId("img");
      const imageData = resolveImageRasterData(fill.data, fill.mimeType, fill.paintFilter, fill.imageShouldColorManage, exportSettings);
      const dataUri = resolveImageDataUri(imageData.data, imageData.mimeType);
      return {
        attrs: buildAttrs(`url(#${id})`, fill.opacity),
        def: {
          type: "image",
          id,
          dataUri,
          // objectBoundingBox: 1 unit = element dimension.
          // Image uses natural pixel dims with a computed transform
          // (set by finalizeImagePatternDefs after element size is known).
          // Before finalization: simple 0..1 stretch default.
          patternContentUnits: "objectBoundingBox",
          width: 1,
          height: 1,
          imageWidth: 1,
          imageHeight: 1,
          preserveAspectRatio: "none",
          patternTransform: fill.imageTransform ? matrixToPatternTransform(fill.imageTransform) : undefined,
          // Preserved for finalizeImagePatternDefs
          scaleMode: fill.scaleMode,
          scalingFactor: fill.scalingFactor,
          sourceTransform: fill.imageTransform,
          paintFilter: fill.paintFilter,
        },
      };
    }
  }
  // TypeScript exhaustiveness check: if a new Fill type is added to the union,
  // this line will produce a compile error.
   
  return unsupportedFill(fill);
}

function unsupportedFill(fill: never): ResolvedFill {
  throw new Error(`Unsupported fill: ${JSON.stringify(fill)}`);
}

/** Resolve a fill through public export settings. */
export function resolveFill(fill: Fill, ids: IdGenerator, exportSettings?: FigmaRenderExportSettings): ResolvedFill {
  return resolveFillWithRenderSettings(fill, ids, resolveFigmaRenderExportSettings(exportSettings));
}

/**
 * Resolve fills array — uses the topmost (last) fill, or fill="none" if empty.
 */
export function resolveTopFillWithRenderSettings(
  fills: readonly Fill[],
  ids: IdGenerator,
  exportSettings: ResolvedFigmaRenderExportSettings,
): ResolvedFill {
  if (fills.length > 0) {
    return resolveFillWithRenderSettings(fills[fills.length - 1], ids, exportSettings);
  }
  return { attrs: { fill: "none" } };
}

/** Resolve the visible top fill through public export settings. */
export function resolveTopFill(fills: readonly Fill[], ids: IdGenerator, exportSettings?: FigmaRenderExportSettings): ResolvedFill {
  return resolveTopFillWithRenderSettings(fills, ids, resolveFigmaRenderExportSettings(exportSettings));
}
