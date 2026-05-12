/**
 * @file Raster codec public types.
 *
 * The enum literal values (`"SRGB"`, `"DISPLAY_P3_V4"`, `"BASIC_NEAREST"`,
 * `"DETAILED_BICUBIC"`) match Figma's export API names exactly because
 * this package implements the raster operations Figma's exporter uses.
 * Renderers in this monorepo re-export these names from their
 * `export-settings` module so consumers don't need to know about codec
 * internals; tooling that needs the literal directly should import it
 * from here (the SoT).
 */

/** RGB / Display-P3 export-time colour profile. */
export type FigmaExportColorProfile = "SRGB" | "DISPLAY_P3_V4";

/** Figma's two export-time raster resampling modes. */
export type FigmaImageResamplingMethod = "DETAILED_BICUBIC" | "BASIC_NEAREST";

/**
 * Figma's image paint filter parameter bag. All fields are optional
 * adjustments in [-1, 1] (some span larger ranges); zero/missing is the
 * identity. The renderer-side type alias of this interface is the
 * `ImagePaintFilter` exposed on scene-graph image fills.
 */
export type ImagePaintFilter = {
  readonly highlights?: number;
  readonly shadows?: number;
  readonly tint?: number;
  readonly detail?: number;
  readonly exposure?: number;
  readonly vignette?: number;
  readonly temperature?: number;
  readonly vibrance?: number;
  readonly contrast?: number;
  readonly brightness?: number;
  readonly saturation?: number;
};

/** Normalised RGB sample in [0, 1]. */
export type Rgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

/** RGBA raster pixel buffer (row-major, 4 bytes per pixel). */
export type RgbaRaster = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

/**
 * ICC profile descriptor — the binary `data` is the raw ICC profile
 * bytes the file-format codec extracts (PNG `iCCP` chunk, JPEG APP2
 * `ICC_PROFILE` segment). Format-specific decoders produce this
 * structure for `identifySupportedIccProfile` to inspect; raster does
 * not parse the source file itself.
 */
export type IccProfile = {
  readonly name: string;
  readonly data: Uint8Array;
};

/**
 * Source-side raster metadata produced by a format codec. The fields
 * mirror what PNG / JPEG decoders expose for colour management
 * decisions; raster consumes this without importing any specific codec.
 */
export type RasterImageMetadata = {
  readonly gamma?: number;
  readonly srgbIntent?: number;
  readonly iccProfile?: IccProfile;
};
