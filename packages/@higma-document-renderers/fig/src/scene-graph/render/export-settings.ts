/**
 * @file Figma export rendering settings shared by SVG, React, and WebGL.
 */

export type FigmaExportColorProfile = "SRGB" | "DISPLAY_P3_V4";

export type FigmaImageResamplingMethod = "DETAILED_BICUBIC" | "BASIC_NEAREST";

export type FigmaPdfImageQuality = "HIGH" | "MEDIUM" | "LOW";

export type FigmaImageResamplingSettings = {
  readonly method: FigmaImageResamplingMethod;
  readonly rasterScale: number;
};

export type FigmaRenderExportSettings = {
  readonly colorProfile?: FigmaExportColorProfile;
  readonly displayP3IccProfile?: Uint8Array;
  readonly imageResampling?: FigmaImageResamplingSettings;
  readonly pdfQuality?: FigmaPdfImageQuality;
};

export type SceneGraphRenderOptions = {
  readonly exportSettings?: FigmaRenderExportSettings;
};

export type ManagedImageColorProfile =
  | { readonly kind: "srgb" }
  | { readonly kind: "display-p3"; readonly iccProfile: Uint8Array };

export type ImageColorManagementSettings =
  | { readonly kind: "unmanaged" }
  | { readonly kind: "managed"; readonly profile: ManagedImageColorProfile };

export type ImageResamplingSettings =
  | { readonly kind: "source" }
  | {
    readonly kind: "figma-export";
    readonly method: FigmaImageResamplingMethod;
    readonly rasterScale: number;
  };

export type PdfImageQualitySettings =
  | { readonly kind: "not-requested" }
  | { readonly kind: "figma-export"; readonly quality: FigmaPdfImageQuality };

export type NormalizedFigmaRenderExportSettings = {
  readonly imageColorManagement: ImageColorManagementSettings;
  readonly imageResampling: ImageResamplingSettings;
  readonly pdfImageQuality: PdfImageQualitySettings;
};

export type RenderExportSettingsCacheKey = string & { readonly __brand: "RenderExportSettingsCacheKey" };

function makeRenderExportSettingsCacheKey(value: string): RenderExportSettingsCacheKey {
  return value as RenderExportSettingsCacheKey;
}

function byteHash(data: Uint8Array): string {
  return Array.from(data).reduce((hash, byte) => ((hash * 33) ^ byte) >>> 0, 5381).toString(16);
}

/** Validate a raster scale supplied by the caller. */
export function assertRasterScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Figma image resampling requires a positive finite rasterScale");
  }
}

function normalizeImageColorManagement(settings: FigmaRenderExportSettings | undefined): ImageColorManagementSettings {
  if (settings === undefined || settings.colorProfile === undefined) {
    return { kind: "unmanaged" };
  }
  if (settings.colorProfile === "SRGB") {
    return { kind: "managed", profile: { kind: "srgb" } };
  }
  if (settings.displayP3IccProfile === undefined) {
    throw new Error("Display P3 image export requires explicit exportSettings.displayP3IccProfile");
  }
  return { kind: "managed", profile: { kind: "display-p3", iccProfile: settings.displayP3IccProfile } };
}

function normalizeImageResampling(settings: FigmaImageResamplingSettings | undefined): ImageResamplingSettings {
  if (settings === undefined) {
    return { kind: "source" };
  }
  assertRasterScale(settings.rasterScale);
  return {
    kind: "figma-export",
    method: settings.method,
    rasterScale: settings.rasterScale,
  };
}

function normalizePdfImageQuality(quality: FigmaPdfImageQuality | undefined): PdfImageQualitySettings {
  if (quality === undefined) {
    return { kind: "not-requested" };
  }
  return { kind: "figma-export", quality };
}

/** Convert public export settings into explicit image rendering domains. */
export function normalizeFigmaRenderExportSettings(
  settings: FigmaRenderExportSettings | undefined,
): NormalizedFigmaRenderExportSettings {
  return {
    imageColorManagement: normalizeImageColorManagement(settings),
    imageResampling: normalizeImageResampling(settings?.imageResampling),
    pdfImageQuality: normalizePdfImageQuality(settings?.pdfQuality),
  };
}

/** Resolve the explicit export color profile required for managed image conversion. */
export function requireManagedImageColorProfile(settings: ImageColorManagementSettings): FigmaExportColorProfile {
  if (settings.kind !== "managed") {
    throw new Error("Figma color-managed image rendering requires explicit exportSettings.colorProfile");
  }
  if (settings.profile.kind === "srgb") {
    return "SRGB";
  }
  return "DISPLAY_P3_V4";
}

/** Resolve the explicit Display P3 ICC profile required for tagged P3 PNG output. */
export function requireManagedDisplayP3IccProfile(settings: ImageColorManagementSettings): Uint8Array {
  if (settings.kind !== "managed" || settings.profile.kind !== "display-p3") {
    throw new Error("Display P3 image export requires explicit exportSettings.displayP3IccProfile");
  }
  return settings.profile.iccProfile;
}

function colorManagementKey(settings: ImageColorManagementSettings): string {
  if (settings.kind === "unmanaged") {
    return "color:unmanaged";
  }
  if (settings.profile.kind === "srgb") {
    return "color:srgb";
  }
  return `color:display-p3:${byteHash(settings.profile.iccProfile)}`;
}

function resamplingKey(settings: ImageResamplingSettings): string {
  if (settings.kind === "source") {
    return "resampling:source";
  }
  return `resampling:${settings.method}:${settings.rasterScale}`;
}

function pdfQualityKey(settings: PdfImageQualitySettings): string {
  if (settings.kind === "not-requested") {
    return "pdf-quality:not-requested";
  }
  return `pdf-quality:${settings.quality}`;
}

/** Build the cache identity for normalized export settings. */
export function renderExportSettingsCacheKey(settings: NormalizedFigmaRenderExportSettings): RenderExportSettingsCacheKey {
  return makeRenderExportSettingsCacheKey([
    colorManagementKey(settings.imageColorManagement),
    resamplingKey(settings.imageResampling),
    pdfQualityKey(settings.pdfImageQuality),
  ].join("|"));
}
