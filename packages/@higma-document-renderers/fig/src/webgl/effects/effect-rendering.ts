/** @file WebGL bridge for backend-neutral effect stacks. */

import type { AffineMatrix } from "@higma-primitives/path";
import {
  renderShapeEffectStack,
  resolveBrowserRenderedFigmaExportEffectBlendMode,
  type BackgroundBlurEffect,
  type BlendMode,
  type Color,
  type DropShadowEffect,
  type InnerShadowEffect,
  type ResolvedEffectStack,
} from "@higma-document-renderers/fig/scene-graph";
import { drawSolidFill, type GLContext } from "../fill/fill-renderer";
import { resolveConsecutiveInnerShadowBlurSourceRuns, type EffectsRendererInstance } from "./effects-renderer";
import { resolveEffectBackingScale } from "./effect-scale";
import type { WebGLEffectRenderRegion } from "./effect-render-region";
import { shouldRenderWebGLBlurFramebufferPass } from "./blur-framebuffer-pass-decision";

export type WebGLEffectRenderingParams = {
  readonly getGlContext: () => GLContext;
  readonly effectsRenderer: EffectsRendererInstance;
  readonly pixelRatio: () => number;
  readonly canvasWidth: () => number;
  readonly canvasHeight: () => number;
  readonly outputFramebuffer: () => WebGLFramebuffer | null;
  readonly backdropFramebuffer: () => WebGLFramebuffer | null;
  readonly isClipStencilRequired: () => boolean;
  readonly recordEffectPass?: (
    pass: "background-blur" | "drop-shadow" | "inner-shadow",
    elapsedMs: number,
  ) => void;
  readonly recordInnerShadowBlurSourceCount?: (count: number) => void;
};

export type VertexShapeEffectParams = {
  readonly stack: ResolvedEffectStack;
  readonly hasVisibleContent: boolean;
  readonly region: WebGLEffectRenderRegion;
  readonly vertices: Float32Array;
  readonly transform: AffineMatrix;
  readonly resolvedNodeOpacity: number;
  readonly renderContent: () => void;
  readonly renderStroke: () => void;
};

export type WebGLEffectRendering = {
  readonly renderBackgroundBlurMask: (params: {
    readonly effect: BackgroundBlurEffect;
    readonly region: WebGLEffectRenderRegion;
    readonly vertices: Float32Array;
    readonly transform: AffineMatrix;
  }) => void;
  readonly renderVertexShapeEffectStack: (params: VertexShapeEffectParams) => void;
  readonly renderDropShadows: (params: {
    readonly effects: readonly DropShadowEffect[];
    readonly region: WebGLEffectRenderRegion;
    readonly vertices: Float32Array;
    readonly transform: AffineMatrix;
    readonly resolvedNodeOpacity: number;
  }) => void;
  readonly renderDropShadowsWithSilhouette: (params: {
    readonly effects: readonly DropShadowEffect[];
    readonly region: WebGLEffectRenderRegion;
    readonly transform: AffineMatrix;
    readonly resolvedNodeOpacity: number;
    readonly renderSilhouette: () => void;
  }) => void;
  readonly renderInnerShadowsWithSilhouette: (params: {
    readonly effects: readonly InnerShadowEffect[];
    readonly region: WebGLEffectRenderRegion;
    readonly transform: AffineMatrix;
    readonly resolvedNodeOpacity: number;
    readonly renderSilhouette: () => void;
  }) => void;
  readonly renderInnerShadows: (params: {
    readonly effects: readonly InnerShadowEffect[];
    readonly region: WebGLEffectRenderRegion;
    readonly vertices: Float32Array;
    readonly transform: AffineMatrix;
    readonly resolvedNodeOpacity: number;
  }) => void;
  readonly renderBlendedShapeContent: (params: {
    readonly blendMode: BlendMode;
    readonly region: WebGLEffectRenderRegion;
    readonly renderContent: () => void;
  }) => void;
};

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };

function dropShadowStackRequiresTransparentFilterBackdrop(
  effects: readonly DropShadowEffect[],
): boolean {
  return effects.some((effect) => resolveBrowserRenderedFigmaExportEffectBlendMode(effect.blendMode) !== "normal");
}

/** Create WebGL effect operations that consume the shared effect-stack schema. */
export function createWebGLEffectRendering(params: WebGLEffectRenderingParams): WebGLEffectRendering {
  function invalidateStateAfterRawEffectRendererCall(): void {
    const ctx = params.getGlContext();
    ctx.glState.invalidate();
    ctx.vertexBuffers.invalidateArrayBufferBinding();
  }

  function renderBackgroundBlurMask(
    { effect, region, vertices, transform }: {
      readonly effect: BackgroundBlurEffect;
      readonly region: WebGLEffectRenderRegion;
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
    },
  ): void {
    if (!shouldRenderWebGLBlurFramebufferPass({
      radius: effect.radius,
      transform,
      pixelRatio: params.pixelRatio(),
    })) {
      return;
    }
    const start = performance.now();
    params.effectsRenderer.renderBackgroundBlur({
      canvasWidth: params.canvasWidth(),
      canvasHeight: params.canvasHeight(),
      region,
      effect,
      worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
      outputFramebuffer: params.outputFramebuffer(),
      backdropFramebuffer: params.backdropFramebuffer(),
      requireClipStencil: params.isClipStencilRequired(),
      renderMask: () => {
        drawSolidFill({
          ctx: params.getGlContext(),
          vertices,
          color: WHITE,
          transform,
          opacity: 1,
        });
      },
    });
    params.recordEffectPass?.("background-blur", performance.now() - start);
    invalidateStateAfterRawEffectRendererCall();
  }

  function renderDropShadows(
    { effects, region, vertices, transform, resolvedNodeOpacity }: {
      readonly effects: readonly DropShadowEffect[];
      readonly region: WebGLEffectRenderRegion;
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
      readonly resolvedNodeOpacity: number;
    },
  ): void {
    renderDropShadowsWithSilhouette({
      effects,
      region,
      transform,
      resolvedNodeOpacity,
      renderSilhouette: () => {
        drawSolidFill({ ctx: params.getGlContext(), vertices, color: WHITE, transform, opacity: 1 });
      },
    });
  }

  function renderDropShadowsWithSilhouette(
    { effects, region, transform, resolvedNodeOpacity, renderSilhouette }: {
      readonly effects: readonly DropShadowEffect[];
      readonly region: WebGLEffectRenderRegion;
      readonly transform: AffineMatrix;
      readonly resolvedNodeOpacity: number;
      readonly renderSilhouette: () => void;
    },
  ): void {
    if (dropShadowStackRequiresTransparentFilterBackdrop(effects)) {
      renderDropShadowStackInTransparentFilterBackdrop({
        effects,
        region,
        transform,
        resolvedNodeOpacity,
        renderSilhouette,
      });
      return;
    }
    const canvasWidth = params.canvasWidth();
    const canvasHeight = params.canvasHeight();
    const worldToBacking = resolveEffectBackingScale(transform, params.pixelRatio());
    const outputFramebuffer = params.outputFramebuffer();
    const backdropFramebuffer = params.backdropFramebuffer();
    const requireClipStencil = params.isClipStencilRequired();
    for (const effect of effects) {
      const start = performance.now();
      params.effectsRenderer.renderDropShadow({
        canvasWidth,
        canvasHeight,
        region,
        effect,
        resolvedNodeOpacity,
        worldToBacking,
        outputFramebuffer,
        backdropFramebuffer,
        requireClipStencil,
        renderSilhouette,
      });
      params.recordEffectPass?.("drop-shadow", performance.now() - start);
      invalidateStateAfterRawEffectRendererCall();
    }
  }

  function renderDropShadowStackInTransparentFilterBackdrop(
    { effects, region, transform, resolvedNodeOpacity, renderSilhouette }: {
      readonly effects: readonly DropShadowEffect[];
      readonly region: WebGLEffectRenderRegion;
      readonly transform: AffineMatrix;
      readonly resolvedNodeOpacity: number;
      readonly renderSilhouette: () => void;
    },
  ): void {
    const canvasWidth = params.canvasWidth();
    const canvasHeight = params.canvasHeight();
    const outputFramebuffer = params.outputFramebuffer();
    const requireClipStencil = params.isClipStencilRequired();
    const worldToBacking = resolveEffectBackingScale(transform, params.pixelRatio());
    const capture = params.effectsRenderer.beginLayerCapture({ canvasWidth, canvasHeight, region });
    invalidateStateAfterRawEffectRendererCall();
    try {
      for (const effect of effects) {
        const start = performance.now();
        params.effectsRenderer.renderDropShadow({
          canvasWidth,
          canvasHeight,
          region,
          effect,
          resolvedNodeOpacity,
          worldToBacking,
          outputFramebuffer: capture.framebuffer.fbo,
          backdropFramebuffer: capture.framebuffer.fbo,
          requireClipStencil: false,
          renderSilhouette,
        });
        params.recordEffectPass?.("drop-shadow", performance.now() - start);
        invalidateStateAfterRawEffectRendererCall();
      }
      params.effectsRenderer.blitLayerWithOpacity({
        canvasWidth,
        canvasHeight,
        region,
        sourceFramebuffer: capture.framebuffer,
        opacity: 1,
        outputFramebuffer,
        requireClipStencil,
      });
      invalidateStateAfterRawEffectRendererCall();
    } finally {
      params.effectsRenderer.releaseLayerCapture(capture);
    }
  }

  function renderInnerShadows(
    { effects, region, vertices, transform, resolvedNodeOpacity }: {
      readonly effects: readonly InnerShadowEffect[];
      readonly region: WebGLEffectRenderRegion;
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
      readonly resolvedNodeOpacity: number;
    },
  ): void {
    renderInnerShadowsWithSilhouette({
      effects,
      region,
      transform,
      resolvedNodeOpacity,
      renderSilhouette: () => {
        drawSolidFill({ ctx: params.getGlContext(), vertices, color: WHITE, transform, opacity: 1 });
      },
    });
  }

  function renderInnerShadowsWithSilhouette(
    { effects, region, transform, resolvedNodeOpacity, renderSilhouette }: {
      readonly effects: readonly InnerShadowEffect[];
      readonly region: WebGLEffectRenderRegion;
      readonly transform: AffineMatrix;
      readonly resolvedNodeOpacity: number;
      readonly renderSilhouette: () => void;
    },
  ): void {
    if (effects.length === 0) {
      return;
    }
    params.recordInnerShadowBlurSourceCount?.(resolveConsecutiveInnerShadowBlurSourceRuns(effects).length);
    const start = performance.now();
    params.effectsRenderer.renderInnerShadows({
      canvasWidth: params.canvasWidth(),
      canvasHeight: params.canvasHeight(),
      region,
      effects,
      resolvedNodeOpacity,
      worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
      outputFramebuffer: params.outputFramebuffer(),
      backdropFramebuffer: params.backdropFramebuffer(),
      requireClipStencil: params.isClipStencilRequired(),
      renderSilhouette,
    });
    const elapsedPerEffect = (performance.now() - start) / effects.length;
    effects.forEach(() => {
      params.recordEffectPass?.("inner-shadow", elapsedPerEffect);
    });
    invalidateStateAfterRawEffectRendererCall();
  }

  function renderBlendedShapeContent(
    { blendMode, region, renderContent }: {
      readonly blendMode: BlendMode;
      readonly region: WebGLEffectRenderRegion;
      readonly renderContent: () => void;
    },
  ): void {
    params.effectsRenderer.renderBlendedSolidShape({
      canvasWidth: params.canvasWidth(),
      canvasHeight: params.canvasHeight(),
      region,
      color: WHITE,
      opacity: 1,
      blendMode,
      outputFramebuffer: params.outputFramebuffer(),
      backdropFramebuffer: params.backdropFramebuffer(),
      requireClipStencil: params.isClipStencilRequired(),
      renderShape: () => {
        invalidateStateAfterRawEffectRendererCall();
        renderContent();
      },
    });
    invalidateStateAfterRawEffectRendererCall();
  }

  function renderVertexShapeEffectStack(
    {
      stack,
      hasVisibleContent,
      region,
      vertices,
      transform,
      resolvedNodeOpacity,
      renderContent,
      renderStroke,
    }: VertexShapeEffectParams,
  ): void {
    renderShapeEffectStack({
      stack,
      hasVisibleContent,
      renderBackgroundBlur: (effect) => {
        renderBackgroundBlurMask({ effect, region, vertices, transform });
      },
      renderDropShadows: (dropShadowEffects) => {
        renderDropShadows({ effects: dropShadowEffects, region, vertices, transform, resolvedNodeOpacity });
      },
      renderContent,
      renderInnerShadows: (innerShadowEffects) => {
        renderInnerShadows({ effects: innerShadowEffects, region, vertices, transform, resolvedNodeOpacity });
      },
      renderStroke,
    });
  }

  return {
    renderBackgroundBlurMask,
    renderVertexShapeEffectStack,
    renderDropShadows,
    renderDropShadowsWithSilhouette,
    renderInnerShadowsWithSilhouette,
    renderInnerShadows,
    renderBlendedShapeContent,
  };
}
