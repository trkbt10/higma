/** @file Spec for WebGL effect backing-buffer region derivation. */

import {
  expandWebGLEffectRenderRegionForShaderSampling,
  resolveWebGLEffectBackdropCopyRegion,
} from "./effect-render-region";

describe("resolveWebGLEffectBackdropCopyRegion", () => {
  it("uses the effect scissor region as the WebGL backdrop copy source and texture destination", () => {
    expect(resolveWebGLEffectBackdropCopyRegion({
      x: 12,
      y: 34,
      width: 56,
      height: 78,
    })).toEqual({
      textureX: 12,
      textureY: 34,
      sourceX: 12,
      sourceY: 34,
      width: 56,
      height: 78,
    });
  });

  it("does not request a WebGL copy for an empty effect region", () => {
    expect(resolveWebGLEffectBackdropCopyRegion({
      x: 12,
      y: 34,
      width: 0,
      height: 78,
    })).toBeNull();
    expect(resolveWebGLEffectBackdropCopyRegion({
      x: 12,
      y: 34,
      width: 56,
      height: 0,
    })).toBeNull();
  });
});

describe("expandWebGLEffectRenderRegionForShaderSampling", () => {
  it("expands the WebGL effect region by the explicit shader sampling padding", () => {
    expect(expandWebGLEffectRenderRegionForShaderSampling({
      region: { x: 12, y: 34, width: 56, height: 78 },
      canvasWidth: 200,
      canvasHeight: 180,
      paddingInBackingPixels: 16,
    })).toEqual({
      x: 0,
      y: 18,
      width: 84,
      height: 110,
    });
  });

  it("clips the expanded WebGL effect region to the canvas backing store", () => {
    expect(expandWebGLEffectRenderRegionForShaderSampling({
      region: { x: 180, y: 170, width: 40, height: 20 },
      canvasWidth: 200,
      canvasHeight: 180,
      paddingInBackingPixels: 16,
    })).toEqual({
      x: 164,
      y: 154,
      width: 36,
      height: 26,
    });
  });

  it("rejects non-finite shader sampling padding", () => {
    expect(() => expandWebGLEffectRenderRegionForShaderSampling({
      region: { x: 12, y: 34, width: 56, height: 78 },
      canvasWidth: 200,
      canvasHeight: 180,
      paddingInBackingPixels: Number.NaN,
    })).toThrow("non-negative finite paddingInBackingPixels");
  });
});
