/**
 * @file Image dimension extraction from binary headers
 *
 * Extracts pixel dimensions from PNG (IHDR) and JPEG (SOF0/SOF2) binary data
 * without decoding the full image. Used for image fill pattern calculations
 * where the natural image size determines the pattern transform.
 */

export type ImageDimensions = {
  readonly width: number;
  readonly height: number;
};

/**
 * Extract pixel dimensions from image binary data.
 *
 * Supports JPEG (SOF0/SOF2 markers) and PNG (IHDR chunk).
 * Returns undefined if the format is unrecognized or data is too short.
 */
export function getImageDimensions(data: Uint8Array, mimeType: string): ImageDimensions | undefined {
  if (mimeType === "image/png" && data.length >= 24) {
    // PNG IHDR: bytes 16-19 = width (big-endian), 20-23 = height
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return jpegFrameDimensions(data);
  }

  return undefined;
}

/**
 * Read the JPEG frame (SOF) dimensions by walking the marker segments,
 * skipping each non-SOF segment by its declared length.
 *
 * A byte-scan for `FF C0` is unsafe: APP1/EXIF metadata can embed a
 * compressed thumbnail whose own SOF marker appears *inside* the APP1
 * segment. Scanning byte-by-byte finds that thumbnail's tiny dimensions
 * (e.g. 139×160) instead of the main image's (e.g. 736×846), which then
 * scales the fill pattern off a fraction of the real resolution and blurs
 * the image. Honouring segment lengths skips the APP1 payload entirely and
 * lands on the real frame header.
 */
function jpegFrameDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) {
    return undefined;
  }
  let offset = 2;
  while (offset + 1 < data.length) {
    if (data[offset] !== 0xFF) {
      offset += 1;
      continue;
    }
    // Skip any fill bytes (runs of 0xFF) preceding the marker code.
    let markerIndex = offset + 1;
    while (markerIndex < data.length && data[markerIndex] === 0xFF) {
      markerIndex += 1;
    }
    if (markerIndex >= data.length) {
      return undefined;
    }
    const marker = data[markerIndex];
    offset = markerIndex + 1;
    // Standalone markers carry no length payload: SOI/EOI/TEM and the
    // restart markers RST0..RST7.
    if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      continue;
    }
    if (offset + 1 >= data.length) {
      return undefined;
    }
    const segmentLength = (data[offset] << 8) | data[offset + 1];
    if (segmentLength < 2) {
      return undefined;
    }
    // SOF0..SOF15 carry the frame size; exclude DHT (0xC4), JPG (0xC8) and
    // DAC (0xCC), which share the 0xC0..0xCF range but are not frame headers.
    const isStartOfFrame =
      marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isStartOfFrame) {
      // SOF payload: length(2) precision(1) height(2) width(2) …
      if (offset + 6 >= data.length) {
        return undefined;
      }
      const height = (data[offset + 3] << 8) | data[offset + 4];
      const width = (data[offset + 5] << 8) | data[offset + 6];
      if (width > 0 && height > 0) {
        return { width, height };
      }
      return undefined;
    }
    offset += segmentLength;
  }
  return undefined;
}
