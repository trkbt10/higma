/**
 * @file Tests for WebGL fill UV calculations
 */

import { computeImageUV } from "./fill-renderer";

describe("computeImageUV", () => {
  it("marks FIT letterbox regions as transparent", () => {
    const uv = computeImageUV({
      elementW: 100,
      elementH: 100,
      imageW: 200,
      imageH: 100,
      scaleMode: "FIT",
    });

    expect(uv.texScale).toEqual({ x: 0.01, y: 0.02 });
    expect(uv.texOffset).toEqual({ x: 0, y: -0.5 });
    expect(uv.repeat).toBe(false);
    expect(uv.clipTransparent).toBe(true);
  });

  it("uses repeating image-space UVs for TILE", () => {
    const uv = computeImageUV({
      elementW: 100,
      elementH: 100,
      imageW: 200,
      imageH: 100,
      scaleMode: "TILE",
      scalingFactor: 0.5,
    });

    expect(uv.texScale).toEqual({ x: 0.01, y: 0.02 });
    expect(uv.texOffset).toEqual({ x: 0, y: 0 });
    expect(uv.repeat).toBe(true);
    expect(uv.clipTransparent).toBe(false);
  });

  it("maps element-uv through the user-positioned transform for CROP", () => {
    // Real .fig sample: portrait image dragged into a wide hero rectangle.
    // The wire format stored imageScaleMode=STRETCH with this transform; the
    // convert layer normalises it to CROP so the renderer applies the
    // transform instead of plain-stretching the image into the rect.
    const uv = computeImageUV({
      elementW: 1440,
      elementH: 663,
      imageW: 2730,
      imageH: 4096,
      scaleMode: "CROP",
      imageTransform: {
        m00: 2.1431989669799805, m01: 0, m02: -1.0626695156097412,
        m10: 0, m11: 0.6576825380325317, m12: 0.04567856714129448,
      },
    });

    // Per-component: image_uv = imageTransform · element_uv. Sampling at the
    // rect's pixel-space corners therefore lands at the cropped slice of the
    // image, not at (0,0)..(1,1).
    expect(uv.texScale.x).toBeCloseTo(2.1431989669799805 / 1440, 9);
    expect(uv.texScale.y).toBeCloseTo(0.6576825380325317 / 663, 9);
    expect(uv.texOffset.x).toBeCloseTo(-1.0626695156097412, 9);
    expect(uv.texOffset.y).toBeCloseTo(0.04567856714129448, 9);
    expect(uv.repeat).toBe(false);
    expect(uv.clipTransparent).toBe(true);
  });

  it("rejects CROP without an explicit imageTransform", () => {
    expect(() => computeImageUV({
      elementW: 100,
      elementH: 100,
      imageW: 100,
      imageH: 100,
      scaleMode: "CROP",
    })).toThrow("CROP imageScaleMode requires an explicit imageTransform");
  });

  it("rejects CROP with a rotated imageTransform until the shader supports it", () => {
    expect(() => computeImageUV({
      elementW: 100,
      elementH: 100,
      imageW: 100,
      imageH: 100,
      scaleMode: "CROP",
      imageTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
    })).toThrow("CROP imageScaleMode with a rotated/skewed imageTransform");
  });
});
