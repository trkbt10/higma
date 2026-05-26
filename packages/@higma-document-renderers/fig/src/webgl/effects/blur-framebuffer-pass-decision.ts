/** @file Runtime WebGL decision for whether a blur framebuffer pass can change backing-buffer pixels. */

import { resolveFigmaBlurStdDeviation } from "@higma-document-renderers/fig/scene-graph";
import type { AffineMatrix } from "@higma-primitives/path";
import { resolveEffectBackingScale } from "./effect-scale";
import { shouldRunWebGLGaussianBlurForSigma } from "./effects-renderer";

export type WebGLBlurFramebufferPassDecisionInput = {
  readonly radius: number;
  readonly transform: AffineMatrix;
  readonly pixelRatio: number;
};

/** Return whether a Figma blur radius can affect the current WebGL backing-buffer output. */
export function shouldRenderWebGLBlurFramebufferPass({
  radius,
  transform,
  pixelRatio,
}: WebGLBlurFramebufferPassDecisionInput): boolean {
  const worldToBacking = resolveEffectBackingScale(transform, pixelRatio);
  const sigmaInBackingPixels = resolveFigmaBlurStdDeviation(radius * worldToBacking.lengthScale);
  return shouldRunWebGLGaussianBlurForSigma(sigmaInBackingPixels);
}
