/** @file WebGL effect rendering must consume the shared effect-stack compositing contract. */

import { createWebGLEffectRendering } from "./effect-rendering";
import type { WebGLEffectRenderRegion } from "./effect-render-region";
import type {
  EffectsRendererInstance,
  WebGLEffectLayerCapture,
} from "./effects-renderer";
import type { GLContext } from "../fill/fill-renderer";
import type { Framebuffer } from "../resources/framebuffer";
import type { DropShadowEffect } from "@higma-document-renderers/fig/scene-graph";
import type { AffineMatrix } from "@higma-primitives/path";

const IDENTITY: AffineMatrix = Object.freeze({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 });
const REGION: WebGLEffectRenderRegion = Object.freeze({ x: 0, y: 0, width: 64, height: 64 });
const SILHOUETTE = new Float32Array([0, 0, 1, 0, 0, 1]);

type EffectRendererCall =
  | {
      readonly type: "beginLayerCapture";
      readonly canvasWidth: number;
      readonly canvasHeight: number;
      readonly region: WebGLEffectRenderRegion;
    }
  | {
      readonly type: "renderDropShadow";
      readonly effect: DropShadowEffect;
      readonly outputFramebuffer: WebGLFramebuffer | null;
      readonly backdropFramebuffer: WebGLFramebuffer | null;
      readonly requireClipStencil: boolean;
    }
  | {
      readonly type: "blitLayerWithOpacity";
      readonly sourceFramebuffer: Framebuffer;
      readonly opacity: number;
      readonly outputFramebuffer: WebGLFramebuffer | null;
      readonly requireClipStencil: boolean;
    }
  | {
      readonly type: "releaseLayerCapture";
      readonly capture: WebGLEffectLayerCapture;
    };

function webGLFramebuffer(label: string): WebGLFramebuffer {
  const value: unknown = Object.freeze({ label });
  assertWebGLFramebuffer(value);
  return value;
}

function webGLTexture(label: string): WebGLTexture {
  const value: unknown = Object.freeze({ label });
  assertWebGLTexture(value);
  return value;
}

function assertWebGLFramebuffer(_value: unknown): asserts _value is WebGLFramebuffer {}

function assertWebGLTexture(_value: unknown): asserts _value is WebGLTexture {}

function framebuffer(label: string): Framebuffer {
  return {
    fbo: webGLFramebuffer(`${label}:fbo`),
    texture: webGLTexture(`${label}:texture`),
    width: 64,
    height: 64,
  };
}

function dropShadow(overrides: Partial<DropShadowEffect> = {}): DropShadowEffect {
  return {
    type: "drop-shadow",
    offset: { x: 0, y: 0 },
    radius: 4,
    color: { r: 1, g: 1, b: 1, a: 1 },
    showShadowBehindNode: true,
    ...overrides,
  };
}

function fakeGLContext(): GLContext {
  const value: unknown = {
    glState: {
      invalidate: () => undefined,
    },
    vertexBuffers: {
      invalidateArrayBufferBinding: () => undefined,
    },
  };
  assertGLContext(value);
  return value;
}

function assertGLContext(_value: unknown): asserts _value is GLContext {}

function fakeEffectsRenderer({
  calls,
  captureFramebuffer,
}: {
  readonly calls: EffectRendererCall[];
  readonly captureFramebuffer: Framebuffer;
}): EffectsRendererInstance {
  return {
    precompileShaders: () => undefined,
    prepareSurface: () => undefined,
    setRendererOutputRegion: () => undefined,
    renderDropShadow: (params) => {
      calls.push({
        type: "renderDropShadow",
        effect: params.effect,
        outputFramebuffer: params.outputFramebuffer,
        backdropFramebuffer: params.backdropFramebuffer,
        requireClipStencil: params.requireClipStencil,
      });
    },
    renderInnerShadow: () => undefined,
    renderInnerShadows: () => undefined,
    renderBackgroundBlur: () => undefined,
    renderBlendedSolidShape: () => undefined,
    blendCapturedLayer: () => undefined,
    beginLayerCapture: (params) => {
      const capture: WebGLEffectLayerCapture = {
        framebuffer: captureFramebuffer,
        depth: 1,
      };
      calls.push({
        type: "beginLayerCapture",
        canvasWidth: params.canvasWidth,
        canvasHeight: params.canvasHeight,
        region: params.region,
      });
      return capture;
    },
    releaseLayerCapture: (capture) => {
      calls.push({ type: "releaseLayerCapture", capture });
    },
    endLayerCaptureAndBlur: () => undefined,
    blitLayerWithOpacity: (params) => {
      calls.push({
        type: "blitLayerWithOpacity",
        sourceFramebuffer: params.sourceFramebuffer,
        opacity: params.opacity,
        outputFramebuffer: params.outputFramebuffer,
        requireClipStencil: params.requireClipStencil,
      });
    },
    copyFramebufferRegionToRegion: () => undefined,
    applyGaussianBlur: (params) => params.source,
    dispose: () => undefined,
  };
}

function renderDropShadowCalls(calls: readonly EffectRendererCall[]): readonly Extract<EffectRendererCall, { readonly type: "renderDropShadow" }>[] {
  return calls.filter((call): call is Extract<EffectRendererCall, { readonly type: "renderDropShadow" }> => call.type === "renderDropShadow");
}

describe("createWebGLEffectRendering", () => {
  it("renders normal drop shadows against the renderer output backdrop without allocating a transparent filter backdrop", () => {
    const calls: EffectRendererCall[] = [];
    const outputFramebuffer = webGLFramebuffer("output");
    const backdropFramebuffer = webGLFramebuffer("backdrop");
    const captureFramebuffer = framebuffer("capture");
    const effectsRenderer = fakeEffectsRenderer({ calls, captureFramebuffer });
    const effectRendering = createWebGLEffectRendering({
      getGlContext: fakeGLContext,
      effectsRenderer,
      pixelRatio: () => 1,
      canvasWidth: () => 128,
      canvasHeight: () => 128,
      outputFramebuffer: () => outputFramebuffer,
      backdropFramebuffer: () => backdropFramebuffer,
      isClipStencilRequired: () => true,
    });
    const effect = dropShadow();

    effectRendering.renderDropShadows({
      effects: [effect],
      region: REGION,
      vertices: SILHOUETTE,
      transform: IDENTITY,
      resolvedNodeOpacity: 1,
    });

    expect(calls.map((call) => call.type)).toEqual(["renderDropShadow"]);
    expect(renderDropShadowCalls(calls)).toEqual([{
      type: "renderDropShadow",
      effect,
      outputFramebuffer,
      backdropFramebuffer,
      requireClipStencil: true,
    }]);
  });

  it("renders non-normal drop-shadow stacks inside the SVG-equivalent transparent filter backdrop", () => {
    const calls: EffectRendererCall[] = [];
    const outputFramebuffer = webGLFramebuffer("output");
    const backdropFramebuffer = webGLFramebuffer("backdrop");
    const captureFramebuffer = framebuffer("capture");
    const effectsRenderer = fakeEffectsRenderer({ calls, captureFramebuffer });
    const effectRendering = createWebGLEffectRendering({
      getGlContext: fakeGLContext,
      effectsRenderer,
      pixelRatio: () => 1,
      canvasWidth: () => 128,
      canvasHeight: () => 128,
      outputFramebuffer: () => outputFramebuffer,
      backdropFramebuffer: () => backdropFramebuffer,
      isClipStencilRequired: () => true,
    });
    const colorDodgeShadow = dropShadow({ blendMode: "color-dodge" });
    const normalShadow = dropShadow();

    effectRendering.renderDropShadows({
      effects: [colorDodgeShadow, normalShadow],
      region: REGION,
      vertices: SILHOUETTE,
      transform: IDENTITY,
      resolvedNodeOpacity: 1,
    });

    expect(calls.map((call) => call.type)).toEqual([
      "beginLayerCapture",
      "renderDropShadow",
      "renderDropShadow",
      "blitLayerWithOpacity",
      "releaseLayerCapture",
    ]);
    expect(renderDropShadowCalls(calls)).toEqual([
      {
        type: "renderDropShadow",
        effect: colorDodgeShadow,
        outputFramebuffer: captureFramebuffer.fbo,
        backdropFramebuffer: captureFramebuffer.fbo,
        requireClipStencil: false,
      },
      {
        type: "renderDropShadow",
        effect: normalShadow,
        outputFramebuffer: captureFramebuffer.fbo,
        backdropFramebuffer: captureFramebuffer.fbo,
        requireClipStencil: false,
      },
    ]);
    expect(calls[3]).toEqual({
      type: "blitLayerWithOpacity",
      sourceFramebuffer: captureFramebuffer,
      opacity: 1,
      outputFramebuffer,
      requireClipStencil: true,
    });
  });

  it("uses the same transparent filter backdrop for caller-owned path silhouettes", () => {
    const calls: EffectRendererCall[] = [];
    const outputFramebuffer = webGLFramebuffer("output");
    const captureFramebuffer = framebuffer("capture");
    const effectsRenderer = fakeEffectsRenderer({ calls, captureFramebuffer });
    const effectRendering = createWebGLEffectRendering({
      getGlContext: fakeGLContext,
      effectsRenderer,
      pixelRatio: () => 1,
      canvasWidth: () => 128,
      canvasHeight: () => 128,
      outputFramebuffer: () => outputFramebuffer,
      backdropFramebuffer: () => webGLFramebuffer("backdrop"),
      isClipStencilRequired: () => true,
    });
    const effect = dropShadow({ blendMode: "color-dodge" });

    effectRendering.renderDropShadowsWithSilhouette({
      effects: [effect],
      region: REGION,
      transform: IDENTITY,
      resolvedNodeOpacity: 1,
      renderSilhouette: () => undefined,
    });

    expect(calls.map((call) => call.type)).toEqual([
      "beginLayerCapture",
      "renderDropShadow",
      "blitLayerWithOpacity",
      "releaseLayerCapture",
    ]);
    expect(renderDropShadowCalls(calls)).toEqual([{
      type: "renderDropShadow",
      effect,
      outputFramebuffer: captureFramebuffer.fbo,
      backdropFramebuffer: captureFramebuffer.fbo,
      requireClipStencil: false,
    }]);
  });
});
