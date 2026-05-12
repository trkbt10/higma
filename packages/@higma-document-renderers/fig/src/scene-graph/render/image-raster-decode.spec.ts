/** @file Image raster decode tests. */

import { extractJpegIccProfile } from "@higma-codecs/raster";

const SOI = [0xff, 0xd8] as const;
const EOI = [0xff, 0xd9] as const;
const ICC_PREFIX = [
  0x49,
  0x43,
  0x43,
  0x5f,
  0x50,
  0x52,
  0x4f,
  0x46,
  0x49,
  0x4c,
  0x45,
  0x00,
] as const;

function app2Segment(sequence: number, count: number, payload: readonly number[]): readonly number[] {
  const body = [...ICC_PREFIX, sequence, count, ...payload];
  const length = body.length + 2;
  return [0xff, 0xe2, (length >> 8) & 0xff, length & 0xff, ...body];
}

describe("JPEG ICC profile extraction", () => {
  it("assembles APP2 ICC profile segments in sequence order", () => {
    const jpeg = new Uint8Array([
      ...SOI,
      ...app2Segment(2, 2, [3, 4]),
      ...app2Segment(1, 2, [1, 2]),
      ...EOI,
    ]);

    const profile = extractJpegIccProfile(jpeg);

    expect(profile?.name).toBe("ICC Profile");
    expect(profile?.data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("rejects incomplete APP2 ICC profile segments", () => {
    const jpeg = new Uint8Array([
      ...SOI,
      ...app2Segment(1, 2, [1, 2]),
      ...EOI,
    ]);

    expect(() => extractJpegIccProfile(jpeg)).toThrow("JPEG ICC APP2 profile is missing segments");
  });
});
