/** @file WebGL node effect render-plan tests. */

import type { Effect } from "@higma-document-renderers/fig/scene-graph";
import { resolveWebGLNodeEffectRenderPlan } from "./node-effect-render-plan";

const DROP_SHADOW: Effect = {
  type: "drop-shadow",
  color: { r: 0, g: 0, b: 0, a: 0.2 },
  offset: { x: 0, y: 4 },
  radius: 12,
  spread: 0,
  showShadowBehindNode: true,
};

const BACKGROUND_BLUR: Effect = {
  type: "background-blur",
  radius: 20,
};

const LAYER_BLUR: Effect = {
  type: "layer-blur",
  radius: 8,
};

describe("resolveWebGLNodeEffectRenderPlan", () => {
  it("caches the derived WebGL render plan by source effects array reference", () => {
    const effects = [DROP_SHADOW, BACKGROUND_BLUR];
    const first = resolveWebGLNodeEffectRenderPlan(effects);
    const second = resolveWebGLNodeEffectRenderPlan(effects);

    expect(second).toBe(first);
  });

  it("uses source effects directly when a node has no layer blur", () => {
    const effects = [DROP_SHADOW, BACKGROUND_BLUR];
    const plan = resolveWebGLNodeEffectRenderPlan(effects);

    expect(plan.stack.allEffects).toBe(effects);
    expect(plan.layerBlurEffect).toBeNull();
    expect(plan.backgroundBlurMaskEffect).toBe(BACKGROUND_BLUR);
    expect(plan.frameSurfaceFilterStack.allEffects).toEqual([DROP_SHADOW]);
    expect(plan.frameSurfaceFilterStack.foregroundDropShadows).toEqual([DROP_SHADOW]);
    expect(plan.layerBlurCapturedContentStack).toBe(plan.stack);
    expect(plan.layerBlurCapturedFrameSurfaceFilterStack.allEffects).toEqual([DROP_SHADOW]);
  });

  it("uses the shared layer-blur captured-content effect stack", () => {
    const effects = [BACKGROUND_BLUR, DROP_SHADOW, LAYER_BLUR];
    const plan = resolveWebGLNodeEffectRenderPlan(effects);

    expect(plan.layerBlurEffect).toBe(LAYER_BLUR);
    expect(plan.backgroundBlurMaskEffect).toBe(BACKGROUND_BLUR);
    expect(plan.layerBlurCapturedContentStack.allEffects).toEqual([DROP_SHADOW]);
    expect(plan.layerBlurCapturedContentStack.backgroundBlur).toBeNull();
    expect(plan.layerBlurCapturedContentStack.layerBlur).toBeNull();
    expect(plan.layerBlurCapturedFrameSurfaceFilterStack.allEffects).toEqual([DROP_SHADOW]);
    expect(plan.layerBlurCapturedFrameSurfaceFilterStack.foregroundDropShadows).toEqual([DROP_SHADOW]);
  });
});
