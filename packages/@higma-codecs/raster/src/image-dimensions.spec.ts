import { describe, expect, it } from "vitest";
import { getImageDimensions } from "./image-dimensions";

/** Assemble a JPEG byte stream from raw segment fragments. */
function jpeg(...segments: readonly number[][]): Uint8Array {
  return new Uint8Array(segments.flat());
}

/** A length-prefixed JPEG segment: marker + 2-byte length + payload. */
function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/** A Start-Of-Frame payload encoding the given height/width. */
function sofPayload(height: number, width: number): number[] {
  return [0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 0x01, 0x11, 0x00];
}

describe("getImageDimensions", () => {
  it("reads the main JPEG frame size", () => {
    const data = jpeg([0xff, 0xd8], segment(0xc0, sofPayload(846, 736)));
    expect(getImageDimensions(data, "image/jpeg")).toEqual({ width: 736, height: 846 });
  });

  it("skips an EXIF (APP1) thumbnail whose own SOF marker precedes the real frame", () => {
    // APP1 payload embeds a complete FF C0 marker for a 160x139 thumbnail.
    // A byte-scan would stop there; honouring the segment length must not.
    const thumbnailSof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0xa0, 0x00, 0x8b, 0x01, 0x11];
    const app1 = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...thumbnailSof]);
    const data = jpeg([0xff, 0xd8], app1, segment(0xc0, sofPayload(846, 736)));
    expect(getImageDimensions(data, "image/jpeg")).toEqual({ width: 736, height: 846 });
  });

  it("walks past unrelated segments (DQT) before the frame header", () => {
    const dqt = segment(0xdb, new Array(65).fill(0x10));
    const data = jpeg([0xff, 0xd8], dqt, segment(0xc2, sofPayload(200, 100)));
    expect(getImageDimensions(data, "image/jpeg")).toEqual({ width: 100, height: 200 });
  });

  it("reads PNG dimensions from IHDR", () => {
    const data = new Uint8Array(24);
    data.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(data.buffer).setUint32(16, 320);
    new DataView(data.buffer).setUint32(20, 240);
    expect(getImageDimensions(data, "image/png")).toEqual({ width: 320, height: 240 });
  });
});
