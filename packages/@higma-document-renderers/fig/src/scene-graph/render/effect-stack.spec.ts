/** @file Shared effect stack tests */

import type { Effect } from "@higma-document-renderers/fig/scene-graph";
import { buildEffectStack, buildLayerBlurCapturedContentEffectStack, findLayerBlurEffect, renderShapeEffectStack } from "./effect-stack";

const DROP_SHADOW: Effect = {
  type: "drop-shadow",
  offset: { x: 0, y: 2 },
  radius: 4,
  color: { r: 0, g: 0, b: 0, a: 0.25 },
  showShadowBehindNode: true,
};

const INNER_SHADOW: Effect = {
  type: "inner-shadow",
  offset: { x: 0, y: 1 },
  radius: 2,
  color: { r: 0, g: 0, b: 0, a: 0.2 },
};

describe("findLayerBlurEffect", () => {
  it("returns the visible layer blur effect", () => {
    expect(findLayerBlurEffect([{ type: "layer-blur", radius: 3 }])).toEqual({
      type: "layer-blur",
      radius: 3,
    });
  });

  it("ignores zero-radius layer blur", () => {
    expect(findLayerBlurEffect([{ type: "layer-blur", radius: 0 }])).toBeNull();
  });
});

describe("renderShapeEffectStack", () => {
  it("uses one canonical shape effect order", () => {
    const calls: string[] = [];
    const stack = buildEffectStack([{ type: "background-blur", radius: 8 }, DROP_SHADOW, INNER_SHADOW]);

    renderShapeEffectStack({
      stack,
      hasVisibleContent: true,
      renderBackgroundBlur: () => calls.push("background-blur"),
      renderDropShadows: () => calls.push("drop-shadows"),
      renderContent: () => calls.push("content"),
      renderInnerShadows: () => calls.push("inner-shadows"),
      renderStroke: () => calls.push("stroke"),
    });

    expect(calls).toEqual([
      "background-blur",
      "drop-shadows",
      "content",
      "inner-shadows",
      "stroke",
    ]);
  });

  it("does not render shadow effects when the source has no visible content", () => {
    const calls: string[] = [];

    renderShapeEffectStack({
      stack: buildEffectStack([DROP_SHADOW, INNER_SHADOW]),
      hasVisibleContent: false,
      renderDropShadows: () => calls.push("drop-shadows"),
      renderContent: () => calls.push("content"),
      renderInnerShadows: () => calls.push("inner-shadows"),
      renderStroke: () => calls.push("stroke"),
    });

    expect(calls).toEqual(["content", "stroke"]);
  });
});

describe("buildEffectStack", () => {
  it("separates backdrop effects from foreground filter effects", () => {
    const backgroundBlur: Effect = { type: "background-blur", radius: 12 };
    const stack = buildEffectStack([backgroundBlur, DROP_SHADOW]);

    expect(stack.backgroundBlur).toBe(backgroundBlur);
    expect(stack.foregroundEffects).toEqual([DROP_SHADOW]);
    expect(stack.foregroundDropShadows).toEqual([DROP_SHADOW]);
    expect(stack.foregroundInnerShadows).toEqual([]);
    expect(stack.allEffects).toEqual([backgroundBlur, DROP_SHADOW]);
  });

  it("returns the shared empty-stack sentinel for nodes without effects, so per-frame renders allocate nothing", () => {
    // Two unrelated empty-effects arrays still resolve to the same
    // sentinel because the result is intrinsically empty — there's no
    // observable difference between distinct empty inputs.
    const a = buildEffectStack([]);
    const b = buildEffectStack([]);
    expect(a).toBe(b);
    expect(a.allEffects.length).toBe(0);
    expect(a.foregroundEffects.length).toBe(0);
    expect(a.foregroundDropShadows.length).toBe(0);
    expect(a.foregroundInnerShadows.length).toBe(0);
    expect(a.backgroundBlur).toBeNull();
    expect(a.layerBlur).toBeNull();
  });

  it("memoises results by input-array identity (pan/zoom hands the same array back every frame)", () => {
    const effects: readonly Effect[] = [DROP_SHADOW];
    const first = buildEffectStack(effects);
    const second = buildEffectStack(effects);
    expect(second).toBe(first);
    // Same input array but a fresh wrapper — must build a new stack.
    const distinctEffects: readonly Effect[] = [DROP_SHADOW];
    expect(buildEffectStack(distinctEffects)).not.toBe(first);
  });

  it("aliases foregroundEffects to allEffects when no background-blur exists, avoiding a redundant filter allocation", () => {
    const stack = buildEffectStack([DROP_SHADOW, INNER_SHADOW]);
    expect(stack.foregroundEffects).toBe(stack.allEffects);
    expect(stack.foregroundDropShadows).toEqual([DROP_SHADOW]);
    expect(stack.foregroundInnerShadows).toEqual([INNER_SHADOW]);
  });

  it("builds the canonical layer-blur captured-content stack from the same source effects", () => {
    const backgroundBlur: Effect = { type: "background-blur", radius: 12 };
    const layerBlur: Effect = { type: "layer-blur", radius: 8 };
    const effects: readonly Effect[] = [backgroundBlur, DROP_SHADOW, layerBlur, INNER_SHADOW];
    const captured = buildLayerBlurCapturedContentEffectStack(effects);

    expect(captured.allEffects).toEqual([DROP_SHADOW, INNER_SHADOW]);
    expect(captured.foregroundDropShadows).toEqual([DROP_SHADOW]);
    expect(captured.foregroundInnerShadows).toEqual([INNER_SHADOW]);
    expect(captured.backgroundBlur).toBeNull();
    expect(captured.layerBlur).toBeNull();
  });

  it("uses the original effect stack when there is no active layer blur pass", () => {
    const effects: readonly Effect[] = [DROP_SHADOW, INNER_SHADOW];
    const stack = buildEffectStack(effects);
    const captured = buildLayerBlurCapturedContentEffectStack(effects, stack);

    expect(captured).toBe(stack);
  });
});

describe("renderShapeEffectStack — empty-effects short-circuit", () => {
  it("skips both shadow callbacks for nodes with no effects, even when content is visible", () => {
    const calls: string[] = [];

    renderShapeEffectStack({
      stack: buildEffectStack([]),
      hasVisibleContent: true,
      renderDropShadows: () => calls.push("drop-shadows"),
      renderContent: () => calls.push("content"),
      renderInnerShadows: () => calls.push("inner-shadows"),
      renderStroke: () => calls.push("stroke"),
    });

    expect(calls).toEqual(["content", "stroke"]);
  });
});
