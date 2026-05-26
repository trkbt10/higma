/** @file WebGL blur framebuffer pass decision tests. */

import type { AffineMatrix } from "@higma-primitives/path";
import { shouldRenderWebGLBlurFramebufferPass } from "./blur-framebuffer-pass-decision";

const IDENTITY: AffineMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function scaleMatrix(scale: number): AffineMatrix {
  return { m00: scale, m01: 0, m02: 0, m10: 0, m11: scale, m12: 0 };
}

describe("shouldRenderWebGLBlurFramebufferPass", () => {
  it("returns false when the blur radius cannot alter adjacent backing-buffer samples", () => {
    expect(shouldRenderWebGLBlurFramebufferPass({
      radius: 0.1,
      transform: IDENTITY,
      pixelRatio: 1,
    })).toBe(false);
  });

  it("returns true when transform and pixel ratio make the blur visible in backing-buffer pixels", () => {
    expect(shouldRenderWebGLBlurFramebufferPass({
      radius: 0.1,
      transform: scaleMatrix(3),
      pixelRatio: 2,
    })).toBe(true);
  });

  it("throws when pixel ratio is not finite because the backing-buffer scale is undefined", () => {
    expect(() => shouldRenderWebGLBlurFramebufferPass({
      radius: 1,
      transform: IDENTITY,
      pixelRatio: Number.NaN,
    })).toThrow("Effect backing scale pixelRatio must be finite and positive");
  });
});
