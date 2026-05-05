/**
 * @file Fig package image payload helpers
 */

export type FigPackageImage = {
  readonly ref: string;
  readonly data: Uint8Array;
  readonly mimeType: string;
};

/** Detect an image MIME type from its magic bytes. */
export function getMimeTypeFromContent(data: Uint8Array): string {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

/** Resolve an image MIME type from its path extension. */
export function getMimeTypeFromPath(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/** Resolve an image MIME type using content first and file path as fallback. */
export function getFigPackageImageMimeType(filename: string, data: Uint8Array): string {
  const contentMime = getMimeTypeFromContent(data);
  if (contentMime !== "application/octet-stream") {
    return contentMime;
  }
  return getMimeTypeFromPath(filename);
}
