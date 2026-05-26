/** @file WebGL node effect render plan derived from SceneGraph source effects. */

import type {
  BackgroundBlurEffect,
  Effect,
  LayerBlurEffect,
  ResolvedEffectStack,
} from "@higma-document-renderers/fig/scene-graph";
import {
  buildEffectStack,
  buildLayerBlurCapturedContentEffectStack,
  resolveFrameSurfaceFilterEffects,
} from "../../scene-graph";

export type WebGLNodeEffectRenderPlan = {
  readonly stack: ResolvedEffectStack;
  readonly layerBlurEffect: LayerBlurEffect | null;
  readonly backgroundBlurMaskEffect: BackgroundBlurEffect | null;
  readonly frameSurfaceFilterStack: ResolvedEffectStack;
  readonly layerBlurCapturedContentStack: ResolvedEffectStack;
  readonly layerBlurCapturedFrameSurfaceFilterStack: ResolvedEffectStack;
};

const effectRenderPlanCache = new WeakMap<readonly Effect[], WebGLNodeEffectRenderPlan>();

/** Resolve every WebGL effect-rendering decision for one RenderNode from its SceneGraph source effects. */
export function resolveWebGLNodeEffectRenderPlan(effects: readonly Effect[]): WebGLNodeEffectRenderPlan {
  const cached = effectRenderPlanCache.get(effects);
  if (cached !== undefined) {
    return cached;
  }
  const stack = buildEffectStack(effects);
  const layerBlurCapturedContentStack = buildLayerBlurCapturedContentEffectStack(effects, stack);
  const frameSurfaceFilterStack = buildEffectStack(resolveFrameSurfaceFilterEffects(stack));
  const layerBlurCapturedFrameSurfaceFilterStack = buildEffectStack(
    resolveFrameSurfaceFilterEffects(layerBlurCapturedContentStack),
  );
  const plan: WebGLNodeEffectRenderPlan = {
    stack,
    layerBlurEffect: stack.layerBlur,
    backgroundBlurMaskEffect: stack.backgroundBlur,
    frameSurfaceFilterStack,
    layerBlurCapturedContentStack,
    layerBlurCapturedFrameSurfaceFilterStack,
  };
  effectRenderPlanCache.set(effects, plan);
  return plan;
}
