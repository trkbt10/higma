/** @file PNG image read/write metadata tests. */

import { createPngImage, readPng, writePng } from "./png-image";

const SRGB_CHROMATICITY = {
  whitePointX: 0.3127,
  whitePointY: 0.329,
  redX: 0.64,
  redY: 0.33,
  greenX: 0.3,
  greenY: 0.6,
  blueX: 0.15,
  blueY: 0.06,
};

describe("png image metadata", () => {
  it("preserves sRGB rendering intent through read/write", () => {
    const source = createPngImage({ width: 1, height: 1 });
    source.data[0] = 255;
    source.data[3] = 255;

    const encoded = writePng({ ...source, srgbIntent: 0 });
    const decoded = readPng(encoded);
    const reencoded = writePng(decoded);
    const reparsed = readPng(reencoded);

    expect(decoded.srgbIntent).toBe(0);
    expect(reparsed.srgbIntent).toBe(0);
  });

  it("preserves cHRM chromaticity through read/write", () => {
    const source = createPngImage({ width: 1, height: 1 });
    source.data[0] = 255;
    source.data[3] = 255;

    const encoded = writePng({ ...source, chromaticity: SRGB_CHROMATICITY });
    const decoded = readPng(encoded);
    const reencoded = writePng(decoded);
    const reparsed = readPng(reencoded);

    expect(decoded.chromaticity).toEqual(SRGB_CHROMATICITY);
    expect(reparsed.chromaticity).toEqual(SRGB_CHROMATICITY);
  });

  it("preserves embedded ICC profile data through read/write", () => {
    const source = createPngImage({ width: 1, height: 1 });
    const profile = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]);
    source.data[0] = 255;
    source.data[3] = 255;

    const encoded = writePng({ ...source, iccProfile: { name: "sRGB", data: profile } });
    const decoded = readPng(encoded);
    const reencoded = writePng(decoded);
    const reparsed = readPng(reencoded);

    expect(decoded.iccProfile?.name).toBe("sRGB");
    expect(decoded.iccProfile?.data).toEqual(profile);
    expect(reparsed.iccProfile?.name).toBe("sRGB");
    expect(reparsed.iccProfile?.data).toEqual(profile);
  });

  it("rejects conflicting ICC and sRGB metadata", () => {
    const source = createPngImage({ width: 1, height: 1 });
    source.data[3] = 255;

    expect(() => writePng({
      ...source,
      srgbIntent: 0,
      iccProfile: { name: "sRGB", data: new Uint8Array([1]) },
    })).toThrow("PNG iCCP profile must not be combined");
  });
});
