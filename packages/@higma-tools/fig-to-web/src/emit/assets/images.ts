/**
 * @file Image-asset extraction.
 *
 * Image paints reference binary data by hash through one of three
 * fields the parser may surface (`imageRef`, `image.hash`,
 * `imageHash`). The bytes themselves live in
 * `source.loaded.images`, keyed by reference string.
 *
 * The emit pipeline cannot inline images into JSX — they have to land
 * on disk so the browser can fetch them. We collect every image
 * reference touched by the emitted subtrees, write each unique one to
 * `assets/<hash>.<ext>` (extension from MIME), and return a resolver
 * the paint emitter calls to translate paint → URL.
 *
 * Hash format normalisation:
 *   - String form: a hex content-hash, used verbatim.
 *   - Byte-array form (`readonly number[]`): joined into a hex string.
 *   The resulting key matches the `ref` field on `FigPackageImage`,
 *   which is how `LoadedFigFile.images` is keyed.
 */
import type { FigImagePaint } from "@higma-document-models/fig/types";
import type { FigImage } from "@higma-document-models/fig/domain";

export type ImageAsset = {
  /** Path relative to the output root, e.g. `"assets/1234abcd.png"`. */
  readonly path: string;
  readonly bytes: Uint8Array;
};

export type ImageRegistry = {
  /** Resolve a paint to a relative asset URL, or undefined when missing. */
  readonly resolve: (paint: FigImagePaint) => string | undefined;
  /** Snapshot of every asset that was actually referenced. */
  readonly collected: () => readonly ImageAsset[];
};

const EXTENSION_BY_MIME: ReadonlyMap<string, string> = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);

function bytesToHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pull a stable hex/string ref out of any of the encodings Figma uses. */
export function paintImageRef(paint: FigImagePaint): string | undefined {
  if (typeof paint.imageRef === "string" && paint.imageRef.length > 0) {
    return paint.imageRef;
  }
  if (typeof paint.imageHash === "string" && paint.imageHash.length > 0) {
    return paint.imageHash;
  }
  if (Array.isArray(paint.imageHash) && paint.imageHash.length > 0) {
    return bytesToHex(paint.imageHash);
  }
  if (paint.image?.hash && paint.image.hash.length > 0) {
    return bytesToHex(paint.image.hash);
  }
  return undefined;
}

function extensionFor(image: FigImage): string {
  return EXTENSION_BY_MIME.get(image.mimeType) ?? "bin";
}

function assetPathFor(ref: string, image: FigImage): string {
  return `assets/${ref}.${extensionFor(image)}`;
}

/**
 * Build a registry that the paint emitter can ask for image URLs.
 *
 * The registry is *side-effecting* in a contained way: each call to
 * `resolve()` records the asset under `collected()`. Callers only
 * write the bytes that were actually referenced, keeping output
 * directories from filling up with every asset in the source file
 * regardless of which frames the user picked.
 */
export function createImageRegistry(images: ReadonlyMap<string, FigImage>): ImageRegistry {
  const collected = new Map<string, ImageAsset>();
  return {
    resolve: (paint: FigImagePaint) => {
      const ref = paintImageRef(paint);
      if (!ref) {
        return undefined;
      }
      const image = images.get(ref);
      if (!image) {
        return undefined;
      }
      const path = assetPathFor(ref, image);
      if (!collected.has(ref)) {
        collected.set(ref, { path, bytes: image.data });
      }
      return `./${path}`;
    },
    collected: () => [...collected.values()],
  };
}
