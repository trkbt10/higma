/** @file Shared effect stack schema */

import type {
  BackgroundBlurEffect,
  Effect,
  LayerBlurEffect,
} from "@higma-document-models/fig/scene-graph";

export type ShapeEffectStackParams = {
  readonly stack: ResolvedEffectStack;
  readonly hasVisibleContent: boolean;
  readonly renderBackgroundBlur?: (effect: BackgroundBlurEffect) => void;
  readonly renderDropShadows: (effects: readonly Effect[]) => void;
  readonly renderContent: () => void;
  readonly renderInnerShadows: (effects: readonly Effect[]) => void;
  readonly renderStroke: () => void;
};

export type ResolvedEffectStack = {
  readonly allEffects: readonly Effect[];
  readonly foregroundEffects: readonly Effect[];
  readonly backgroundBlur: BackgroundBlurEffect | null;
  readonly layerBlur: LayerBlurEffect | null;
};

/** Return the first active layer blur effect in declaration order. */
export function findLayerBlurEffect(effects: readonly Effect[]): LayerBlurEffect | null {
  for (const effect of effects) {
    if (effect.type === "layer-blur" && effect.radius > 0) {
      return effect;
    }
  }
  return null;
}

/** Return the first active background blur effect in declaration order. */
export function findBackgroundBlurEffect(effects: readonly Effect[]): BackgroundBlurEffect | null {
  for (const effect of effects) {
    if (effect.type === "background-blur" && effect.radius > 0) {
      return effect;
    }
  }
  return null;
}

/**
 * Sentinel returned for nodes without effects. Most scene nodes carry
 * an empty `effects` array, so the dispatcher (and its consumers) hit
 * this every render — sharing one frozen object avoids the per-render
 * `.filter` + object literal allocation that used to dominate
 * `buildEffectStack` profiles during pan/zoom.
 */
const EMPTY_EFFECTS: readonly Effect[] = Object.freeze([]);
const EMPTY_EFFECT_STACK: ResolvedEffectStack = Object.freeze({
  allEffects: EMPTY_EFFECTS,
  foregroundEffects: EMPTY_EFFECTS,
  backgroundBlur: null,
  layerBlur: null,
});

/**
 * Per-frame pan/zoom rerenders hand the same `node.source.effects`
 * array back into `buildEffectStack` for every visible node. The
 * resolved stack is a pure function of that array, so we memoise on
 * its identity. WeakMap entries release when the underlying scene
 * node is garbage-collected.
 */
const effectStackCache = new WeakMap<readonly Effect[], ResolvedEffectStack>();

/** Build the backend-neutral effect stack consumed by SVG, React, and WebGL renderers. */
export function buildEffectStack(effects: readonly Effect[]): ResolvedEffectStack {
  if (effects.length === 0) {
    return EMPTY_EFFECT_STACK;
  }
  const cached = effectStackCache.get(effects);
  if (cached) {
    return cached;
  }
  const backgroundBlur = findBackgroundBlurEffect(effects);
  const stack: ResolvedEffectStack = {
    allEffects: effects,
    foregroundEffects: resolveForegroundEffects(effects, backgroundBlur),
    backgroundBlur,
    layerBlur: findLayerBlurEffect(effects),
  };
  effectStackCache.set(effects, stack);
  return stack;
}

/**
 * Reuse the input array when there are no background-blur effects to
 * strip out — saves a per-frame allocation for the very common
 * "drop shadow only" case during pan/zoom.
 */
function resolveForegroundEffects(
  effects: readonly Effect[],
  backgroundBlur: BackgroundBlurEffect | null,
): readonly Effect[] {
  if (backgroundBlur === null) {
    return effects;
  }
  return effects.filter((effect) => effect.type !== "background-blur");
}

/** Dispatch a shape's effect phases in the canonical Figma rendering order. */
export function renderShapeEffectStack(params: ShapeEffectStackParams): void {
  const stack = params.stack;
  if (stack.backgroundBlur && params.renderBackgroundBlur) {
    params.renderBackgroundBlur(stack.backgroundBlur);
  }

  // For nodes with no effects (the common case during pan/zoom),
  // skip the shadow callbacks entirely — invoking them just so the
  // body can iterate an empty array is a per-node closure call we
  // can elide.
  const hasForegroundEffects = stack.foregroundEffects.length > 0;
  if (hasForegroundEffects && params.hasVisibleContent) {
    params.renderDropShadows(stack.foregroundEffects);
  }

  params.renderContent();

  if (hasForegroundEffects && params.hasVisibleContent) {
    params.renderInnerShadows(stack.foregroundEffects);
  }

  params.renderStroke();
}
