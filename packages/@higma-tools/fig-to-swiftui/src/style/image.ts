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
import type { FigPackageImage } from "@higma-figma-containers/package";
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
    if (paint.type === "IMAGE") {
      return paint;
    }
  }
  return undefined;
}

/**
 * Resolve the imageRef channel an `IMAGE` paint carries. Mirrors the
 * renderer's `getImageRef` ordering: API-format `imageRef` first,
 * then Kiwi-format `image.hash`, then alternative `imageHash`.
 */
export function resolveImageRef(paint: FigImagePaint): string | undefined {
  if (paint.imageRef) {
    return paint.imageRef;
  }
  if (paint.image?.hash && Array.isArray(paint.image.hash) && paint.image.hash.length > 0) {
    return hashArrayToHex(paint.image.hash);
  }
  const imageHash = paint.imageHash;
  if (typeof imageHash === "string") {
    return imageHash;
  }
  if (Array.isArray(imageHash) && imageHash.length > 0) {
    return hashArrayToHex(imageHash);
  }
  return undefined;
}

/**
 * Build a SwiftUI `Image(decorative:scale:)` expression from a
 * resolved `FigPackageImage`. Returns `undefined` when the image
 * bytes are missing.
 */
export function imageExpr(image: FigPackageImage): SwiftExpr {
  const base64 = uint8ArrayToBase64(image.data);
  const dataExpr = call("Data", [
    namedArg("base64Encoded", { kind: "string", value: base64 }),
    namedArg("options", member("ignoreUnknownCharacters")),
  ]);
  // CGImageSourceCreateWithData → CGImageSourceCreateImageAtIndex(0).
  // Wrap in a closure so the conversion happens inline. Returns
  // an `Image?` — the caller is expected to wrap with `?? Color.gray`
  // or handle nil downstream.
  return call("makeFigToSwiftuiImage", [
    namedArg("data", dataExpr),
  ]);
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
 * `undefined` defaults to `FILL` to match Figma's authoring default.
 */
export function contentModeFor(scale: FigImageScaleMode | undefined): ImageEmitShape {
  if (!scale) {
    return { aspect: "fill", resizing: "stretch" };
  }
  switch (scale) {
    case "FILL":
    case "CROP":
      return { aspect: "fill", resizing: "stretch" };
    case "FIT":
      return { aspect: "fit", resizing: "stretch" };
    case "STRETCH":
      return { aspect: "none", resizing: "stretch" };
    case "TILE":
      return { aspect: "none", resizing: "tile" };
  }
}

function hashArrayToHex(bytes: readonly number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Avoid Buffer (Node-only). Build base64 via the standard btoa
  // path which works in Bun / Node / browsers. Chunk the conversion
  // to stay below the call-stack limit on String.fromCharCode for
  // large images.
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
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
  const ref = resolveImageRef(paint);
  if (!ref) {
    return false;
  }
  return images.has(ref);
}

/** Suppress the unused-import warning when the consumer module
 * imports `ident` indirectly through this helper. */
void ident;
