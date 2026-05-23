/** @file WebGL bridge for backend-neutral effect stacks. */

import type { AffineMatrix } from "@higma-primitives/path";
import {
  buildEffectStack,
  renderShapeEffectStack,
  type BackgroundBlurEffect,
  type Color,
  type Effect,
} from "@higma-document-renderers/fig/scene-graph";
import { drawSolidFill, type GLContext } from "../fill/fill-renderer";
import type { EffectsRendererInstance } from "./effects-renderer";
import { resolveEffectBackingScale } from "./effect-scale";
import type { WebGLEffectRenderRegion } from "./effect-render-region";

export type WebGLEffectRenderingParams = {
  readonly getGlContext: () => GLContext;
  readonly effectsRenderer: EffectsRendererInstance;
  readonly pixelRatio: () => number;
  readonly canvasWidth: () => number;
  readonly canvasHeight: () => number;
  readonly outputFramebuffer: () => WebGLFramebuffer | null;
  readonly backdropFramebuffer: () => WebGLFramebuffer | null;
  readonly isClipStencilRequired: () => boolean;
};

export type VertexShapeEffectParams = {
  readonly effects: readonly Effect[];
  readonly hasVisibleContent: boolean;
  readonly region: WebGLEffectRenderRegion;
  readonly vertices: Float32Array;
  readonly transform: AffineMatrix;
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
    readonly effects: readonly Effect[];
    readonly region: WebGLEffectRenderRegion;
    readonly vertices: Float32Array;
    readonly transform: AffineMatrix;
  }) => void;
  readonly renderInnerShadows: (params: {
    readonly effects: readonly Effect[];
    readonly region: WebGLEffectRenderRegion;
    readonly vertices: Float32Array;
    readonly transform: AffineMatrix;
  }) => void;
  readonly renderDropShadowsStencil: (params: {
    readonly effects: readonly Effect[];
    readonly region: WebGLEffectRenderRegion;
    /**
     * TrueType-winding earcut silhouette of the path. Pre-tessellated
     * by the caller (the geometry cache) so the drop-shadow pipeline
     * never re-flattens curves per shadow effect, per frame.
     */
    readonly silhouetteVertices: Float32Array;
    readonly transform: AffineMatrix;
  }) => void;
};

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };

/** Create WebGL effect operations that consume the shared effect-stack schema. */
export function createWebGLEffectRendering(params: WebGLEffectRenderingParams): WebGLEffectRendering {
  function renderBackgroundBlurMask(
    { effect, region, vertices, transform }: {
      readonly effect: BackgroundBlurEffect;
      readonly region: WebGLEffectRenderRegion;
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
    },
  ): void {
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
    // Effects renderer mutated stencil/blend state through raw GL.
    // Drop our cached values so the next set-via-cache actually writes.
    params.getGlContext().glState.invalidate();
  }

  function renderDropShadows(
    { effects, region, vertices, transform }: {
      readonly effects: readonly Effect[];
      readonly region: WebGLEffectRenderRegion;
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
    },
  ): void {
    for (const effect of effects) {
      if (effect.type !== "drop-shadow") { continue; }

      params.effectsRenderer.renderDropShadow({
        canvasWidth: params.canvasWidth(),
        canvasHeight: params.canvasHeight(),
        region,
        effect,
        worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
        outputFramebuffer: params.outputFramebuffer(),
        backdropFramebuffer: params.backdropFramebuffer(),
        renderSilhouette: () => {
          drawSolidFill({ ctx: params.getGlContext(), vertices, color: WHITE, transform, opacity: 1 });
        },
      });
      params.getGlContext().glState.invalidate();
    }
  }

  function renderInnerShadows(
    { effects, region, vertices, transform }: {
      readonly effects: readonly Effect[];
      readonly region: WebGLEffectRenderRegion;
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
    },
  ): void {
    for (const effect of effects) {
      if (effect.type !== "inner-shadow") { continue; }

      params.effectsRenderer.renderInnerShadow({
        canvasWidth: params.canvasWidth(),
        canvasHeight: params.canvasHeight(),
        region,
        effect,
        worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
        outputFramebuffer: params.outputFramebuffer(),
        backdropFramebuffer: params.backdropFramebuffer(),
        renderSilhouette: () => {
          drawSolidFill({ ctx: params.getGlContext(), vertices, color: WHITE, transform, opacity: 1 });
        },
      });
      params.getGlContext().glState.invalidate();
    }
  }

  function renderDropShadowsStencil(
    { effects, region, silhouetteVertices, transform }: {
      readonly effects: readonly Effect[];
      readonly region: WebGLEffectRenderRegion;
      readonly silhouetteVertices: Float32Array;
      readonly transform: AffineMatrix;
    },
  ): void {
    for (const effect of effects) {
      if (effect.type !== "drop-shadow") { continue; }

      if (silhouetteVertices.length === 0) { continue; }
      params.effectsRenderer.renderDropShadow({
        canvasWidth: params.canvasWidth(),
        canvasHeight: params.canvasHeight(),
        region,
        effect,
        worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
        outputFramebuffer: params.outputFramebuffer(),
        backdropFramebuffer: params.backdropFramebuffer(),
        renderSilhouette: () => {
          drawSolidFill({ ctx: params.getGlContext(), vertices: silhouetteVertices, color: WHITE, transform, opacity: 1 });
        },
      });
      params.getGlContext().glState.invalidate();
    }
  }

  function renderVertexShapeEffectStack(
    { effects, hasVisibleContent, region, vertices, transform, renderContent, renderStroke }: VertexShapeEffectParams,
  ): void {
    renderShapeEffectStack({
      stack: buildEffectStack(effects),
      hasVisibleContent,
      renderBackgroundBlur: (effect) => {
        renderBackgroundBlurMask({ effect, region, vertices, transform });
      },
      renderDropShadows: (sourceEffects) => {
        renderDropShadows({ effects: sourceEffects, region, vertices, transform });
      },
      renderContent,
      renderInnerShadows: (sourceEffects) => {
        renderInnerShadows({ effects: sourceEffects, region, vertices, transform });
      },
      renderStroke,
    });
  }

  return {
    renderBackgroundBlurMask,
    renderVertexShapeEffectStack,
    renderDropShadows,
    renderInnerShadows,
    renderDropShadowsStencil,
  };
}
