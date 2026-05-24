/** @file Spec for WebGL effect backing-buffer region derivation. */

import { resolveWebGLEffectBackdropCopyRegion } from "./effect-render-region";

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
