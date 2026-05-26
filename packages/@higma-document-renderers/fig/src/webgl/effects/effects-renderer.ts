/**
 * @file WebGL effects rendering
 *
 * Implements drop shadow, inner shadow, and layer blur using FBOs
 * and multi-pass rendering.
 */

import { resolveBrowserRenderedFigmaExportCssBlendMode, resolveBrowserRenderedFigmaExportEffectBlendMode, resolveFigmaBlurStdDeviation, type BackgroundBlurEffect, type BlendMode, type DropShadowEffect, type InnerShadowEffect, type LayerBlurEffect } from "@higma-document-renderers/fig/scene-graph";
import type { Framebuffer } from "../resources/framebuffer";
import { createFramebuffer, createFramebufferWithStencil, deleteFramebuffer, bindFramebuffer } from "../resources/framebuffer";
import { CLIP_STENCIL_BIT, FILL_STENCIL_MASK } from "../tessellation/stencil-fill";
import { applyEffectOffsetScale, type EffectBackingScale } from "./effect-scale";
import {
  expandWebGLEffectRenderRegionForShaderSampling,
  intersectWebGLEffectRenderRegions,
  resolveWebGLEffectBackdropCopyRegion,
  type WebGLEffectRenderRegion,
} from "./effect-render-region";

/**
 * Gaussian blur shader (separable 2-pass)
 */
export const gaussianBlurVertexShader = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
  }
`;

export const gaussianBlurFragmentShader = `
  precision mediump float;

  uniform sampler2D u_texture;
  uniform vec2 u_direction;
  uniform vec2 u_texelSize;
  uniform float u_radius;
  uniform float u_premultipliedInput;

  varying vec2 v_texCoord;

  void main() {
    vec4 color = vec4(0.0);
    float totalWeight = 0.0;

    // u_radius = per-pass sigma (in texels)
    float sigma = max(u_radius, 0.001);
    float invTwoSigmaSq = -0.5 / (sigma * sigma);

    // 33-tap integer-spaced Gaussian kernel. applyGaussianBlur splits large
    // radii into smaller sigma passes, so this covers the useful tail while
    // staying close to SVG feGaussianBlur output.
    //
    // Blur in premultiplied-alpha space to prevent dark halos at transparent
    // edges. SVG feGaussianBlur operates on premultiplied color channels.
    for (float i = -16.0; i <= 16.0; i += 1.0) {
      float d = i;
      float weight = exp(invTwoSigmaSq * d * d);
      vec2 offset = u_direction * u_texelSize * d;
      vec4 s = texture2D(u_texture, v_texCoord + offset);
      // Straight-alpha inputs must be premultiplied before filtering to
      // prevent transparent-black halos. Framebuffer captures/backdrops are
      // already premultiplied by WebGL blending, so multiplying those again
      // would darken background blur and layer blur output.
      if (u_premultipliedInput < 0.5) {
        s.rgb *= s.a;
      }
      color += s * weight;
      totalWeight += weight;
    }

    color /= totalWeight;
    // Un-premultiply
    if (color.a > 0.001) {
      color.rgb /= color.a;
    }
    gl_FragColor = color;
  }
`;

const EIGHT_BIT_HALF_STEP = 0.5 / 255;

/** Return whether the integer-sampled WebGL Gaussian kernel can change an adjacent 8-bit sample. */
export function shouldRunWebGLGaussianBlurForSigma(sigma: number): boolean {
  if (!Number.isFinite(sigma)) {
    throw new Error(`WebGL Gaussian blur sigma must be finite, got ${sigma}`);
  }
  if (sigma < 0) {
    throw new Error(`WebGL Gaussian blur sigma must be non-negative, got ${sigma}`);
  }
  if (sigma === 0) {
    return false;
  }
  const adjacentSampleWeight = Math.exp(-0.5 / (sigma * sigma));
  return adjacentSampleWeight >= EIGHT_BIT_HALF_STEP;
}

export const alphaMorphologyFragmentShader = `
  precision mediump float;

  uniform sampler2D u_texture;
  uniform vec2 u_texelSize;
  uniform float u_radius;
  uniform float u_operator;

  varying vec2 v_texCoord;

  void main() {
    float resultAlpha = u_operator > 0.5 ? 0.0 : 1.0;
    vec3 resultColor = vec3(0.0);
    float radius = min(abs(u_radius), 16.0);

    for (float x = -16.0; x <= 16.0; x += 1.0) {
      for (float y = -16.0; y <= 16.0; y += 1.0) {
        if (abs(x) <= radius && abs(y) <= radius) {
          vec4 sampleColor = texture2D(u_texture, v_texCoord + vec2(x, y) * u_texelSize);
          if (u_operator > 0.5) {
            if (sampleColor.a > resultAlpha) {
              resultAlpha = sampleColor.a;
              resultColor = sampleColor.rgb;
            }
          } else {
            if (sampleColor.a < resultAlpha) {
              resultAlpha = sampleColor.a;
              resultColor = sampleColor.rgb;
            }
          }
        }
      }
    }

    gl_FragColor = vec4(resultColor, resultAlpha);
  }
`;

export const alphaBinarizeFragmentShader = `
  precision mediump float;

  uniform sampler2D u_texture;

  varying vec2 v_texCoord;

  void main() {
    float alpha = clamp(texture2D(u_texture, v_texCoord).a * 127.0, 0.0, 1.0);
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
  }
`;

/**
 * Compositing shader for shadow overlay
 */
export const compositeVertexShader = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
  }
`;

export const compositeFragmentShader = `
  precision mediump float;

  uniform sampler2D u_texture;
  uniform sampler2D u_shapeTexture;
  uniform vec4 u_color;
  uniform vec2 u_offset;
  uniform vec2 u_texelSize;
  uniform float u_clipInside;

  varying vec2 v_texCoord;

  void main() {
    float alpha = texture2D(u_texture, v_texCoord + u_offset * u_texelSize).a;
    if (u_clipInside > 0.5) {
      float shapeAlpha = texture2D(u_shapeTexture, v_texCoord).a;
      alpha = alpha * (1.0 - shapeAlpha);
    }
    gl_FragColor = vec4(u_color.rgb, u_color.a * alpha);
  }
`;

export const blendShadowFragmentShader = `
  precision mediump float;

  uniform sampler2D u_shadowTexture;
  uniform sampler2D u_shapeTexture;
  uniform sampler2D u_backdropTexture;
  uniform vec4 u_color;
  uniform vec2 u_offset;
  uniform vec2 u_texelSize;
  uniform float u_clipInside;
  uniform int u_blendMode;

  varying vec2 v_texCoord;

  float lum(vec3 c) {
    return dot(c, vec3(0.3, 0.59, 0.11));
  }

  vec3 clipColor(vec3 c) {
    float l = lum(c);
    float n = min(min(c.r, c.g), c.b);
    float x = max(max(c.r, c.g), c.b);
    if (n < 0.0) { c = l + ((c - l) * l) / (l - n); }
    if (x > 1.0) { c = l + ((c - l) * (1.0 - l)) / (x - l); }
    return c;
  }

  vec3 setLum(vec3 c, float l) {
    return clipColor(c + (l - lum(c)));
  }

  float sat(vec3 c) {
    return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  }

  vec3 setSat(vec3 c, float s) {
    float minC = min(min(c.r, c.g), c.b);
    float maxC = max(max(c.r, c.g), c.b);
    if (maxC > minC) {
      return (c - minC) * s / (maxC - minC);
    }
    return vec3(0.0);
  }

  vec3 blendColor(vec3 backdrop, vec3 source) {
    if (u_blendMode == 1) { return backdrop * source; }
    if (u_blendMode == 2) { return backdrop + source - backdrop * source; }
    if (u_blendMode == 3) { return min(backdrop, source); }
    if (u_blendMode == 4) { return max(backdrop, source); }
    if (u_blendMode == 5) {
      return mix(2.0 * backdrop * source, 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source), step(0.5, backdrop));
    }
    if (u_blendMode == 6) {
      return min(vec3(1.0), backdrop / max(vec3(0.001), 1.0 - source));
    }
    if (u_blendMode == 7) {
      return 1.0 - min(vec3(1.0), (1.0 - backdrop) / max(vec3(0.001), source));
    }
    if (u_blendMode == 8) {
      return mix(2.0 * backdrop * source, 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source), step(0.5, source));
    }
    if (u_blendMode == 9) {
      return (1.0 - 2.0 * source) * backdrop * backdrop + 2.0 * source * backdrop;
    }
    if (u_blendMode == 10) { return abs(backdrop - source); }
    if (u_blendMode == 11) { return backdrop + source - 2.0 * backdrop * source; }
    if (u_blendMode == 12) { return setLum(setSat(source, sat(backdrop)), lum(backdrop)); }
    if (u_blendMode == 13) { return setLum(setSat(backdrop, sat(source)), lum(backdrop)); }
    if (u_blendMode == 14) { return setLum(source, lum(backdrop)); }
    if (u_blendMode == 15) { return setLum(backdrop, lum(source)); }
    if (u_blendMode == 16) { return min(vec3(1.0), backdrop + source); }
    return source;
  }

  vec3 straightColor(vec4 color) {
    if (color.a <= 0.0001) { return vec3(0.0); }
    return color.rgb / color.a;
  }

  vec4 plusLighterComposite(vec3 backdropColor, float backdropAlpha, vec3 sourceColor, float sourceAlpha) {
    float outputAlpha = min(1.0, sourceAlpha + backdropAlpha);
    vec3 premultipliedOutput = min(vec3(1.0), sourceColor * sourceAlpha + backdropColor * backdropAlpha);
    if (outputAlpha <= 0.0001) {
      return vec4(0.0);
    }
    return vec4(premultipliedOutput / outputAlpha, outputAlpha);
  }

  void main() {
    vec4 backdrop = texture2D(u_backdropTexture, v_texCoord);
    float alpha = texture2D(u_shadowTexture, v_texCoord + u_offset * u_texelSize).a;
    if (u_clipInside > 0.5) {
      float shapeAlpha = texture2D(u_shapeTexture, v_texCoord).a;
      alpha = alpha * (1.0 - shapeAlpha);
    }
    float sourceAlpha = alpha * u_color.a;
    vec3 backdropColor = straightColor(backdrop);
    vec3 sourceColor = u_color.rgb;
    if (u_blendMode == 16) {
      gl_FragColor = plusLighterComposite(backdropColor, backdrop.a, sourceColor, sourceAlpha);
      return;
    }
    vec3 blendedColor = blendColor(backdropColor, sourceColor);
    float outputAlpha = sourceAlpha + backdrop.a * (1.0 - sourceAlpha);
    vec3 premultipliedOutput =
      sourceColor * sourceAlpha * (1.0 - backdrop.a) +
      backdropColor * backdrop.a * (1.0 - sourceAlpha) +
      blendedColor * sourceAlpha * backdrop.a;
    if (outputAlpha <= 0.0001) {
      gl_FragColor = vec4(0.0);
      return;
    }
    gl_FragColor = vec4(premultipliedOutput / outputAlpha, outputAlpha);
  }
`;

export const blendContentFragmentShader = `
  precision mediump float;

  uniform sampler2D u_sourceTexture;
  uniform sampler2D u_backdropTexture;
  uniform int u_blendMode;
  uniform float u_sourcePremultipliedInput;

  varying vec2 v_texCoord;

  float lum(vec3 c) {
    return dot(c, vec3(0.3, 0.59, 0.11));
  }

  vec3 clipColor(vec3 c) {
    float l = lum(c);
    float n = min(min(c.r, c.g), c.b);
    float x = max(max(c.r, c.g), c.b);
    if (n < 0.0) { c = l + ((c - l) * l) / (l - n); }
    if (x > 1.0) { c = l + ((c - l) * (1.0 - l)) / (x - l); }
    return c;
  }

  vec3 setLum(vec3 c, float l) {
    return clipColor(c + (l - lum(c)));
  }

  float sat(vec3 c) {
    return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  }

  vec3 setSat(vec3 c, float s) {
    float minC = min(min(c.r, c.g), c.b);
    float maxC = max(max(c.r, c.g), c.b);
    if (maxC > minC) {
      return (c - minC) * s / (maxC - minC);
    }
    return vec3(0.0);
  }

  vec3 blendColor(vec3 backdrop, vec3 source) {
    if (u_blendMode == 1) { return backdrop * source; }
    if (u_blendMode == 2) { return backdrop + source - backdrop * source; }
    if (u_blendMode == 3) { return min(backdrop, source); }
    if (u_blendMode == 4) { return max(backdrop, source); }
    if (u_blendMode == 5) {
      return mix(2.0 * backdrop * source, 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source), step(0.5, backdrop));
    }
    if (u_blendMode == 6) {
      return min(vec3(1.0), backdrop / max(vec3(0.001), 1.0 - source));
    }
    if (u_blendMode == 7) {
      return 1.0 - min(vec3(1.0), (1.0 - backdrop) / max(vec3(0.001), source));
    }
    if (u_blendMode == 8) {
      return mix(2.0 * backdrop * source, 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source), step(0.5, source));
    }
    if (u_blendMode == 9) {
      return (1.0 - 2.0 * source) * backdrop * backdrop + 2.0 * source * backdrop;
    }
    if (u_blendMode == 10) { return abs(backdrop - source); }
    if (u_blendMode == 11) { return backdrop + source - 2.0 * backdrop * source; }
    if (u_blendMode == 12) { return setLum(setSat(source, sat(backdrop)), lum(backdrop)); }
    if (u_blendMode == 13) { return setLum(setSat(backdrop, sat(source)), lum(backdrop)); }
    if (u_blendMode == 14) { return setLum(source, lum(backdrop)); }
    if (u_blendMode == 15) { return setLum(backdrop, lum(source)); }
    if (u_blendMode == 16) { return min(vec3(1.0), backdrop + source); }
    return source;
  }

  vec3 straightColor(vec4 color) {
    if (color.a <= 0.0001) { return vec3(0.0); }
    return color.rgb / color.a;
  }

  vec4 plusLighterComposite(vec3 backdropColor, float backdropAlpha, vec3 sourceColor, float sourceAlpha) {
    float outputAlpha = min(1.0, sourceAlpha + backdropAlpha);
    vec3 premultipliedOutput = min(vec3(1.0), sourceColor * sourceAlpha + backdropColor * backdropAlpha);
    if (outputAlpha <= 0.0001) {
      return vec4(0.0);
    }
    return vec4(premultipliedOutput / outputAlpha, outputAlpha);
  }

  void main() {
    vec4 backdrop = texture2D(u_backdropTexture, v_texCoord);
    vec4 source = texture2D(u_sourceTexture, v_texCoord);
    float sourceAlpha = source.a;
    vec3 backdropColor = straightColor(backdrop);
    vec3 sourceColor = source.rgb;
    if (u_sourcePremultipliedInput > 0.5 && sourceAlpha > 0.0001) {
      sourceColor = source.rgb / sourceAlpha;
    }
    if (u_blendMode == 16) {
      gl_FragColor = plusLighterComposite(backdropColor, backdrop.a, sourceColor, sourceAlpha);
      return;
    }
    vec3 blendedColor = blendColor(backdropColor, sourceColor);
    float outputAlpha = sourceAlpha + backdrop.a * (1.0 - sourceAlpha);
    vec3 premultipliedOutput =
      sourceColor * sourceAlpha * (1.0 - backdrop.a) +
      backdropColor * backdrop.a * (1.0 - sourceAlpha) +
      blendedColor * sourceAlpha * backdrop.a;
    if (outputAlpha <= 0.0001) {
      gl_FragColor = vec4(0.0);
      return;
    }
    gl_FragColor = vec4(premultipliedOutput / outputAlpha, outputAlpha);
  }
`;

/**
 * Inner shadow compositing shader.
 *
 * Uses two textures: the original shape silhouette and the blurred silhouette.
 * Shadow mask = shapeAlpha - blurredAlpha_at_offset.
 * This produces color only at the inner edges of the shape where the shifted
 * blurred silhouette doesn't fully cover.
 */
export const innerShadowFragmentShader = `
  precision mediump float;

  uniform sampler2D u_shapeTexture;
  uniform sampler2D u_blurredTexture;
  uniform vec4 u_color;
  uniform vec2 u_offset;
  uniform vec2 u_texelSize;

  varying vec2 v_texCoord;

  void main() {
    float shapeAlpha = texture2D(u_shapeTexture, v_texCoord).a;
    float blurredAlpha = texture2D(u_blurredTexture, v_texCoord + u_offset * u_texelSize).a;
    float shadowMask = max(shapeAlpha - blurredAlpha, 0.0);
    gl_FragColor = vec4(u_color.rgb, u_color.a * shadowMask);
  }
`;

/**
 * Blit shader for compositing framebuffer texture to screen with opacity.
 */
export const blitFragmentShader = `
  precision mediump float;

  uniform sampler2D u_texture;
  uniform float u_opacity;
  uniform float u_premultipliedInput;

  varying vec2 v_texCoord;

  void main() {
    vec4 texel = texture2D(u_texture, v_texCoord);
    vec3 color = texel.rgb;
    if (u_premultipliedInput > 0.5 && texel.a > 0.0001) {
      color = texel.rgb / texel.a;
    }
    gl_FragColor = vec4(color, texel.a * u_opacity);
  }
`;

export const regionCopyVertexShader = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

export const regionCopyFragmentShader = `
  precision mediump float;

  uniform sampler2D u_texture;

  varying vec2 v_texCoord;

  void main() {
    gl_FragColor = texture2D(u_texture, v_texCoord);
  }
`;

const EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS = 16;

type BeginWebGLEffectLayerCaptureParams = {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly region: WebGLEffectRenderRegion;
};

export type InnerShadowBlurSourceRun = {
  readonly radius: number;
  readonly spread: number;
  readonly effects: readonly InnerShadowEffect[];
};

export type WebGLEffectLayerCapture = {
  readonly framebuffer: Framebuffer;
  readonly depth: number;
};

export type WebGLTextureAlphaMode = "premultiplied" | "straight";

/** Resolve final WebGL shadow alpha from Kiwi/Figma effect alpha and RenderTree opacity. */
export function resolveWebGLEffectCompositeAlpha(
  effectColorAlpha: number,
  resolvedNodeOpacity: number,
): number {
  if (!Number.isFinite(effectColorAlpha) || effectColorAlpha < 0 || effectColorAlpha > 1) {
    throw new Error(`WebGL effect color alpha must be finite within [0, 1], got ${effectColorAlpha}`);
  }
  if (!Number.isFinite(resolvedNodeOpacity) || resolvedNodeOpacity < 0 || resolvedNodeOpacity > 1) {
    throw new Error(`WebGL effect resolved node opacity must be finite within [0, 1], got ${resolvedNodeOpacity}`);
  }
  return effectColorAlpha * resolvedNodeOpacity;
}

/** Group adjacent inner-shadow effects that can share one spread and blur source. */
export function resolveConsecutiveInnerShadowBlurSourceRuns(
  effects: readonly InnerShadowEffect[],
): readonly InnerShadowBlurSourceRun[] {
  return effects.reduce<readonly InnerShadowBlurSourceRun[]>((runs, effect) => {
    const radius = requireFiniteNonNegativeInnerShadowRadius(effect.radius);
    const spread = resolveInnerShadowSpreadForBlurSource(effect);
    const previous = runs.at(-1);
    if (previous !== undefined && previous.radius === radius && previous.spread === spread) {
      return [
        ...runs.slice(0, -1),
        {
          ...previous,
          effects: [...previous.effects, effect],
        },
      ];
    }
    return [
      ...runs,
      {
        radius,
        spread,
        effects: [effect],
      },
    ];
  }, []);
}

function requireFiniteNonNegativeInnerShadowRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new Error(`WebGL inner shadow radius must be finite and non-negative, got ${radius}`);
  }
  return radius;
}

function resolveInnerShadowSpreadForBlurSource(effect: InnerShadowEffect): number {
  const spread = effect.spread ?? 0;
  if (!Number.isFinite(spread)) {
    throw new Error(`WebGL inner shadow spread must be finite when present, got ${spread}`);
  }
  return spread;
}

/** Effects renderer instance */
export type EffectsRendererInstance = {
  /** Compile all effect shader programs before the first interactive frame. */
  precompileShaders(): void;
  /** Allocate effect render targets for the current WebGL backing surface before the draw frame. */
  prepareSurface(params: { readonly canvasWidth: number; readonly canvasHeight: number }): void;
  /** Restrict effect output to the current renderer-owned redraw region. */
  setRendererOutputRegion(region: WebGLEffectRenderRegion | null): void;
  renderDropShadow(params: { readonly canvasWidth: number; readonly canvasHeight: number; readonly region: WebGLEffectRenderRegion; readonly effect: DropShadowEffect; readonly resolvedNodeOpacity: number; readonly worldToBacking: EffectBackingScale; readonly outputFramebuffer: WebGLFramebuffer | null; readonly backdropFramebuffer: WebGLFramebuffer | null; readonly requireClipStencil: boolean; readonly renderSilhouette: () => void }): void;
  renderInnerShadow(params: { readonly canvasWidth: number; readonly canvasHeight: number; readonly region: WebGLEffectRenderRegion; readonly effect: InnerShadowEffect; readonly resolvedNodeOpacity: number; readonly worldToBacking: EffectBackingScale; readonly outputFramebuffer: WebGLFramebuffer | null; readonly backdropFramebuffer: WebGLFramebuffer | null; readonly requireClipStencil: boolean; readonly renderSilhouette: () => void }): void;
  renderInnerShadows(params: { readonly canvasWidth: number; readonly canvasHeight: number; readonly region: WebGLEffectRenderRegion; readonly effects: readonly InnerShadowEffect[]; readonly resolvedNodeOpacity: number; readonly worldToBacking: EffectBackingScale; readonly outputFramebuffer: WebGLFramebuffer | null; readonly backdropFramebuffer: WebGLFramebuffer | null; readonly requireClipStencil: boolean; readonly renderSilhouette: () => void }): void;
  renderBackgroundBlur(params: { readonly canvasWidth: number; readonly canvasHeight: number; readonly region: WebGLEffectRenderRegion; readonly effect: BackgroundBlurEffect; readonly worldToBacking: EffectBackingScale; readonly outputFramebuffer: WebGLFramebuffer | null; readonly backdropFramebuffer: WebGLFramebuffer | null; readonly requireClipStencil: boolean; readonly renderMask: () => void }): void;
  renderBlendedSolidShape(params: { readonly canvasWidth: number; readonly canvasHeight: number; readonly region: WebGLEffectRenderRegion; readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }; readonly opacity: number; readonly blendMode: BlendMode; readonly outputFramebuffer: WebGLFramebuffer | null; readonly backdropFramebuffer: WebGLFramebuffer | null; readonly requireClipStencil: boolean; readonly renderShape: () => void }): void;
  blendCapturedLayer(params: { readonly canvasWidth: number; readonly canvasHeight: number; readonly region: WebGLEffectRenderRegion; readonly sourceFramebuffer: Framebuffer; readonly blendMode: BlendMode; readonly outputFramebuffer: WebGLFramebuffer | null; readonly backdropFramebuffer: WebGLFramebuffer | null; readonly requireClipStencil: boolean }): void;
  beginLayerCapture(params: BeginWebGLEffectLayerCaptureParams): WebGLEffectLayerCapture;
  releaseLayerCapture(capture: WebGLEffectLayerCapture): void;
  endLayerCaptureAndBlur(params: { canvasWidth: number; canvasHeight: number; region: WebGLEffectRenderRegion; sourceFramebuffer: Framebuffer; effect: LayerBlurEffect; worldToBacking: EffectBackingScale; outputFramebuffer: WebGLFramebuffer | null; requireClipStencil: boolean }): void;
  /** Blit the captured layer framebuffer to the current renderer output with the given opacity and no blur. */
  blitLayerWithOpacity(params: { canvasWidth: number; canvasHeight: number; region: WebGLEffectRenderRegion; sourceFramebuffer: Framebuffer; opacity: number; outputFramebuffer: WebGLFramebuffer | null; requireClipStencil: boolean }): void;
  /** Copy one source framebuffer region into a different renderer output region without blending. */
  copyFramebufferRegionToRegion(params: { readonly canvasWidth: number; readonly canvasHeight: number; readonly sourceRegion: WebGLEffectRenderRegion; readonly targetRegion: WebGLEffectRenderRegion; readonly sourceFramebuffer: Framebuffer; readonly outputFramebuffer: WebGLFramebuffer | null }): void;
  /**
   * Apply a Gaussian blur to a framebuffer. `radius` is in **backing-buffer
   * pixels** — callers must have already multiplied by the world→backing
   * length scale (see `EffectBackingScale.lengthScale`).
   */
  applyGaussianBlur(params: {
    readonly source: Framebuffer;
    readonly radius: number;
    readonly region: WebGLEffectRenderRegion;
    readonly inputAlphaMode: WebGLTextureAlphaMode;
  }): Framebuffer;
  dispose(): void;
};

function cssBlendModeToShaderCode(blendMode: BlendMode | undefined): number {
  const browserBlendMode = resolveBrowserRenderedFigmaExportCssBlendMode(blendMode);
  switch (browserBlendMode) {
    case "multiply": return 1;
    case "screen": return 2;
    case "darken": return 3;
    case "lighten": return 4;
    case "overlay": return 5;
    case "color-dodge": return 6;
    case "color-burn": return 7;
    case "hard-light": return 8;
    case "soft-light": return 9;
    case "difference": return 10;
    case "exclusion": return 11;
    case "hue": return 12;
    case "saturation": return 13;
    case "color": return 14;
    case "luminosity": return 15;
    case "plus-lighter": return 16;
    default: return 0;
  }
}

function effectBlendModeToShaderCode(blendMode: BlendMode | undefined): number {
  const effectBlendMode = resolveBrowserRenderedFigmaExportEffectBlendMode(blendMode);
  if (effectBlendMode === "normal") {
    return 0;
  }
  return cssBlendModeToShaderCode(effectBlendMode);
}

/**
 * Create an effects renderer for WebGL drop shadow, inner shadow, and layer blur
 */
export function createEffectsRenderer(gl: WebGLRenderingContext): EffectsRendererInstance {
  const blurProgram = { value: null as WebGLProgram | null };
  const morphologyProgram = { value: null as WebGLProgram | null };
  const alphaBinarizeProgram = { value: null as WebGLProgram | null };
  const compositeProgram = { value: null as WebGLProgram | null };
  const blendShadowProgram = { value: null as WebGLProgram | null };
  const blendContentProgram = { value: null as WebGLProgram | null };
  const innerShadowProgram = { value: null as WebGLProgram | null };
  const blitProgram = { value: null as WebGLProgram | null };
  const regionCopyProgram = { value: null as WebGLProgram | null };
  const fullscreenQuad = { value: null as WebGLBuffer | null };
  const regionCopyQuad = { value: null as WebGLBuffer | null };
  const tempFBO1 = { value: null as Framebuffer | null };
  const tempFBO2 = { value: null as Framebuffer | null };
  const shapeFBO = { value: null as Framebuffer | null };
  const layerCaptureFramebuffers = { value: [] as Framebuffer[] };
  const activeLayerCaptureDepth = { value: 0 };
  const backdropFBO = { value: null as Framebuffer | null };
  const rendererOutputRegion = { value: null as WebGLEffectRenderRegion | null };
  const uniformLocationCache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation>>();
  const attribLocationCache = new WeakMap<WebGLProgram, Map<string, number>>();
  const scissorState = {
    enabled: false,
    box: { x: 0, y: 0, width: 0, height: 0 },
  };

  type EffectScissorState = {
    readonly enabled: boolean;
    readonly box: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  };

  function compileShader(label: string, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error(`WebGL effects renderer failed to allocate ${label} shader`);
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? "unknown shader compile error";
      gl.deleteShader(shader);
      throw new Error(`WebGL effects renderer failed to compile ${label} shader: ${info}`);
    }
    return shader;
  }

  function compileProgram(label: string, vertexSrc: string, fragmentSrc: string): WebGLProgram {
    const vs = compileShader(`${label} vertex`, gl.VERTEX_SHADER, vertexSrc);
    const fs = compileShader(`${label} fragment`, gl.FRAGMENT_SHADER, fragmentSrc);

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error(`WebGL effects renderer failed to allocate ${label} shader program`);
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? "unknown program link error";
      gl.deleteProgram(program);
      throw new Error(`WebGL effects renderer failed to link ${label} shader program: ${info}`);
    }

    return program;
  }

  function ensureEffectShaders(): void {
    if (!blurProgram.value) {
      blurProgram.value = compileProgram("gaussian blur", gaussianBlurVertexShader, gaussianBlurFragmentShader);
    }

    if (!morphologyProgram.value) {
      morphologyProgram.value = compileProgram("alpha morphology", gaussianBlurVertexShader, alphaMorphologyFragmentShader);
    }

    if (!alphaBinarizeProgram.value) {
      alphaBinarizeProgram.value = compileProgram("alpha binarize", gaussianBlurVertexShader, alphaBinarizeFragmentShader);
    }

    if (!compositeProgram.value) {
      compositeProgram.value = compileProgram("drop shadow composite", compositeVertexShader, compositeFragmentShader);
    }

    if (!blendShadowProgram.value) {
      blendShadowProgram.value = compileProgram("shadow blend", compositeVertexShader, blendShadowFragmentShader);
    }

    if (!blendContentProgram.value) {
      blendContentProgram.value = compileProgram("content blend", compositeVertexShader, blendContentFragmentShader);
    }

    if (!innerShadowProgram.value) {
      innerShadowProgram.value = compileProgram("inner shadow", compositeVertexShader, innerShadowFragmentShader);
    }

    if (!blitProgram.value) {
      blitProgram.value = compileProgram("blit", compositeVertexShader, blitFragmentShader);
    }

    if (!regionCopyProgram.value) {
      regionCopyProgram.value = compileProgram("region copy", regionCopyVertexShader, regionCopyFragmentShader);
    }

    if (!fullscreenQuad.value) {
      fullscreenQuad.value = createFullscreenQuadBuffer();
    }

    if (!regionCopyQuad.value) {
      regionCopyQuad.value = createRegionCopyQuadBuffer();
    }
  }

  function ensureResources(width: number, height: number): void {
    ensureEffectShaders();

    // Recreate FBOs if size changed
    if (!tempFBO1.value || tempFBO1.value.width !== width || tempFBO1.value.height !== height) {
      deleteFramebufferIfPresent(tempFBO1.value);
      deleteFramebufferIfPresent(tempFBO2.value);
      tempFBO1.value = createFramebuffer(gl, width, height);
      tempFBO2.value = createFramebuffer(gl, width, height);
    }
  }

  function ensureShapeFBO(width: number, height: number): void {
    if (!shapeFBO.value || shapeFBO.value.width !== width || shapeFBO.value.height !== height) {
      deleteFramebufferIfPresent(shapeFBO.value);
      shapeFBO.value = createFramebufferWithStencil(gl, width, height);
    }
  }

  function ensureInnerShadowProgram(): void {
    ensureEffectShaders();
  }

  function ensureLayerCaptureFramebuffer(width: number, height: number, depth: number): Framebuffer {
    const existing = layerCaptureFramebuffers.value[depth];
    if (existing !== undefined && existing.width === width && existing.height === height) {
      return existing;
    }
    if (existing !== undefined) {
      deleteFramebuffer(gl, existing);
    }
    const framebuffer = createFramebufferWithStencil(gl, width, height);
    layerCaptureFramebuffers.value[depth] = framebuffer;
    return framebuffer;
  }

  function releaseLayerCapture(capture: WebGLEffectLayerCapture): void {
    const expectedDepth = activeLayerCaptureDepth.value - 1;
    if (capture.depth !== expectedDepth) {
      throw new Error(`WebGL effects renderer layer capture release order is invalid: expected depth ${expectedDepth}, got ${capture.depth}`);
    }
    activeLayerCaptureDepth.value = expectedDepth;
  }

  function ensureBackdropFBO(width: number, height: number): void {
    if (!backdropFBO.value || backdropFBO.value.width !== width || backdropFBO.value.height !== height) {
      deleteFramebufferIfPresent(backdropFBO.value);
      backdropFBO.value = createFramebuffer(gl, width, height);
    }
  }

  function deleteFramebufferIfPresent(framebuffer: Framebuffer | null): void {
    if (framebuffer === null) {
      return;
    }
    deleteFramebuffer(gl, framebuffer);
  }

  function createFullscreenQuadBuffer(): WebGLBuffer {
    const buffer = gl.createBuffer();
    if (buffer === null) {
      throw new Error("WebGL effects renderer failed to allocate fullscreen quad buffer");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    return buffer;
  }

  function createRegionCopyQuadBuffer(): WebGLBuffer {
    const buffer = gl.createBuffer();
    if (buffer === null) {
      throw new Error("WebGL effects renderer failed to allocate region copy quad buffer");
    }
    return buffer;
  }

  function bindEffectOutputFramebuffer(framebuffer: WebGLFramebuffer | null): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  }

  function programUniformLocations(program: WebGLProgram): Map<string, WebGLUniformLocation> {
    const cached = uniformLocationCache.get(program);
    if (cached !== undefined) {
      return cached;
    }
    const locations = new Map<string, WebGLUniformLocation>();
    uniformLocationCache.set(program, locations);
    return locations;
  }

  function programAttribLocations(program: WebGLProgram): Map<string, number> {
    const cached = attribLocationCache.get(program);
    if (cached !== undefined) {
      return cached;
    }
    const locations = new Map<string, number>();
    attribLocationCache.set(program, locations);
    return locations;
  }

  function requireUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation {
    const locations = programUniformLocations(program);
    const cached = locations.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const location = gl.getUniformLocation(program, name);
    if (location === null) {
      throw new Error(`WebGL effects renderer shader uniform "${name}" is not active`);
    }
    locations.set(name, location);
    return location;
  }

  function requireAttribLocation(program: WebGLProgram, name: string): number {
    const locations = programAttribLocations(program);
    const cached = locations.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const location = gl.getAttribLocation(program, name);
    if (location < 0) {
      throw new Error(`WebGL effects renderer shader attribute "${name}" is not active`);
    }
    locations.set(name, location);
    return location;
  }

  function snapshotEffectScissorState(): EffectScissorState {
    return {
      enabled: scissorState.enabled,
      box: { ...scissorState.box },
    };
  }

  function setEffectScissorEnabled(enabled: boolean): void {
    if (scissorState.enabled === enabled) {
      return;
    }
    if (enabled) {
      gl.enable(gl.SCISSOR_TEST);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    scissorState.enabled = enabled;
  }

  function setEffectScissorBox(region: WebGLEffectRenderRegion): void {
    const box = scissorState.box;
    if (
      box.x === region.x &&
      box.y === region.y &&
      box.width === region.width &&
      box.height === region.height
    ) {
      return;
    }
    gl.scissor(region.x, region.y, region.width, region.height);
    scissorState.box = {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    };
  }

  function restoreEffectScissorState(state: EffectScissorState): void {
    setEffectScissorBox(state.box);
    setEffectScissorEnabled(state.enabled);
  }

  function copyFramebufferToBackdrop(
    canvasWidth: number,
    canvasHeight: number,
    region: WebGLEffectRenderRegion,
    sourceFramebuffer: WebGLFramebuffer | null,
    restoreFramebuffer: WebGLFramebuffer | null,
  ): Framebuffer {
    ensureBackdropFBO(canvasWidth, canvasHeight);
    const copyRegion = resolveWebGLEffectBackdropCopyRegion(webGLEffectShaderSamplingRegion(region, canvasWidth, canvasHeight, EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS));
    if (copyRegion === null) {
      return backdropFBO.value!;
    }
    bindFramebuffer(gl, backdropFBO.value!);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    clearWebGLEffectFramebufferRegion({
      framebuffer: backdropFBO.value!,
      canvasWidth,
      canvasHeight,
      region,
      clearBits: gl.COLOR_BUFFER_BIT,
      paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
    });
    bindEffectOutputFramebuffer(sourceFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, backdropFBO.value!.texture);
    gl.copyTexSubImage2D(
      gl.TEXTURE_2D,
      0,
      copyRegion.textureX,
      copyRegion.textureY,
      copyRegion.sourceX,
      copyRegion.sourceY,
      copyRegion.width,
      copyRegion.height,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    bindEffectOutputFramebuffer(restoreFramebuffer);
    return backdropFBO.value!;
  }

  function ensureBlitProgram(): void {
    ensureEffectShaders();
  }

  function requireProgram(program: WebGLProgram | null, label: string): WebGLProgram {
    if (!program) {
      throw new Error(`WebGL effects renderer failed to initialize ${label} shader program`);
    }
    return program;
  }

  function drawFullscreenQuad(program: WebGLProgram): void {
    if (!fullscreenQuad.value) {
      throw new Error("WebGL effects renderer fullscreen quad buffer is not initialized");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, fullscreenQuad.value);
    const posLoc = requireAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function regionCopyQuadVertices({
    canvasWidth,
    canvasHeight,
    sourceRegion,
    targetRegion,
    sourceFramebuffer,
  }: {
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly sourceRegion: WebGLEffectRenderRegion;
    readonly targetRegion: WebGLEffectRenderRegion;
    readonly sourceFramebuffer: Framebuffer;
  }): Float32Array {
    const targetLeft = (targetRegion.x / canvasWidth) * 2 - 1;
    const targetRight = ((targetRegion.x + targetRegion.width) / canvasWidth) * 2 - 1;
    const targetBottom = (targetRegion.y / canvasHeight) * 2 - 1;
    const targetTop = ((targetRegion.y + targetRegion.height) / canvasHeight) * 2 - 1;
    const sourceLeft = sourceRegion.x / sourceFramebuffer.width;
    const sourceRight = (sourceRegion.x + sourceRegion.width) / sourceFramebuffer.width;
    const sourceBottom = sourceRegion.y / sourceFramebuffer.height;
    const sourceTop = (sourceRegion.y + sourceRegion.height) / sourceFramebuffer.height;
    return new Float32Array([
      targetLeft, targetBottom, sourceLeft, sourceBottom,
      targetRight, targetBottom, sourceRight, sourceBottom,
      targetLeft, targetTop, sourceLeft, sourceTop,
      targetRight, targetTop, sourceRight, sourceTop,
    ]);
  }

  function drawRegionCopyQuad(
    program: WebGLProgram,
    vertices: Float32Array,
  ): void {
    if (regionCopyQuad.value === null) {
      throw new Error("WebGL effects renderer region copy quad buffer is not initialized");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, regionCopyQuad.value);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    const positionLocation = requireAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    const textureCoordinateLocation = requireAttribLocation(program, "a_texCoord");
    gl.enableVertexAttribArray(textureCoordinateLocation);
    gl.vertexAttribPointer(textureCoordinateLocation, 2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function currentRendererOutputEffectRegion(region: WebGLEffectRenderRegion): WebGLEffectRenderRegion | null {
    if (rendererOutputRegion.value === null) {
      return region;
    }
    return intersectWebGLEffectRenderRegions(region, rendererOutputRegion.value);
  }

  function withEffectRegion<T>(
    region: WebGLEffectRenderRegion,
    operation: () => T,
  ): T {
    const previous = snapshotEffectScissorState();
    const effectiveRegion = currentRendererOutputEffectRegion(region);
    setEffectScissorEnabled(true);
    if (effectiveRegion === null) {
      setEffectScissorBox({ x: 0, y: 0, width: 0, height: 0 });
    } else {
      setEffectScissorBox(effectiveRegion);
    }
    try {
      return operation();
    } finally {
      restoreEffectScissorState(previous);
    }
  }

  function webGLEffectShaderSamplingRegion(
    region: WebGLEffectRenderRegion,
    canvasWidth: number,
    canvasHeight: number,
    paddingInBackingPixels: number,
  ): WebGLEffectRenderRegion {
    return expandWebGLEffectRenderRegionForShaderSampling({
      region,
      canvasWidth,
      canvasHeight,
      paddingInBackingPixels,
    });
  }

  function clearWebGLEffectFramebufferRegion({
    framebuffer,
    canvasWidth,
    canvasHeight,
    region,
    clearBits,
    paddingInBackingPixels,
  }: {
    readonly framebuffer: Framebuffer;
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly region: WebGLEffectRenderRegion;
    readonly clearBits: number;
    readonly paddingInBackingPixels: number;
  }): void {
    bindFramebuffer(gl, framebuffer);
    withEffectRegion(webGLEffectShaderSamplingRegion(region, canvasWidth, canvasHeight, paddingInBackingPixels), () => {
      gl.clear(clearBits);
    });
  }

  function withStencilDisabled<T>(restoreStencilTest: boolean, operation: () => T): T {
    gl.disable(gl.STENCIL_TEST);
    try {
      return operation();
    } finally {
      if (restoreStencilTest) {
        gl.enable(gl.STENCIL_TEST);
      }
    }
  }

  function withBlendDisabled<T>(restoreBlend: boolean, operation: () => T): T {
    gl.disable(gl.BLEND);
    try {
      return operation();
    } finally {
      if (restoreBlend) {
        gl.enable(gl.BLEND);
      }
    }
  }

  function drawBlurPass(
    { sourceTexture, width, height, dirX, dirY, radius, inputAlphaMode }: {
      sourceTexture: WebGLTexture;
      width: number;
      height: number;
      dirX: number;
      dirY: number;
      radius: number;
      inputAlphaMode: WebGLTextureAlphaMode;
    }
  ): void {
    const program = requireProgram(blurProgram.value, "gaussian blur");
    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);

    gl.uniform2f(requireUniformLocation(program, "u_direction"), dirX, dirY);
    gl.uniform2f(requireUniformLocation(program, "u_texelSize"), 1.0 / width, 1.0 / height);
    gl.uniform1f(requireUniformLocation(program, "u_radius"), radius);
    gl.uniform1f(requireUniformLocation(program, "u_premultipliedInput"), inputAlphaMode === "premultiplied" ? 1 : 0);

    drawFullscreenQuad(program);
  }

  function renderEffectFramebufferRegionIntoTemporaryFramebuffer(
    source: Framebuffer,
    region: WebGLEffectRenderRegion,
    requireClipStencil: boolean,
  ): Framebuffer {
    const target = source === tempFBO1.value ? tempFBO2.value! : tempFBO1.value!;
    copyEffectFramebufferRegion({
      source,
      target,
      region,
      premultipliedInput: true,
      restoreStencilTest: requireClipStencil,
    });

    bindFramebuffer(gl, null);
    return target;
  }

  function copyEffectFramebufferRegion({
    source,
    target,
    region,
    premultipliedInput,
    restoreStencilTest,
  }: {
    readonly source: Framebuffer;
    readonly target: Framebuffer;
    readonly region: WebGLEffectRenderRegion;
    readonly premultipliedInput: boolean;
    readonly restoreStencilTest: boolean;
  }): void {
    ensureResources(source.width, source.height);
    ensureBlitProgram();

    withStencilDisabled(restoreStencilTest, () => {
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      clearWebGLEffectFramebufferRegion({
        framebuffer: target,
        canvasWidth: source.width,
        canvasHeight: source.height,
        region,
        clearBits: gl.COLOR_BUFFER_BIT,
        paddingInBackingPixels: 0,
      });

      const program = requireProgram(blitProgram.value, "effect framebuffer region copy");
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);
      gl.uniform1f(requireUniformLocation(program, "u_opacity"), 1.0);
      gl.uniform1f(requireUniformLocation(program, "u_premultipliedInput"), premultipliedInput ? 1.0 : 0.0);
      withBlendDisabled(true, () => {
        withEffectRegion(region, () => {
          drawFullscreenQuad(program);
        });
      });
    });
  }

  function replaceFramebufferRegionWithBinarizedAlpha({
    framebuffer,
    region,
    restoreStencilTest,
  }: {
    readonly framebuffer: Framebuffer;
    readonly region: WebGLEffectRenderRegion;
    readonly restoreStencilTest: boolean;
  }): void {
    ensureResources(framebuffer.width, framebuffer.height);
    const program = requireProgram(alphaBinarizeProgram.value, "alpha binarize");
    const target = framebuffer === tempFBO1.value ? tempFBO2.value! : tempFBO1.value!;

    withStencilDisabled(restoreStencilTest, () => {
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      clearWebGLEffectFramebufferRegion({
        framebuffer: target,
        canvasWidth: framebuffer.width,
        canvasHeight: framebuffer.height,
        region,
        clearBits: gl.COLOR_BUFFER_BIT,
        paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
      });

      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, framebuffer.texture);
      gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);
      withBlendDisabled(true, () => {
        withEffectRegion(region, () => {
          drawFullscreenQuad(program);
        });
      });
    });

    copyEffectFramebufferRegion({
      source: target,
      target: framebuffer,
      region,
      premultipliedInput: false,
      restoreStencilTest,
    });
  }

  function applyGaussianBlurWithStencilRestore(
    source: Framebuffer,
    radius: number,
    region: WebGLEffectRenderRegion,
    restoreStencilTest: boolean,
    inputAlphaMode: WebGLTextureAlphaMode,
  ): Framebuffer {
    ensureResources(source.width, source.height);

    const sigmaTotal = resolveFigmaBlurStdDeviation(radius);
    if (!shouldRunWebGLGaussianBlurForSigma(sigmaTotal)) {
      return source;
    }
    const maxSigmaPerPass = 3;
    const numPasses = Math.max(1, Math.ceil(sigmaTotal / maxSigmaPerPass));
    const sigmaPerPass = sigmaTotal / Math.sqrt(numPasses);

    const width = source.width;
    const height = source.height;
    const currentSourceRef = { value: source as Framebuffer };
    const currentInputAlphaMode = { value: inputAlphaMode };

    withStencilDisabled(restoreStencilTest, () => {
      for (let p = 0; p < numPasses; p++) {
        const horizontalTarget = currentSourceRef.value === tempFBO1.value ? tempFBO2.value! : tempFBO1.value!;
        const verticalTarget = horizontalTarget === tempFBO1.value ? tempFBO2.value! : tempFBO1.value!;
        const horizontalInputAlphaMode = currentInputAlphaMode.value;

        gl.colorMask(true, true, true, true);
        gl.clearColor(0, 0, 0, 0);
        clearWebGLEffectFramebufferRegion({
          framebuffer: horizontalTarget,
          canvasWidth: width,
          canvasHeight: height,
          region,
          clearBits: gl.COLOR_BUFFER_BIT,
          paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
        });
        withEffectRegion(region, () => {
          drawBlurPass({
            sourceTexture: currentSourceRef.value.texture,
            width,
            height,
            dirX: 1,
            dirY: 0,
            radius: sigmaPerPass,
            inputAlphaMode: horizontalInputAlphaMode,
          });
        });

        gl.colorMask(true, true, true, true);
        gl.clearColor(0, 0, 0, 0);
        clearWebGLEffectFramebufferRegion({
          framebuffer: verticalTarget,
          canvasWidth: width,
          canvasHeight: height,
          region,
          clearBits: gl.COLOR_BUFFER_BIT,
          paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
        });
        withEffectRegion(region, () => {
          drawBlurPass({
            sourceTexture: horizontalTarget.texture,
            width,
            height,
            dirX: 0,
            dirY: 1,
            radius: sigmaPerPass,
            inputAlphaMode: "straight",
          });
        });

        currentSourceRef.value = verticalTarget;
        currentInputAlphaMode.value = "straight";
      }
    });

    bindFramebuffer(gl, null);

    return currentSourceRef.value;
  }

  function applyGaussianBlur({
    source,
    radius,
    region,
    inputAlphaMode,
  }: {
    readonly source: Framebuffer;
    readonly radius: number;
    readonly region: WebGLEffectRenderRegion;
    readonly inputAlphaMode: WebGLTextureAlphaMode;
  }): Framebuffer {
    return applyGaussianBlurWithStencilRestore(source, radius, region, false, inputAlphaMode);
  }

  function applyAlphaMorphologyWithStencilRestore(
    source: Framebuffer,
    spread: number,
    region: WebGLEffectRenderRegion,
    restoreStencilTest: boolean,
  ): Framebuffer {
    ensureResources(source.width, source.height);
    if (spread === 0) { return source; }
    const program = requireProgram(morphologyProgram.value, "alpha morphology");
    const target = source === tempFBO1.value ? tempFBO2.value! : tempFBO1.value!;

    withStencilDisabled(restoreStencilTest, () => {
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      clearWebGLEffectFramebufferRegion({
        framebuffer: target,
        canvasWidth: source.width,
        canvasHeight: source.height,
        region,
        clearBits: gl.COLOR_BUFFER_BIT,
        paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
      });

      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);
      gl.uniform2f(requireUniformLocation(program, "u_texelSize"), 1.0 / source.width, 1.0 / source.height);
      gl.uniform1f(requireUniformLocation(program, "u_radius"), Math.abs(spread));
      gl.uniform1f(requireUniformLocation(program, "u_operator"), spread > 0 ? 1 : 0);
      withEffectRegion(region, () => {
        drawFullscreenQuad(program);
      });
    });

    bindFramebuffer(gl, null);
    return target;
  }

  function applyEffectSpread(
    source: Framebuffer,
    spread: number | undefined,
    worldToBacking: EffectBackingScale,
    region: WebGLEffectRenderRegion,
    restoreStencilTest: boolean,
  ): Framebuffer {
    if (spread === undefined || spread === 0) {
      return source;
    }
    return applyAlphaMorphologyWithStencilRestore(source, spread * worldToBacking.lengthScale, region, restoreStencilTest);
  }

  function applyInnerShadowSpread(
    source: Framebuffer,
    spread: number | undefined,
    worldToBacking: EffectBackingScale,
    region: WebGLEffectRenderRegion,
    restoreStencilTest: boolean,
  ): Framebuffer {
    if (spread === undefined || spread === 0) {
      return source;
    }
    return applyAlphaMorphologyWithStencilRestore(source, -spread * worldToBacking.lengthScale, region, restoreStencilTest);
  }

  function prepareInnerShadowSilhouette(
    { canvasWidth, canvasHeight, region, renderSilhouette }: {
      readonly canvasWidth: number;
      readonly canvasHeight: number;
      readonly region: WebGLEffectRenderRegion;
      readonly renderSilhouette: () => void;
    },
  ): void {
    ensureResources(canvasWidth, canvasHeight);
    ensureShapeFBO(canvasWidth, canvasHeight);
    ensureInnerShadowProgram();

    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    clearWebGLEffectFramebufferRegion({
      framebuffer: shapeFBO.value!,
      canvasWidth,
      canvasHeight,
      region,
      clearBits: gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT,
      paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
    });
    withEffectRegion(region, renderSilhouette);
    replaceFramebufferRegionWithBinarizedAlpha({
      framebuffer: shapeFBO.value!,
      region,
      restoreStencilTest: false,
    });
  }

  function resolvePreparedInnerShadowBlurSource(
    { effect, worldToBacking, region, requireClipStencil }: {
      readonly effect: InnerShadowEffect;
      readonly worldToBacking: EffectBackingScale;
      readonly region: WebGLEffectRenderRegion;
      readonly requireClipStencil: boolean;
    },
  ): Framebuffer {
    const spreadSource = applyInnerShadowSpread(shapeFBO.value!, effect.spread, worldToBacking, region, requireClipStencil);
    if (effect.radius > 0) {
      return applyGaussianBlurWithStencilRestore(
        spreadSource,
        effect.radius * worldToBacking.lengthScale,
        region,
        requireClipStencil,
        "premultiplied",
      );
    }
    return spreadSource;
  }

  function renderPreparedInnerShadow(
    { canvasWidth, canvasHeight, region, effect, resolvedNodeOpacity, worldToBacking, blurredSourceFramebuffer, outputFramebuffer, backdropFramebuffer }: {
      readonly canvasWidth: number;
      readonly canvasHeight: number;
      readonly region: WebGLEffectRenderRegion;
      readonly effect: InnerShadowEffect;
      readonly resolvedNodeOpacity: number;
      readonly worldToBacking: EffectBackingScale;
      readonly blurredSourceFramebuffer: Framebuffer;
      readonly outputFramebuffer: WebGLFramebuffer | null;
      readonly backdropFramebuffer: WebGLFramebuffer | null;
    },
  ): void {
    const resolvedEffectAlpha = resolveWebGLEffectCompositeAlpha(effect.color.a, resolvedNodeOpacity);

    bindEffectOutputFramebuffer(outputFramebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);

    const program = requireProgram(innerShadowProgram.value, "inner shadow");

    // Same world→backing-pixel offset conversion as drop shadow above.
    const offsetBacking = applyEffectOffsetScale(worldToBacking, effect.offset.x, effect.offset.y);

    const blendModeCode = effectBlendModeToShaderCode(effect.blendMode);
    if (blendModeCode !== 0) {
      const maskTarget = blurredSourceFramebuffer === tempFBO1.value ? tempFBO2.value! : tempFBO1.value!;
      gl.viewport(0, 0, canvasWidth, canvasHeight);
      gl.clearColor(0, 0, 0, 0);
      clearWebGLEffectFramebufferRegion({
        framebuffer: maskTarget,
        canvasWidth,
        canvasHeight,
        region,
        clearBits: gl.COLOR_BUFFER_BIT,
        paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
      });
      gl.useProgram(program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, shapeFBO.value!.texture);
      gl.uniform1i(requireUniformLocation(program, "u_shapeTexture"), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurredSourceFramebuffer.texture);
      gl.uniform1i(requireUniformLocation(program, "u_blurredTexture"), 1);

      gl.uniform4f(requireUniformLocation(program, "u_color"), 1, 1, 1, 1);
      gl.uniform2f(
        requireUniformLocation(program, "u_offset"),
        -offsetBacking.x,
        offsetBacking.y
      );
      gl.uniform2f(
        requireUniformLocation(program, "u_texelSize"),
        1.0 / canvasWidth,
        1.0 / canvasHeight
      );
      withEffectRegion(region, () => {
        drawFullscreenQuad(program);
      });

      bindEffectOutputFramebuffer(outputFramebuffer);
      gl.viewport(0, 0, canvasWidth, canvasHeight);
      const backdrop = copyFramebufferToBackdrop(canvasWidth, canvasHeight, region, backdropFramebuffer, outputFramebuffer);
      bindEffectOutputFramebuffer(outputFramebuffer);
      const blendProgram = requireProgram(blendShadowProgram.value, "inner shadow blend");
      gl.useProgram(blendProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, maskTarget.texture);
      gl.uniform1i(requireUniformLocation(blendProgram, "u_shadowTexture"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, shapeFBO.value!.texture);
      gl.uniform1i(requireUniformLocation(blendProgram, "u_shapeTexture"), 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, backdrop.texture);
      gl.uniform1i(requireUniformLocation(blendProgram, "u_backdropTexture"), 2);
      gl.uniform4f(requireUniformLocation(blendProgram, "u_color"), effect.color.r, effect.color.g, effect.color.b, resolvedEffectAlpha);
      gl.uniform2f(requireUniformLocation(blendProgram, "u_offset"), 0, 0);
      gl.uniform2f(requireUniformLocation(blendProgram, "u_texelSize"), 1.0 / canvasWidth, 1.0 / canvasHeight);
      gl.uniform1f(requireUniformLocation(blendProgram, "u_clipInside"), 0);
      gl.uniform1i(requireUniformLocation(blendProgram, "u_blendMode"), blendModeCode);
      gl.disable(gl.BLEND);
      withEffectRegion(region, () => {
        drawFullscreenQuad(blendProgram);
      });
      gl.enable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      return;
    }

    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shapeFBO.value!.texture);
    gl.uniform1i(requireUniformLocation(program, "u_shapeTexture"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurredSourceFramebuffer.texture);
    gl.uniform1i(requireUniformLocation(program, "u_blurredTexture"), 1);

    gl.uniform4f(
      requireUniformLocation(program, "u_color"),
      effect.color.r, effect.color.g, effect.color.b, resolvedEffectAlpha
    );

    gl.uniform2f(
      requireUniformLocation(program, "u_offset"),
      -offsetBacking.x,
      offsetBacking.y
    );

    gl.uniform2f(
      requireUniformLocation(program, "u_texelSize"),
      1.0 / canvasWidth,
      1.0 / canvasHeight
    );

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE, gl.ONE_MINUS_SRC_ALPHA
    );
    withEffectRegion(region, () => {
      drawFullscreenQuad(program);
    });

    gl.activeTexture(gl.TEXTURE0);
  }

  function renderBlendedShapeContent(
    { canvasWidth, canvasHeight, region, blendMode, outputFramebuffer, backdropFramebuffer, requireClipStencil, renderContent }: {
      readonly canvasWidth: number;
      readonly canvasHeight: number;
      readonly region: WebGLEffectRenderRegion;
      readonly blendMode: BlendMode;
      readonly outputFramebuffer: WebGLFramebuffer | null;
      readonly backdropFramebuffer: WebGLFramebuffer | null;
      readonly requireClipStencil: boolean;
      readonly renderContent: () => void;
    },
  ): void {
    const blendModeCode = cssBlendModeToShaderCode(blendMode);
    if (blendModeCode === 0) {
      renderContent();
      return;
    }
    ensureResources(canvasWidth, canvasHeight);
    ensureShapeFBO(canvasWidth, canvasHeight);

    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    clearWebGLEffectFramebufferRegion({
      framebuffer: shapeFBO.value!,
      canvasWidth,
      canvasHeight,
      region,
      clearBits: gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT,
      paddingInBackingPixels: 0,
    });
    withStencilDisabled(requireClipStencil, () => {
      withBlendDisabled(true, () => {
        bindFramebuffer(gl, shapeFBO.value!);
        withEffectRegion(region, renderContent);
      });
    });

    const backdrop = copyFramebufferToBackdrop(canvasWidth, canvasHeight, region, backdropFramebuffer, outputFramebuffer);
    bindEffectOutputFramebuffer(outputFramebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    if (requireClipStencil) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0x00);
      gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    } else {
      gl.disable(gl.STENCIL_TEST);
    }

    const program = requireProgram(blendContentProgram.value, "content blend");
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shapeFBO.value!.texture);
    gl.uniform1i(requireUniformLocation(program, "u_sourceTexture"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, backdrop.texture);
    gl.uniform1i(requireUniformLocation(program, "u_backdropTexture"), 1);
    gl.uniform1i(requireUniformLocation(program, "u_blendMode"), blendModeCode);
    gl.uniform1f(requireUniformLocation(program, "u_sourcePremultipliedInput"), 0.0);
    gl.disable(gl.BLEND);
    withEffectRegion(region, () => {
      drawFullscreenQuad(program);
    });
    gl.enable(gl.BLEND);
    if (!requireClipStencil) {
      gl.disable(gl.STENCIL_TEST);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  function blendCapturedLayer(
    { canvasWidth, canvasHeight, region, sourceFramebuffer, blendMode, outputFramebuffer, backdropFramebuffer, requireClipStencil }: {
      readonly canvasWidth: number;
      readonly canvasHeight: number;
      readonly region: WebGLEffectRenderRegion;
      readonly sourceFramebuffer: Framebuffer;
      readonly blendMode: BlendMode;
      readonly outputFramebuffer: WebGLFramebuffer | null;
      readonly backdropFramebuffer: WebGLFramebuffer | null;
      readonly requireClipStencil: boolean;
    },
  ): void {
    const blendModeCode = cssBlendModeToShaderCode(blendMode);
    if (blendModeCode === 0) {
      throw new Error(`blendCapturedLayer requires a browser-rendered non-normal blend mode, got ${blendMode}`);
    }
    ensureResources(canvasWidth, canvasHeight);

    const backdrop = copyFramebufferToBackdrop(canvasWidth, canvasHeight, region, backdropFramebuffer, outputFramebuffer);
    bindEffectOutputFramebuffer(outputFramebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    if (requireClipStencil) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0x00);
      gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    } else {
      gl.disable(gl.STENCIL_TEST);
    }

    const program = requireProgram(blendContentProgram.value, "captured layer blend");
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceFramebuffer.texture);
    gl.uniform1i(requireUniformLocation(program, "u_sourceTexture"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, backdrop.texture);
    gl.uniform1i(requireUniformLocation(program, "u_backdropTexture"), 1);
    gl.uniform1i(requireUniformLocation(program, "u_blendMode"), blendModeCode);
    gl.uniform1f(requireUniformLocation(program, "u_sourcePremultipliedInput"), 1.0);
    gl.disable(gl.BLEND);
    withEffectRegion(region, () => {
      drawFullscreenQuad(program);
    });
    gl.enable(gl.BLEND);
    if (!requireClipStencil) {
      gl.disable(gl.STENCIL_TEST);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  return {
    precompileShaders(): void {
      ensureEffectShaders();
    },

    prepareSurface({ canvasWidth, canvasHeight }: { readonly canvasWidth: number; readonly canvasHeight: number }): void {
      ensureResources(canvasWidth, canvasHeight);
      ensureShapeFBO(canvasWidth, canvasHeight);
      ensureLayerCaptureFramebuffer(canvasWidth, canvasHeight, 0);
      ensureBackdropFBO(canvasWidth, canvasHeight);
    },

    setRendererOutputRegion(region: WebGLEffectRenderRegion | null): void {
      rendererOutputRegion.value = region;
    },

    renderDropShadow(
      { canvasWidth, canvasHeight, region, effect, resolvedNodeOpacity, worldToBacking, outputFramebuffer, backdropFramebuffer, requireClipStencil, renderSilhouette }: { canvasWidth: number; canvasHeight: number; region: WebGLEffectRenderRegion; effect: DropShadowEffect; resolvedNodeOpacity: number; worldToBacking: EffectBackingScale; outputFramebuffer: WebGLFramebuffer | null; backdropFramebuffer: WebGLFramebuffer | null; requireClipStencil: boolean; renderSilhouette: () => void }
    ): void {
      const resolvedEffectAlpha = resolveWebGLEffectCompositeAlpha(effect.color.a, resolvedNodeOpacity);
      ensureResources(canvasWidth, canvasHeight);
      ensureShapeFBO(canvasWidth, canvasHeight);

      gl.viewport(0, 0, canvasWidth, canvasHeight);
      gl.clearColor(0, 0, 0, 0);
      clearWebGLEffectFramebufferRegion({
        framebuffer: shapeFBO.value!,
        canvasWidth,
        canvasHeight,
        region,
        clearBits: gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT,
        paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
      });
      withEffectRegion(region, renderSilhouette);
      replaceFramebufferRegionWithBinarizedAlpha({
        framebuffer: shapeFBO.value!,
        region,
        restoreStencilTest: requireClipStencil,
      });

      const spreadSource = applyEffectSpread(shapeFBO.value!, effect.spread, worldToBacking, region, requireClipStencil);
      const resultFBORef = { value: undefined as Framebuffer | undefined };
      if (effect.radius > 0) {
        resultFBORef.value = applyGaussianBlurWithStencilRestore(
          spreadSource,
          effect.radius * worldToBacking.lengthScale,
          region,
          requireClipStencil,
          "premultiplied",
        );
      } else {
        resultFBORef.value = spreadSource;
      }

      bindEffectOutputFramebuffer(outputFramebuffer);
      gl.viewport(0, 0, canvasWidth, canvasHeight);

      // World-space offset → backing-pixel offset. The texCoord sampling
      // convention in the composite/blend shaders below: world +x is
      // +texCoord.x, world +y is +texCoord.y (the silhouette was rendered
      // with Y-flip into the FBO, so texture-up == world-y=0). To sample
      // the silhouette at the shadow's source position, x is negated.
      const offsetBacking = applyEffectOffsetScale(worldToBacking, effect.offset.x, effect.offset.y);

      const blendModeCode = effectBlendModeToShaderCode(effect.blendMode);
      if (blendModeCode !== 0) {
        const backdrop = copyFramebufferToBackdrop(canvasWidth, canvasHeight, region, backdropFramebuffer, outputFramebuffer);
        bindEffectOutputFramebuffer(outputFramebuffer);
        const programForBlend = requireProgram(blendShadowProgram.value, "drop shadow blend");
        gl.useProgram(programForBlend);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, resultFBORef.value.texture);
        gl.uniform1i(requireUniformLocation(programForBlend, "u_shadowTexture"), 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, shapeFBO.value!.texture);
        gl.uniform1i(requireUniformLocation(programForBlend, "u_shapeTexture"), 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, backdrop.texture);
        gl.uniform1i(requireUniformLocation(programForBlend, "u_backdropTexture"), 2);

        gl.uniform4f(
          requireUniformLocation(programForBlend, "u_color"),
          effect.color.r, effect.color.g, effect.color.b, resolvedEffectAlpha
        );
        gl.uniform2f(
          requireUniformLocation(programForBlend, "u_offset"),
          -offsetBacking.x,
          offsetBacking.y
        );
        gl.uniform2f(
          requireUniformLocation(programForBlend, "u_texelSize"),
          1.0 / canvasWidth,
          1.0 / canvasHeight
        );
        gl.uniform1f(requireUniformLocation(programForBlend, "u_clipInside"), effect.showShadowBehindNode === false ? 1 : 0);
        gl.uniform1i(requireUniformLocation(programForBlend, "u_blendMode"), blendModeCode);

        gl.disable(gl.BLEND);
        withEffectRegion(region, () => {
          drawFullscreenQuad(programForBlend);
        });
        gl.enable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        return;
      }

      const program = requireProgram(compositeProgram.value, "drop shadow composite");
      gl.useProgram(program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resultFBORef.value.texture);
      gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, shapeFBO.value!.texture);
      gl.uniform1i(requireUniformLocation(program, "u_shapeTexture"), 1);

      gl.uniform4f(
        requireUniformLocation(program, "u_color"),
        effect.color.r, effect.color.g, effect.color.b, resolvedEffectAlpha
      );

      gl.uniform2f(
        requireUniformLocation(program, "u_offset"),
        -offsetBacking.x,
        offsetBacking.y
      );

      gl.uniform2f(
        requireUniformLocation(program, "u_texelSize"),
        1.0 / canvasWidth,
        1.0 / canvasHeight
      );
      gl.uniform1f(requireUniformLocation(program, "u_clipInside"), effect.showShadowBehindNode === false ? 1 : 0);

      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );
      withEffectRegion(region, () => {
        drawFullscreenQuad(program);
      });
      gl.activeTexture(gl.TEXTURE0);
    },

    renderInnerShadow(
      { canvasWidth, canvasHeight, region, effect, resolvedNodeOpacity, worldToBacking, outputFramebuffer, backdropFramebuffer, requireClipStencil, renderSilhouette }: { canvasWidth: number; canvasHeight: number; region: WebGLEffectRenderRegion; effect: InnerShadowEffect; resolvedNodeOpacity: number; worldToBacking: EffectBackingScale; outputFramebuffer: WebGLFramebuffer | null; backdropFramebuffer: WebGLFramebuffer | null; requireClipStencil: boolean; renderSilhouette: () => void }
    ): void {
      prepareInnerShadowSilhouette({ canvasWidth, canvasHeight, region, renderSilhouette });
      const blurredSourceFramebuffer = resolvePreparedInnerShadowBlurSource({
        effect,
        worldToBacking,
        region,
        requireClipStencil,
      });
      renderPreparedInnerShadow({
        canvasWidth,
        canvasHeight,
        region,
        effect,
        resolvedNodeOpacity,
        worldToBacking,
        blurredSourceFramebuffer,
        outputFramebuffer,
        backdropFramebuffer,
      });
    },

    renderInnerShadows(
      { canvasWidth, canvasHeight, region, effects, resolvedNodeOpacity, worldToBacking, outputFramebuffer, backdropFramebuffer, requireClipStencil, renderSilhouette }: { canvasWidth: number; canvasHeight: number; region: WebGLEffectRenderRegion; effects: readonly InnerShadowEffect[]; resolvedNodeOpacity: number; worldToBacking: EffectBackingScale; outputFramebuffer: WebGLFramebuffer | null; backdropFramebuffer: WebGLFramebuffer | null; requireClipStencil: boolean; renderSilhouette: () => void }
    ): void {
      if (effects.length === 0) {
        return;
      }
      prepareInnerShadowSilhouette({ canvasWidth, canvasHeight, region, renderSilhouette });
      for (const run of resolveConsecutiveInnerShadowBlurSourceRuns(effects)) {
        const representativeEffect = run.effects[0];
        if (representativeEffect === undefined) {
          throw new Error("WebGL inner shadow blur source run contains no effects");
        }
        const blurredSourceFramebuffer = resolvePreparedInnerShadowBlurSource({
          effect: representativeEffect,
          worldToBacking,
          region,
          requireClipStencil,
        });
        for (const effect of run.effects) {
          renderPreparedInnerShadow({
            canvasWidth,
            canvasHeight,
            region,
            effect,
            resolvedNodeOpacity,
            worldToBacking,
            blurredSourceFramebuffer,
            outputFramebuffer,
            backdropFramebuffer,
          });
        }
      }
    },

    renderBlendedSolidShape(
      { canvasWidth, canvasHeight, region, blendMode, outputFramebuffer, backdropFramebuffer, requireClipStencil, renderShape }: { readonly canvasWidth: number; readonly canvasHeight: number; readonly region: WebGLEffectRenderRegion; readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }; readonly opacity: number; readonly blendMode: BlendMode; readonly outputFramebuffer: WebGLFramebuffer | null; readonly backdropFramebuffer: WebGLFramebuffer | null; readonly requireClipStencil: boolean; readonly renderShape: () => void }
    ): void {
      renderBlendedShapeContent({
        canvasWidth,
        canvasHeight,
        region,
        blendMode,
        outputFramebuffer,
        backdropFramebuffer,
        requireClipStencil,
        renderContent: renderShape,
      });
    },

    blendCapturedLayer,

    renderBackgroundBlur(
      { canvasWidth, canvasHeight, region, effect, worldToBacking, outputFramebuffer, backdropFramebuffer, requireClipStencil, renderMask }: {
        canvasWidth: number; canvasHeight: number; region: WebGLEffectRenderRegion; effect: BackgroundBlurEffect; worldToBacking: EffectBackingScale; outputFramebuffer: WebGLFramebuffer | null; backdropFramebuffer: WebGLFramebuffer | null; requireClipStencil: boolean; renderMask: () => void;
      }
    ): void {
      ensureResources(canvasWidth, canvasHeight);
      ensureBlitProgram();

      const backdrop = copyFramebufferToBackdrop(canvasWidth, canvasHeight, region, backdropFramebuffer, outputFramebuffer);
      const blurred = applyGaussianBlurWithStencilRestore(
        backdrop,
        effect.radius * worldToBacking.lengthScale,
        region,
        false,
        "premultiplied",
      );

      bindEffectOutputFramebuffer(outputFramebuffer);
      gl.viewport(0, 0, canvasWidth, canvasHeight);

      gl.enable(gl.STENCIL_TEST);
      gl.colorMask(false, false, false, false);
      gl.stencilMask(FILL_STENCIL_MASK);
      gl.stencilFunc(gl.ALWAYS, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      withEffectRegion(region, renderMask);

      gl.colorMask(true, true, true, true);
      gl.stencilMask(0x00);
      if (requireClipStencil) {
        gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT | FILL_STENCIL_MASK, 0xff);
      } else {
        gl.stencilFunc(gl.EQUAL, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
      }
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

      const program = requireProgram(blitProgram.value, "background blur blit");
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, blurred.texture);
      gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);
      gl.uniform1f(requireUniformLocation(program, "u_opacity"), 1.0);
      gl.uniform1f(requireUniformLocation(program, "u_premultipliedInput"), 0.0);
      gl.disable(gl.BLEND);
      withEffectRegion(region, () => {
        drawFullscreenQuad(program);
      });
      gl.enable(gl.BLEND);

      gl.colorMask(false, false, false, false);
      gl.stencilMask(FILL_STENCIL_MASK);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
      withEffectRegion(region, renderMask);

      gl.colorMask(true, true, true, true);
      gl.stencilMask(0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      if (requireClipStencil) {
        gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      } else {
        gl.disable(gl.STENCIL_TEST);
      }
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );
    },

    beginLayerCapture({ canvasWidth, canvasHeight, region }: BeginWebGLEffectLayerCaptureParams): WebGLEffectLayerCapture {
      const depth = activeLayerCaptureDepth.value;
      const framebuffer = ensureLayerCaptureFramebuffer(canvasWidth, canvasHeight, depth);
      activeLayerCaptureDepth.value = depth + 1;

      gl.viewport(0, 0, canvasWidth, canvasHeight);
      gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0xff);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      clearWebGLEffectFramebufferRegion({
        framebuffer,
        canvasWidth,
        canvasHeight,
        region,
        clearBits: gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT,
        paddingInBackingPixels: EFFECT_SHADER_SAMPLE_PADDING_IN_BACKING_PIXELS,
      });

      return { framebuffer, depth };
    },

    releaseLayerCapture,

    endLayerCaptureAndBlur(
      { canvasWidth, canvasHeight, region, sourceFramebuffer, effect, worldToBacking, outputFramebuffer, requireClipStencil }: { canvasWidth: number; canvasHeight: number; region: WebGLEffectRenderRegion; sourceFramebuffer: Framebuffer; effect: LayerBlurEffect; worldToBacking: EffectBackingScale; outputFramebuffer: WebGLFramebuffer | null; requireClipStencil: boolean }
    ): void {
      ensureResources(canvasWidth, canvasHeight);
      ensureBlitProgram();

      const blurred = applyGaussianBlurWithStencilRestore(
        sourceFramebuffer,
        effect.radius * worldToBacking.lengthScale,
        region,
        requireClipStencil,
        "premultiplied",
      );

      bindEffectOutputFramebuffer(outputFramebuffer);
      gl.viewport(0, 0, canvasWidth, canvasHeight);

      const program = requireProgram(blitProgram.value, "layer blur blit");
      gl.useProgram(program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, blurred.texture);
      gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);
      gl.uniform1f(requireUniformLocation(program, "u_opacity"), 1.0);
      gl.uniform1f(requireUniformLocation(program, "u_premultipliedInput"), 0.0);

      // gaussianBlurFragmentShader returns straight-alpha RGBA: it blurs in
      // premultiplied space, then un-premultiplies before writing. The blit
      // must therefore use the same straight-alpha blend contract as normal
      // layer compositing.
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );
      withEffectRegion(region, () => {
        drawFullscreenQuad(program);
      });

      // Restore standard non-premultiplied blending for subsequent draws
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );
    },

    blitLayerWithOpacity(
      { canvasWidth, canvasHeight, region, sourceFramebuffer, opacity, outputFramebuffer, requireClipStencil }: { canvasWidth: number; canvasHeight: number; region: WebGLEffectRenderRegion; sourceFramebuffer: Framebuffer; opacity: number; outputFramebuffer: WebGLFramebuffer | null; requireClipStencil: boolean }
    ): void {
      ensureResources(canvasWidth, canvasHeight);
      ensureBlitProgram();

      const copied = renderEffectFramebufferRegionIntoTemporaryFramebuffer(sourceFramebuffer, region, requireClipStencil);

      bindEffectOutputFramebuffer(outputFramebuffer);
      gl.viewport(0, 0, canvasWidth, canvasHeight);

      const program = requireProgram(blitProgram.value, "group opacity blit");
      gl.useProgram(program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, copied.texture);
      gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);
      gl.uniform1f(requireUniformLocation(program, "u_opacity"), opacity);
      gl.uniform1f(requireUniformLocation(program, "u_premultipliedInput"), 0.0);

      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );
      withEffectRegion(region, () => {
        drawFullscreenQuad(program);
      });

      // Restore standard blending
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );
    },

    copyFramebufferRegionToRegion(
      { canvasWidth, canvasHeight, sourceRegion, targetRegion, sourceFramebuffer, outputFramebuffer }: { readonly canvasWidth: number; readonly canvasHeight: number; readonly sourceRegion: WebGLEffectRenderRegion; readonly targetRegion: WebGLEffectRenderRegion; readonly sourceFramebuffer: Framebuffer; readonly outputFramebuffer: WebGLFramebuffer | null }
    ): void {
      ensureResources(canvasWidth, canvasHeight);
      const program = requireProgram(regionCopyProgram.value, "region copy");
      const vertices = regionCopyQuadVertices({
        canvasWidth,
        canvasHeight,
        sourceRegion,
        targetRegion,
        sourceFramebuffer,
      });

      bindEffectOutputFramebuffer(outputFramebuffer);
      gl.viewport(0, 0, canvasWidth, canvasHeight);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceFramebuffer.texture);
      gl.uniform1i(requireUniformLocation(program, "u_texture"), 0);

      gl.disable(gl.BLEND);
      gl.disable(gl.STENCIL_TEST);
      withEffectRegion(targetRegion, () => {
        drawRegionCopyQuad(program, vertices);
      });
      gl.enable(gl.BLEND);
    },

    applyGaussianBlur,

    dispose(): void {
      if (blurProgram.value) {gl.deleteProgram(blurProgram.value);}
      if (morphologyProgram.value) {gl.deleteProgram(morphologyProgram.value);}
      if (compositeProgram.value) {gl.deleteProgram(compositeProgram.value);}
      if (alphaBinarizeProgram.value) {gl.deleteProgram(alphaBinarizeProgram.value);}
      if (blendShadowProgram.value) {gl.deleteProgram(blendShadowProgram.value);}
      if (blendContentProgram.value) {gl.deleteProgram(blendContentProgram.value);}
      if (innerShadowProgram.value) {gl.deleteProgram(innerShadowProgram.value);}
      if (blitProgram.value) {gl.deleteProgram(blitProgram.value);}
      if (regionCopyProgram.value) {gl.deleteProgram(regionCopyProgram.value);}
      if (fullscreenQuad.value) {gl.deleteBuffer(fullscreenQuad.value);}
      if (regionCopyQuad.value) {gl.deleteBuffer(regionCopyQuad.value);}
      if (tempFBO1.value) {deleteFramebuffer(gl, tempFBO1.value);}
      if (tempFBO2.value) {deleteFramebuffer(gl, tempFBO2.value);}
      if (shapeFBO.value) {deleteFramebuffer(gl, shapeFBO.value);}
      for (const framebuffer of layerCaptureFramebuffers.value) {
        deleteFramebuffer(gl, framebuffer);
      }
      if (backdropFBO.value) {deleteFramebuffer(gl, backdropFBO.value);}
    },
  };
}
