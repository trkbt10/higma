/** @file WebGL effects renderer shader contract tests. */

import {
  alphaBinarizeFragmentShader,
  blendContentFragmentShader,
  blendShadowFragmentShader,
  blitFragmentShader,
  createEffectsRenderer,
  gaussianBlurFragmentShader,
  resolveConsecutiveInnerShadowBlurSourceRuns,
  resolveWebGLEffectCompositeAlpha,
  shouldRunWebGLGaussianBlurForSigma,
} from "./effects-renderer";
import type { InnerShadowEffect } from "@higma-document-renderers/fig/scene-graph";

type EffectsFakeGL = Pick<
  WebGLRenderingContext,
  | "createShader"
  | "shaderSource"
  | "compileShader"
  | "getShaderParameter"
  | "getShaderInfoLog"
  | "deleteShader"
  | "createProgram"
  | "attachShader"
  | "linkProgram"
  | "getProgramParameter"
  | "getProgramInfoLog"
  | "deleteProgram"
  | "createBuffer"
  | "deleteBuffer"
  | "bindBuffer"
  | "bufferData"
> & {
  readonly VERTEX_SHADER: number;
  readonly FRAGMENT_SHADER: number;
  readonly COMPILE_STATUS: number;
  readonly LINK_STATUS: number;
  readonly ARRAY_BUFFER: number;
  readonly STATIC_DRAW: number;
};

type EffectsFakeCalls = {
  shaders: number;
  programs: number;
  buffers: number;
  textures: number;
};

function innerShadowEffect(
  overrides: Partial<InnerShadowEffect> = {},
): InnerShadowEffect {
  return {
    type: "inner-shadow",
    offset: { x: 0, y: 0 },
    radius: 4,
    color: { r: 0, g: 0, b: 0, a: 1 },
    ...overrides,
  };
}

function makeEffectsFakeGL(): { readonly gl: WebGLRenderingContext; readonly calls: EffectsFakeCalls } {
  const calls: EffectsFakeCalls = { shaders: 0, programs: 0, buffers: 0, textures: 0 };
  const gl: EffectsFakeGL = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    createShader: () => {
      calls.shaders += 1;
      return {} as WebGLShader;
    },
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    getShaderInfoLog: () => null,
    deleteShader: () => undefined,
    createProgram: () => {
      calls.programs += 1;
      return {} as WebGLProgram;
    },
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    getProgramInfoLog: () => null,
    deleteProgram: () => undefined,
    createBuffer: () => {
      calls.buffers += 1;
      return {} as WebGLBuffer;
    },
    deleteBuffer: () => undefined,
    bindBuffer: () => undefined,
    bufferData: () => undefined,
  };
  return { gl: gl as WebGLRenderingContext, calls };
}

describe("createEffectsRenderer", () => {
  it("composites non-normal shadow blend modes with SVG feBlend alpha semantics", () => {
    expect(blendShadowFragmentShader).toContain("float outputAlpha = sourceAlpha + backdrop.a * (1.0 - sourceAlpha)");
    expect(blendShadowFragmentShader).toContain("premultipliedOutput / outputAlpha");
    expect(blendShadowFragmentShader).toContain("u_blendMode == 16");
    expect(blendShadowFragmentShader).toContain("sourceAlpha + backdropAlpha");
    expect(blendShadowFragmentShader).not.toContain("u_blendMode == 17");
  });

  it("uses the same alpha compositing contract for paint-level content blend modes", () => {
    expect(blendContentFragmentShader).toContain("float outputAlpha = sourceAlpha + backdrop.a * (1.0 - sourceAlpha)");
    expect(blendContentFragmentShader).toContain("premultipliedOutput / outputAlpha");
    expect(blendContentFragmentShader).toContain("u_blendMode == 16");
    expect(blendContentFragmentShader).toContain("sourceAlpha + backdropAlpha");
    expect(blendContentFragmentShader).not.toContain("u_blendMode == 17");
  });

  it("requires the content blend caller to declare source texture alpha mode", () => {
    expect(blendContentFragmentShader).toContain("uniform float u_sourcePremultipliedInput");
    expect(blendContentFragmentShader).toContain("if (u_sourcePremultipliedInput > 0.5 && sourceAlpha > 0.0001)");
    expect(blendContentFragmentShader).toContain("sourceColor = source.rgb / sourceAlpha");
  });

  it("converts premultiplied layer captures before opacity blits", () => {
    expect(blitFragmentShader).toContain("uniform float u_premultipliedInput");
    expect(blitFragmentShader).toContain("color = texel.rgb / texel.a");
    expect(blitFragmentShader).toContain("gl_FragColor = vec4(color, texel.a * u_opacity)");
  });

  it("does not premultiply already-premultiplied blur sources a second time", () => {
    expect(gaussianBlurFragmentShader).toContain("uniform float u_premultipliedInput");
    expect(gaussianBlurFragmentShader).toContain("if (u_premultipliedInput < 0.5)");
    expect(gaussianBlurFragmentShader).toContain("s.rgb *= s.a");
  });

  it("uses SVG hardAlpha binarization for WebGL shadow silhouettes", () => {
    expect(alphaBinarizeFragmentShader).toContain("texture2D(u_texture, v_texCoord).a * 127.0");
    expect(alphaBinarizeFragmentShader).toContain("clamp(");
  });

  it("precompiles all WebGL effect shader programs without allocating framebuffers", () => {
    const { gl, calls } = makeEffectsFakeGL();
    const renderer = createEffectsRenderer(gl);

    renderer.precompileShaders();
    renderer.precompileShaders();

    expect(calls.programs).toBe(9);
    expect(calls.shaders).toBe(18);
    expect(calls.buffers).toBe(2);
    expect(calls.textures).toBe(0);
  });

  it("skips Gaussian blur passes whose discrete adjacent sample cannot change an 8-bit output", () => {
    expect(shouldRunWebGLGaussianBlurForSigma(0)).toBe(false);
    expect(shouldRunWebGLGaussianBlurForSigma(0.1)).toBe(false);
    expect(shouldRunWebGLGaussianBlurForSigma(0.3)).toBe(true);
  });

  it("derives WebGL effect alpha from effect color alpha and resolved node opacity", () => {
    expect(resolveWebGLEffectCompositeAlpha(0.6, 0.5)).toBeCloseTo(0.3);
    expect(() => resolveWebGLEffectCompositeAlpha(1.2, 0.5)).toThrow(
      "WebGL effect color alpha must be finite within [0, 1]",
    );
    expect(() => resolveWebGLEffectCompositeAlpha(0.6, Number.NaN)).toThrow(
      "WebGL effect resolved node opacity must be finite within [0, 1]",
    );
  });

  it("groups only consecutive inner shadows that share the same spread and radius blur source", () => {
    const a = innerShadowEffect({ radius: 4, spread: 1 });
    const b = innerShadowEffect({ radius: 4, spread: 1 });
    const c = innerShadowEffect({ radius: 8, spread: 1 });
    const d = innerShadowEffect({ radius: 4, spread: 1 });

    const runs = resolveConsecutiveInnerShadowBlurSourceRuns([a, b, c, d]);

    expect(runs.map((run) => run.effects)).toEqual([[a, b], [c], [d]]);
  });

  it("uses the existing inner shadow spread contract when grouping blur sources", () => {
    const absentSpread = innerShadowEffect({ radius: 4, spread: undefined });
    const zeroSpread = innerShadowEffect({ radius: 4, spread: 0 });

    expect(resolveConsecutiveInnerShadowBlurSourceRuns([absentSpread, zeroSpread])).toEqual([{
      radius: 4,
      spread: 0,
      effects: [absentSpread, zeroSpread],
    }]);
  });
});
