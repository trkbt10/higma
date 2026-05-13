/**
 * @file Fig-package thumbnail SoT.
 *
 * Centralises the conventions Figma's importer relies on for the
 * document cover image inside a `.fig` ZIP:
 *
 *   - The ZIP entry name (`thumbnail.png`)
 *   - The longest-axis pixel cap (400)
 *   - The aspect-preserving clamp formula that derives PNG dimensions
 *     from a canvas-space rectangle
 *
 * Sampled values come from every community `.fig` in the wild —
 * `meta.json` → `client_meta.thumbnail_size` consistently clamps the
 * longer axis to 400 with the smaller axis scaled to preserve aspect
 * ratio. Pre-existing hand-coded copies of these literals (the lint
 * rule, the runtime/roundtrip writer, the io exporter) are migrating
 * to this module so a future schema bump only needs to touch one place.
 *
 * Byte-level PNG validation (magic / encoding / parsing) lives in
 * `@higma-codecs/png`. This module owns only the fig-package
 * vocabulary that sits on top of that codec — it deliberately does
 * not re-export the codec to keep the dependency direction obvious.
 */

// =============================================================================
// ZIP entry
// =============================================================================

/**
 * Name of the ZIP entry Figma's importer reads for the document
 * cover. Hard-coded by Figma's parser; we mirror it verbatim.
 */
export const FIG_THUMBNAIL_ZIP_ENTRY = "thumbnail.png" as const;

// =============================================================================
// Dimension cap
// =============================================================================

/**
 * Largest dimension Figma writes for `thumbnail.png`. Every sampled
 * community export clamps `max(width, height)` to 400, scaling the
 * smaller axis to preserve aspect ratio. Stored as a `number` (not
 * `400 as const`) so callers can pass it where `number` is required
 * without casting.
 */
export const FIG_THUMBNAIL_MAX_DIMENSION: number = 400;

/**
 * Source bounds expected by `fitFigThumbnailSize`. Structurally
 * compatible with `client_meta.thumbnail_size` and the canvas-space
 * rectangle the editor hands in when the user runs "Set as thumbnail".
 */
export type FigThumbnailSourceSize = {
  readonly width: number;
  readonly height: number;
};

/** PNG pixel dimensions returned by `fitFigThumbnailSize`. */
export type FigThumbnailPixelSize = {
  readonly width: number;
  readonly height: number;
};

/**
 * Clamp the longer axis of `source` to `maxDimension` (default =
 * `FIG_THUMBNAIL_MAX_DIMENSION`), preserving aspect ratio. Rounds to
 * integer pixels because the surrounding codec writes the values
 * straight into PNG `IHDR`.
 *
 * Fail-fast on non-positive inputs — callers that hand in a zero-size
 * frame have an upstream bug we want to surface, not paper over.
 */
export function fitFigThumbnailSize(
  source: FigThumbnailSourceSize,
  maxDimension: number = FIG_THUMBNAIL_MAX_DIMENSION,
): FigThumbnailPixelSize {
  if (!(source.width > 0) || !(source.height > 0)) {
    throw new Error(
      `fitFigThumbnailSize: source dimensions must be > 0; got ${source.width}x${source.height}`,
    );
  }
  if (!(maxDimension > 0)) {
    throw new Error(
      `fitFigThumbnailSize: maxDimension must be > 0; got ${maxDimension}`,
    );
  }
  const longest = Math.max(source.width, source.height);
  if (longest <= maxDimension) {
    return {
      width: Math.max(1, Math.round(source.width)),
      height: Math.max(1, Math.round(source.height)),
    };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}
