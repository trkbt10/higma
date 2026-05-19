/**
 * @file Paint interpretation SoT tests.
 */

import {
  getGradientStops,
  getGradientDirection,
  getGradientDirectionFromTransform,
  getRadialGradientCenterAndRadius,
  getImageHash,
  getScaleMode,
} from "./interpret";
import type { FigGradientPaint, FigImagePaint } from "@higma-document-models/fig/types";
import { PAINT_TYPE_VALUES, SCALE_MODE_VALUES } from "@higma-document-models/fig/constants";

describe("getGradientStops", () => {
  it("reads Kiwi stops", () => {
    const paint: FigGradientPaint = {
      type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
      stops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    };
    const stops = getGradientStops(paint);
    expect(stops).toHaveLength(2);
    expect(stops[0].position).toBe(0);
    expect(stops[1].position).toBe(1);
  });

  it("throws when stops are missing", () => {
    const paint: FigGradientPaint = {
      type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    };
    expect(() => getGradientStops(paint)).toThrow("Gradient paint requires non-empty stops");
  });
});

describe("getGradientDirection", () => {
  it("rejects a rank-deficient transform matrix", () => {
    const paint: FigGradientPaint = {
      type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
      transform: { m00: 0, m01: 0, m02: 0.5, m10: -1, m11: 0, m12: 1 },
    };
    expect(() => getGradientDirection(paint)).toThrow(/non-invertible|det=0/);
  });

  it("reads from an invertible Kiwi transform matrix", () => {
    const paint: FigGradientPaint = {
      type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
      transform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
    };
    const dir = getGradientDirection(paint);
    expect(dir.start.y).toBeCloseTo(0);
    expect(dir.end.y).toBeCloseTo(1);
  });
});

describe("getGradientDirectionFromTransform", () => {
  it("extracts direction from transform matrix", () => {
    const transform = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const dir = getGradientDirectionFromTransform(transform);
    expect(dir.start).toBeDefined();
    expect(dir.end).toBeDefined();
  });

  it("throws when transform is missing", () => {
    expect(() => getGradientDirectionFromTransform(undefined)).toThrow("Linear gradient paint requires transform");
  });
});

describe("getRadialGradientCenterAndRadius", () => {
  it("reads from Kiwi transform", () => {
    const paint: FigGradientPaint = {
      type: { value: PAINT_TYPE_VALUES.GRADIENT_RADIAL, name: "GRADIENT_RADIAL" },
      transform: { m00: 0.5, m02: 0.5, m12: 0.5 },
    };
    const { center, radius } = getRadialGradientCenterAndRadius(paint);
    expect(center).toEqual({ x: 0.5, y: 0.5 });
    expect(radius).toBe(0.5);
  });
});

describe("getImageHash", () => {
  it("reads from image.hash byte array", () => {
    const paint: FigImagePaint = {
      type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
      image: { hash: [0xab, 0xcd, 0xef] },
      imageScaleMode: { value: SCALE_MODE_VALUES.FILL, name: "FILL" },
    };
    expect(getImageHash(paint)).toBe("abcdef");
  });

  it("throws when image.hash is missing", () => {
    const paint: FigImagePaint = {
      type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
      imageScaleMode: { value: SCALE_MODE_VALUES.FILL, name: "FILL" },
    };
    expect(() => getImageHash(paint)).toThrow("IMAGE paint requires image.hash");
  });
});

describe("getScaleMode", () => {
  it("reads from imageScaleMode Kiwi enum payload", () => {
    const paint: FigImagePaint = {
      type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
      image: { hash: [0xab] },
      imageScaleMode: { value: SCALE_MODE_VALUES.FIT, name: "FIT" },
    };
    expect(getScaleMode(paint)).toBe("FIT");
  });

  it("throws when imageScaleMode is missing", () => {
    const paint: FigImagePaint = {
      type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
      image: { hash: [0xab] },
    };
    expect(() => getScaleMode(paint)).toThrow("IMAGE paint requires imageScaleMode");
  });
});
