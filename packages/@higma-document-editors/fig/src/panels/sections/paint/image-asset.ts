/** @file Image asset creation for fill/stroke editors. */

import type { FigPackageImage } from "@higma-figma-containers/package";

export type CreateFigImageAssetParams = {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly fileName: string;
};

/** Build a stable image asset entry and ref for a browser-selected file. */
export function createFigImageAsset({ data, mimeType, fileName }: CreateFigImageAssetParams): FigPackageImage {
  if (data.length === 0) {
    throw new Error("Image asset data is empty");
  }
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Unsupported image MIME type: ${mimeType}`);
  }
  requireSupportedImageName({ mimeType, fileName });
  const ref = hashBytes(data);
  return { ref, data, mimeType };
}

function requireSupportedImageName({ mimeType, fileName }: { readonly mimeType: string; readonly fileName: string }): void {
  const lowerName = fileName.toLowerCase();
  const nameExt = lowerName.match(/\.([a-z0-9]+)$/)?.[1];
  if (nameExt === "jpeg") {
    return;
  }
  if (nameExt !== undefined && ["png", "jpg", "gif", "webp", "svg"].includes(nameExt)) {
    return;
  }
  switch (mimeType) {
    case "image/png":
      return;
    case "image/jpeg":
      return;
    case "image/gif":
      return;
    case "image/webp":
      return;
    case "image/svg+xml":
      return;
    default:
      throw new Error(`Unsupported image MIME type: ${mimeType}`);
  }
}

function hashBytes(data: Uint8Array): string {
  const hash = data.reduce((current, byte) => Math.imul(current ^ byte, 0x01000193), 0x811c9dc5);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
