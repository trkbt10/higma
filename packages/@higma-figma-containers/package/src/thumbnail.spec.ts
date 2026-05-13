/**
 * @file Spec for the thumbnail SoT: clamp behaviour + constant identity.
 */

import {
  FIG_THUMBNAIL_MAX_DIMENSION,
  FIG_THUMBNAIL_ZIP_ENTRY,
  fitFigThumbnailSize,
} from "./thumbnail";

describe("FIG_THUMBNAIL_ZIP_ENTRY", () => {
  it("matches the ZIP entry name Figma's importer reads", () => {
    // Hard-coded by Figma — locking in the literal here prevents a
    // future rename from silently breaking import.
    expect(FIG_THUMBNAIL_ZIP_ENTRY).toBe("thumbnail.png");
  });
});

describe("FIG_THUMBNAIL_MAX_DIMENSION", () => {
  it("equals 400 (every community .fig sampled in the wild)", () => {
    expect(FIG_THUMBNAIL_MAX_DIMENSION).toBe(400);
  });
});

describe("fitFigThumbnailSize", () => {
  it("returns source dimensions verbatim when both axes fit under the cap", () => {
    expect(fitFigThumbnailSize({ width: 320, height: 240 })).toEqual({ width: 320, height: 240 });
  });

  it("clamps the longer axis to maxDimension and scales the smaller proportionally", () => {
    // 1600/800 -> longer axis 1600 clamps to 400 (scale=0.25); 800*0.25 = 200.
    expect(fitFigThumbnailSize({ width: 1600, height: 800 })).toEqual({ width: 400, height: 200 });
  });

  it("treats the taller axis identically (clamp is axis-agnostic)", () => {
    expect(fitFigThumbnailSize({ width: 200, height: 800 })).toEqual({ width: 100, height: 400 });
  });

  it("respects an explicit non-default cap", () => {
    expect(fitFigThumbnailSize({ width: 1000, height: 500 }, 200)).toEqual({ width: 200, height: 100 });
  });

  it("rounds fractional inputs to integer pixels", () => {
    expect(fitFigThumbnailSize({ width: 100.4, height: 100.6 })).toEqual({ width: 100, height: 101 });
  });

  it("rounds up sub-pixel dimensions to at least 1×1", () => {
    // A 1×0.4 source would round the smaller axis to 0; clamp to 1.
    expect(fitFigThumbnailSize({ width: 1, height: 0.4 })).toEqual({ width: 1, height: 1 });
  });

  it("throws on a zero or negative source dimension", () => {
    expect(() => fitFigThumbnailSize({ width: 0, height: 100 })).toThrow(/dimensions must be > 0/);
    expect(() => fitFigThumbnailSize({ width: 100, height: -5 })).toThrow(/dimensions must be > 0/);
  });

  it("throws on a zero or negative maxDimension", () => {
    expect(() => fitFigThumbnailSize({ width: 100, height: 100 }, 0)).toThrow(/maxDimension must be > 0/);
  });
});
