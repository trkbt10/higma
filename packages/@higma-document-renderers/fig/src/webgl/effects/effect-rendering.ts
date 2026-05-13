/** @file WebGL bridge for backend-neutral effect stacks. */

import type { AffineMatrix } from "@higma-primitives/path";
import type {
  BackgroundBlurEffect,
  Color,
  Effect,
  Fill,
} from "@higma-document-models/fig/scene-graph";
import { createTranslationMatrix, multiplyMatrices } from "@higma-document-models/fig/matrix";
import { buildEffectStack, renderShapeEffectStack } from "../../scene-graph/render/effect-stack";
import { drawSolidFill, type GLContext } from "../fill/fill-renderer";
import type { EffectsRendererInstance } from "./effects-renderer";
import type { Bounds } from "../tessellation/stencil-fill";
import { resolveEffectBackingScale } from "./effect-scale";

type DrawStencilFillParams = {
  readonly fanVertices: Float32Array;
  readonly coverQuad: Float32Array;
  readonly transform: AffineMatrix;
  readonly opacity: number;
  readonly elementSize: { readonly width: number; readonly height: number };
  readonly fills: readonly Fill[];
};

export type WebGLEffectRenderingParams = {
  readonly getGlContext: () => GLContext;
  readonly effectsRenderer: EffectsRendererInstance;
  readonly pixelRatio: () => number;
  readonly canvasWidth: () => number;
  readonly canvasHeight: () => number;
  readonly isClipStencilRequired: () => boolean;
  readonly drawStencilFill: (params: DrawStencilFillParams) => void;
};

export type VertexShapeEffectParams = {
  readonly effects: readonly Effect[];
  readonly hasVisibleContent: boolean;
  readonly vertices: Float32Array;
  readonly transform: AffineMatrix;
  readonly opacity: number;
  readonly renderContent: () => void;
  readonly renderStroke: () => void;
};

export type WebGLEffectRendering = {
  readonly renderBackgroundBlurMask: (params: {
    readonly effect: BackgroundBlurEffect;
    readonly vertices: Float32Array;
    readonly transform: AffineMatrix;
  }) => void;
  readonly renderVertexShapeEffectStack: (params: VertexShapeEffectParams) => void;
  readonly renderDropShadows: (params: {
    readonly effects: readonly Effect[];
    readonly vertices: Float32Array;
    readonly transform: AffineMatrix;
    readonly opacity: number;
  }) => void;
  readonly renderInnerShadows: (params: {
    readonly effects: readonly Effect[];
    readonly vertices: Float32Array;
    readonly transform: AffineMatrix;
  }) => void;
  readonly renderDropShadowsStencil: (params: {
    readonly effects: readonly Effect[];
    readonly fanVertices: Float32Array;
    readonly coverQuad: Float32Array;
    readonly bounds: Bounds;
    /**
     * TrueType-winding earcut silhouette of the path. Pre-tessellated
     * by the caller (the geometry cache) so the drop-shadow pipeline
     * never re-flattens curves per shadow effect, per frame.
     */
    readonly silhouetteVertices: Float32Array;
    readonly transform: AffineMatrix;
    readonly opacity: number;
  }) => void;
};

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };

/** Create WebGL effect operations that consume the shared effect-stack schema. */
export function createWebGLEffectRendering(params: WebGLEffectRenderingParams): WebGLEffectRendering {
  function renderBackgroundBlurMask(
    { effect, vertices, transform }: {
      readonly effect: BackgroundBlurEffect;
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
    },
  ): void {
    params.effectsRenderer.renderBackgroundBlur({
      canvasWidth: params.canvasWidth(),
      canvasHeight: params.canvasHeight(),
      effect,
      worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
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
    { effects, vertices, transform, opacity }: {
      readonly effects: readonly Effect[];
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
      readonly opacity: number;
    },
  ): void {
    for (const effect of effects) {
      if (effect.type !== "drop-shadow") { continue; }

      if (effect.radius <= 0) {
        // `effect.offset` is in node-local (world) space; compose through
        // `multiplyMatrices` so the viewport scale baked into `transform`
        // applies — adding offset to m02/m12 directly would leave the
        // shadow at unscaled distance at viewport scale != 1.
        const offsetTransform = multiplyMatrices(transform, createTranslationMatrix(effect.offset.x, effect.offset.y));
        drawSolidFill({ ctx: params.getGlContext(), vertices, color: effect.color, transform: offsetTransform, opacity: opacity * effect.color.a });
        continue;
      }

      params.effectsRenderer.renderDropShadow({
        canvasWidth: params.canvasWidth(),
        canvasHeight: params.canvasHeight(),
        effect,
        worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
        renderSilhouette: () => {
          drawSolidFill({ ctx: params.getGlContext(), vertices, color: WHITE, transform, opacity: 1 });
        },
      });
      params.getGlContext().glState.invalidate();
    }
  }

  function renderInnerShadows(
    { effects, vertices, transform }: {
      readonly effects: readonly Effect[];
      readonly vertices: Float32Array;
      readonly transform: AffineMatrix;
    },
  ): void {
    for (const effect of effects) {
      if (effect.type !== "inner-shadow") { continue; }

      params.effectsRenderer.renderInnerShadow({
        canvasWidth: params.canvasWidth(),
        canvasHeight: params.canvasHeight(),
        effect,
        worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
        renderSilhouette: () => {
          drawSolidFill({ ctx: params.getGlContext(), vertices, color: WHITE, transform, opacity: 1 });
        },
      });
      params.getGlContext().glState.invalidate();
    }
  }

  function renderDropShadowsStencil(
    { effects, fanVertices, coverQuad, bounds, silhouetteVertices, transform, opacity }: {
      readonly effects: readonly Effect[];
      readonly fanVertices: Float32Array;
      readonly coverQuad: Float32Array;
      readonly bounds: Bounds;
      readonly silhouetteVertices: Float32Array;
      readonly transform: AffineMatrix;
      readonly opacity: number;
    },
  ): void {
    const elementSize = { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };

    for (const effect of effects) {
      if (effect.type !== "drop-shadow") { continue; }

      // Same world-space offset composition as the non-stencil drop
      // shadow above — see comment there.
      const offsetTransform = multiplyMatrices(transform, createTranslationMatrix(effect.offset.x, effect.offset.y));

      if (effect.radius <= 0) {
        params.drawStencilFill({
          fanVertices,
          coverQuad,
          transform: offsetTransform,
          opacity: opacity * effect.color.a,
          elementSize,
          fills: [{ type: "solid", color: effect.color, opacity: 1 }],
        });
        continue;
      }

      if (silhouetteVertices.length === 0) { continue; }
      params.effectsRenderer.renderDropShadow({
        canvasWidth: params.canvasWidth(),
        canvasHeight: params.canvasHeight(),
        effect,
        worldToBacking: resolveEffectBackingScale(transform, params.pixelRatio()),
        renderSilhouette: () => {
          drawSolidFill({ ctx: params.getGlContext(), vertices: silhouetteVertices, color: WHITE, transform, opacity: 1 });
        },
      });
      params.getGlContext().glState.invalidate();
    }
  }

  function renderVertexShapeEffectStack(
    { effects, hasVisibleContent, vertices, transform, opacity, renderContent, renderStroke }: VertexShapeEffectParams,
  ): void {
    renderShapeEffectStack({
      stack: buildEffectStack(effects),
      hasVisibleContent,
      renderBackgroundBlur: (effect) => {
        renderBackgroundBlurMask({ effect, vertices, transform });
      },
      renderDropShadows: (sourceEffects) => {
        renderDropShadows({ effects: sourceEffects, vertices, transform, opacity });
      },
      renderContent,
      renderInnerShadows: (sourceEffects) => {
        renderInnerShadows({ effects: sourceEffects, vertices, transform });
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
