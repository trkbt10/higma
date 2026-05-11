/**
 * @file Sync PNG decoder used by the emit pipeline to inline IMAGE
 * paint bytes into a Godot `Image` sub-resource.
 *
 * The `IMAGE` paint emit path needs raw RGBA8 pixels — Godot's
 * `[sub_resource type="Image"]` block reads its `data.data` field as
 * a `PackedByteArray` of 4-byte-per-pixel RGBA. The fig source
 * (`ctx.images.get(hash).data`) carries the original encoded PNG/JPEG
 * bytes.
 *
 * `pngjs` is the only sync PNG decoder available in the workspace
 * (used by the spec runner's pixel probe scripts and the
 * `@higma-codecs/png-compare` peer). Wrapping it here keeps the
 * walker free of external deps and makes the Fail-Fast / `undefined`
 * decision sit at the boundary.
 */
import { PNG } from "pngjs";

export type DecodedPng = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

/**
 * Decode a PNG buffer into raw RGBA8. Returns `undefined` on decode
 * failure (e.g. truncated file, unsupported colour type) so the
 * caller can surface a Fail-Fast for the image without crashing the
 * whole emit run.
 */
export function decodePng(bytes: Uint8Array): DecodedPng | undefined {
  // pngjs reads from a Buffer; Bun/Node both accept a Uint8Array
  // wrapped via Buffer.from. Copy is unavoidable without an
  // experimental zero-copy bridge — not worth it for the kilobyte
  // texture sizes we deal with in v0.
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let png: PNG;
  try {
    png = PNG.sync.read(buf);
  } catch {
    return undefined;
  }
  if (png.width <= 0 || png.height <= 0 || png.data.length === 0) {
    return undefined;
  }
  // `png.data` is a Buffer of RGBA8 (pngjs default `colorType=6`).
  // Re-wrap as a Uint8Array view so downstream consumers don't have
  // to know about node Buffer specifically.
  const rgba = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  return { width: png.width, height: png.height, data: rgba };
}
