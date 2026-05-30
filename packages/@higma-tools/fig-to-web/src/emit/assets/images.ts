/**
 * @file Image-asset extraction.
 *
 * Image paints reference binary data by hash. The bytes themselves
 * live in `source.loaded.images`, keyed by reference string.
 *
 * The emit pipeline cannot inline images into JSX — they have to land
 * on disk so the browser can fetch them. We collect every image
 * reference touched by the emitted subtrees, write each unique one to
 * `assets/<hash>.<ext>` (extension from MIME), and return a resolver
 * the paint emitter calls to translate paint → URL.
 *
 */
import type { FigImagePaint } from "@higma-document-models/fig/types";
import type { FigPackageImage } from "@higma-figma-containers/package";
import { getImageHash } from "@higma-document-renderers/fig/paint";

export type ImageAsset = {
  /** Path relative to the output root, e.g. `"assets/1234abcd.png"`. */
  readonly path: string;
  readonly bytes: Uint8Array;
};

export type ImageRegistry = {
  /** Resolve a paint to a root-absolute asset URL (`/assets/…`), or undefined when missing. */
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

/** Pull the canonical image ref through the renderer paint SoT. */
export function paintImageRef(paint: FigImagePaint): string | undefined {
  return getImageHash(paint);
}

function extensionFor(image: FigPackageImage): string {
  return EXTENSION_BY_MIME.get(image.mimeType) ?? "bin";
}

function assetPathFor(ref: string, image: FigPackageImage): string {
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
export function createImageRegistry(images: ReadonlyMap<string, FigPackageImage>): ImageRegistry {
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
      // Root-absolute, not document-relative: a standalone page lives
      // three directories deep (`pages/<canvas>/<slug>/`) while assets are
      // written once at the output root. `./assets/…` would resolve under
      // the page directory and 404 from any served depth; `/assets/…`
      // resolves from the served root at every page depth.
      return `/${path}`;
    },
    collected: () => [...collected.values()],
  };
}
