/**
 * @file Translate Figma IMAGE paints to SwiftUI image expressions.
 *
 * SwiftUI's `Image` accepts a `CGImage` via `Image(decorative:scale:)`,
 * which is the cross-platform path (iOS / macOS / tvOS / visionOS
 * all expose `CGImage` from `CoreGraphics`). We embed the image
 * bytes inline as base64 inside the emitted Swift source so the
 * result compiles without external assets — at the cost of source
 * size, which is acceptable for the v0 round-trip emit since the
 * fixtures use small thumbnails. A future iteration can write the
 * bytes to a sibling resource directory and reference them by name.
 *
 * The Swift side decodes via `CGImageSourceCreateWithData` →
 * `CGImageSourceCreateImageAtIndex(0)`, which is the lowest-common
 * SwiftUI-supported entry that doesn't require AppKit/UIKit.
 */
import type {
  FigImagePaint,
  FigImageScaleMode,
  FigPaint,
} from "@higma-document-models/fig/types";
import { asImagePaint } from "@higma-document-models/fig/color";
import type { FigPackageImage } from "@higma-figma-containers/package";
import { getImageHash } from "@higma-document-renderers/fig/paint";
import { call, ident, member, namedArg, type SwiftExpr } from "../swift-tree";

/**
 * Pick the topmost visible IMAGE paint in a stack. Figma renders
 * paints back-to-front (first-in-array = furthest back), so the
 * topmost paint is the LAST visible entry of the requested kind.
 *
 * Picking the last visible IMAGE keeps the chosen paint consistent
 * with `topmostFillPaintEntry` in `modifiers.ts`: when the same paint
 * stack carries both a SOLID and an IMAGE, the topmost paint is what
 * the consumer sees on top, and the `<` index entries are
 * under-layers. The earlier "first" implementation broke the case
 * where a SOLID overpainted an IMAGE — the IMAGE was treated as the
 * topmost paint even though the SOLID actually composited on top.
 */
export function firstVisibleImagePaint(
  paints: readonly FigPaint[] | undefined,
): FigImagePaint | undefined {
  if (!paints) {
    return undefined;
  }
  for (let i = paints.length - 1; i >= 0; i -= 1) {
    const paint = paints[i];
    if (!paint || paint.visible === false) {
      continue;
    }
    const imagePaint = asImagePaint(paint);
    if (imagePaint !== undefined) {
      return imagePaint;
    }
  }
  return undefined;
}

/**
 * Build a SwiftUI `Image("<slug>", bundle: .module)` expression for a
 * resolved `FigPackageImage`. The image is identified by its
 * stable hash-derived `slug`; the CLI writes the actual bytes to
 * `<out>/Resources/<slug>.png` and `Package.swift` declares
 * `Resources/` as a bundled resource directory so SwiftUI's
 * bundle-aware Image initialiser can find it at runtime.
 *
 * The earlier inline `Data(base64Encoded:)` form embedded the PNG
 * bytes directly in the Swift source. For real-world fig files
 * (e.g. design systems with photographs) that produced multi-MB
 * Swift sources that the SwiftUI compiler choked on. The bundle
 * resource form keeps the Swift sources tiny and lets SwiftPM /
 * Xcode handle the asset lifecycle.
 */
export function imageBundleExpr(slug: string): SwiftExpr {
  return call("Image", [
    { value: { kind: "string", value: slug } },
    namedArg("bundle", member("module")),
  ]);
}

/**
 * Build a SwiftUI `makeFigToSwiftuiImage(data: Data(base64Encoded:
 * "..."))` expression that decodes the image bytes inline.
 *
 * Used ONLY by the visual-roundtrip spec harness, which compiles a
 * single .swift file with `swift CLI` and has no `Bundle.module`
 * available. Production CLI users get the bundle-resource form via
 * `imageBundleExpr` + a Resources/ folder declared in Package.swift.
 *
 * The returned expression assumes the user file declared the
 * `makeFigToSwiftuiImage` routine at file scope (see
 * `INLINE_IMAGE_DECODER_SOURCE` in `emit/file.ts`).
 */
export function imageInlineExpr(image: FigPackageImage): SwiftExpr {
  const base64 = uint8ArrayToBase64(image.data);
  const dataExpr = call("Data", [
    namedArg("base64Encoded", { kind: "string", value: base64 }),
    namedArg("options", member("ignoreUnknownCharacters")),
  ]);
  return call("makeFigToSwiftuiImage", [namedArg("data", dataExpr)]);
}

/**
 * Convert a Uint8Array of image bytes to a base64 string using
 * the standard `btoa` path so the output works in Bun / Node /
 * browsers without pulling in Buffer. Chunks the conversion to
 * stay below `String.fromCharCode`'s call-stack limit on large
 * images.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

/**
 * Resolved emit shape for a Figma `imageScaleMode`. Captures both the
 * SwiftUI `Image` resizing mode (`stretch` is the SwiftUI default,
 * `tile` repeats the source bitmap) and whether to constrain the
 * aspect ratio.
 *
 *   - FILL   → `aspect: "fill"`, resizing: `stretch` — image scales
 *              to cover the frame, aspect preserved (cropped at the
 *              shorter edge).
 *   - CROP   → same as FILL.
 *   - FIT    → `aspect: "fit"`, resizing: `stretch` — image scales
 *              to fit inside the frame, aspect preserved (letterbox).
 *   - STRETCH→ `aspect: "none"`, resizing: `stretch` — image stretches
 *              anisotropically to the frame (CSS `object-fit: fill`).
 *              `.aspectRatio(...)` MUST be omitted; otherwise SwiftUI
 *              clamps the image into a single fit/fill box and the
 *              aspect-distortion intent is lost.
 *   - TILE   → `aspect: "none"`, resizing: `tile` — the source bitmap
 *              tiles across the frame. SwiftUI realises this via
 *              `.resizable(resizingMode: .tile)`. Aspect ratio is
 *              irrelevant for a repeating tile.
 */
export type ImageEmitShape = {
  readonly aspect: "fill" | "fit" | "none";
  readonly resizing: "stretch" | "tile";
};

/**
 * Resolve a Figma `scaleMode` / `imageScaleMode` value to the
 * `ImageEmitShape` (resizing × aspect) the SwiftUI emitter needs.
 * `undefined` is accepted only for callers that have no authored
 * ImageScaleMode field in the Kiwi payload; it maps to FILL.
 */
export function contentModeFor(scale: FigImageScaleMode | undefined): ImageEmitShape {
  if (!scale) {
    return { aspect: "fill", resizing: "stretch" };
  }
  switch (scale) {
    case "FILL":
      return { aspect: "fill", resizing: "stretch" };
    case "FIT":
      return { aspect: "fit", resizing: "stretch" };
    case "STRETCH":
      return { aspect: "none", resizing: "stretch" };
    case "TILE":
      return { aspect: "none", resizing: "tile" };
  }
}

/**
 * Stable filesystem-safe slug for a fig image. Uses the image's
 * resolved `image.hash` hex as-is — SHA-1-style ids stay
 * stable across emit runs even when the order of paints changes,
 * so the `<out>/Resources/<slug>.png` filename doesn't churn for
 * unchanged inputs.
 */
export function imageSlug(ref: string): string {
  return `image-${ref}`;
}

/** True when the paint stack contains a usable IMAGE paint. */
export function hasUsableImagePaint(
  paints: readonly FigPaint[] | undefined,
  images: ReadonlyMap<string, FigPackageImage> | undefined,
): boolean {
  if (!images) {
    return false;
  }
  const paint = firstVisibleImagePaint(paints);
  if (!paint) {
    return false;
  }
  const ref = getImageHash(paint);
  return images.has(ref);
}

/** Suppress the unused-import warning when the consumer module
 * imports `ident` indirectly through this routine. */
void ident;
