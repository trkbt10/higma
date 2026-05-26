/**
 * @file Tests for WebGL fill UV calculations
 */

import {
  bindPositionBufferVertices,
  computeImageUV,
  resolveWebGLRadialGradientObjectToGradientUniform,
  type GLContext,
} from "./fill-renderer";
import type { ShaderCache } from "../shaders";
import type { GLStateCache } from "../state/gl-state-cache";
import type { WebGLVertexBufferCache } from "../resources/vertex-buffer-cache";
import type { Fill } from "../../scene-graph";

describe("computeImageUV", () => {
  it("marks FIT letterbox regions as transparent", () => {
    const uv = computeImageUV({
      elementW: 100,
      elementH: 100,
      imageW: 200,
      imageH: 100,
      scaleMode: "FIT",
    });

    expect(uv.texScale).toEqual({ x: 0.01, y: 0.02 });
    expect(uv.texOffset).toEqual({ x: 0, y: -0.5 });
    expect(uv.repeat).toBe(false);
    expect(uv.clipTransparent).toBe(true);
  });

  it("uses repeating image-space UVs for TILE", () => {
    const uv = computeImageUV({
      elementW: 100,
      elementH: 100,
      imageW: 200,
      imageH: 100,
      scaleMode: "TILE",
      scalingFactor: 0.5,
    });

    expect(uv.texScale).toEqual({ x: 0.01, y: 0.02 });
    expect(uv.texOffset).toEqual({ x: 0, y: 0 });
    expect(uv.repeat).toBe(true);
    expect(uv.clipTransparent).toBe(false);
  });

  it("maps element-uv through the user-positioned transform for CROP", () => {
    // Real .fig sample: portrait image dragged into a wide hero rectangle.
    // The wire format stored imageScaleMode=STRETCH with this transform; the
    // convert layer normalises it to CROP so the renderer applies the
    // transform instead of plain-stretching the image into the rect.
    const uv = computeImageUV({
      elementW: 1440,
      elementH: 663,
      imageW: 2730,
      imageH: 4096,
      scaleMode: "CROP",
      imageTransform: {
        m00: 2.1431989669799805, m01: 0, m02: -1.0626695156097412,
        m10: 0, m11: 0.6576825380325317, m12: 0.04567856714129448,
      },
    });

    // Per-component: image_uv = imageTransform · element_uv. Sampling at the
    // rect's pixel-space corners therefore lands at the cropped slice of the
    // image, not at (0,0)..(1,1).
    expect(uv.texScale.x).toBeCloseTo(2.1431989669799805 / 1440, 9);
    expect(uv.texScale.y).toBeCloseTo(0.6576825380325317 / 663, 9);
    expect(uv.texOffset.x).toBeCloseTo(-1.0626695156097412, 9);
    expect(uv.texOffset.y).toBeCloseTo(0.04567856714129448, 9);
    expect(uv.repeat).toBe(false);
    expect(uv.clipTransparent).toBe(true);
  });

  it("rejects CROP without an explicit imageTransform", () => {
    expect(() => computeImageUV({
      elementW: 100,
      elementH: 100,
      imageW: 100,
      imageH: 100,
      scaleMode: "CROP",
    })).toThrow("CROP imageScaleMode requires an explicit imageTransform");
  });

  it("rejects CROP with a rotated imageTransform until the shader supports it", () => {
    expect(() => computeImageUV({
      elementW: 100,
      elementH: 100,
      imageW: 100,
      imageH: 100,
      scaleMode: "CROP",
      imageTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
    })).toThrow("CROP imageScaleMode with a rotated/skewed imageTransform");
  });
});

describe("resolveWebGLRadialGradientObjectToGradientUniform", () => {
  function radialGradientFill(overrides: Partial<Extract<Fill, { readonly type: "radial-gradient" }>> = {}): Extract<Fill, { readonly type: "radial-gradient" }> {
    return {
      type: "radial-gradient",
      center: { x: 0.5, y: 0.5 },
      radius: 0.5,
      stops: [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
      opacity: 1,
      ...overrides,
    };
  }

  it("passes Kiwi radial gradientTransform to the shader without circular-radius reduction", () => {
    const matrix = resolveWebGLRadialGradientObjectToGradientUniform(radialGradientFill({
      gradientTransform: {
        m00: 0.6633641123771667,
        m01: 5.324599266052246,
        m02: -5.35941219329834,
        m10: -5.292078495025635,
        m11: 0.6674402356147766,
        m12: 5.053652763366699,
      },
    }));

    expect(Array.from(matrix)).toEqual([
      0.6633641123771667, -5.292078495025635, 0,
      5.324599266052246, 0.6674402356147766, 0,
      -5.35941219329834, 5.053652763366699, 1,
    ]);
  });

  it("projects explicit center and radius to the same object-to-gradient matrix when Kiwi omitted gradientTransform", () => {
    const matrix = resolveWebGLRadialGradientObjectToGradientUniform(radialGradientFill({
      center: { x: 0.25, y: 0.75 },
      radius: 0.25,
    }));

    expect(Array.from(matrix)).toEqual([
      2, 0, 0,
      0, 2, 0,
      0, -1, 1,
    ]);
  });

  it("rejects absent-transform radial gradients without a positive explicit radius", () => {
    expect(() => resolveWebGLRadialGradientObjectToGradientUniform(radialGradientFill({ radius: 0 }))).toThrow(
      "WebGL radial gradient requires positive radius when gradientTransform is absent",
    );
  });
});

describe("bindPositionBufferVertices", () => {
  type BindBufferCalls = {
    readonly bindVertices: readonly Float32Array[];
  };

  function makeCtx(): { readonly ctx: GLContext; readonly calls: BindBufferCalls } {
    const calls: { bindVertices: Float32Array[] } = { bindVertices: [] };
    const fakeShaders: ShaderCache = {} as ShaderCache;
    const vertexBuffers: WebGLVertexBufferCache = {
      prepareStaticVertices: () => undefined,
      synchronizePreparedRenderTreeVertexArrays: () => undefined,
      bindVertices: (vertices) => {
        calls.bindVertices.push(vertices);
      },
      invalidateArrayBufferBinding: () => undefined,
      resetFrameMetrics: () => undefined,
      getFrameMetrics: () => ({
        dynamicBufferBindCount: 0,
        dynamicBufferUploadCount: 0,
        dynamicBufferUploadByteLength: 0,
        staticBufferBindCount: 0,
        staticBufferCreationCount: 0,
        staticBufferUploadByteLength: 0,
        staticBufferReleaseCount: 0,
        staticBufferCount: 0,
      }),
      dispose: () => undefined,
    };
    const fakeGlState: GLStateCache = {} as GLStateCache;
    const ctx: GLContext = {
      gl: {} as WebGLRenderingContext,
      shaders: fakeShaders,
      glState: fakeGlState,
      vertexBuffers,
      width: 100,
      height: 100,
      pixelRatio: 1,
    };
    return { ctx, calls };
  }

  it("delegates repeated vertex arrays to the renderer-owned vertex buffer cache", () => {
    const { ctx, calls } = makeCtx();
    const verts = new Float32Array([0, 0, 1, 0, 1, 1]);

    bindPositionBufferVertices(ctx, verts);
    bindPositionBufferVertices(ctx, verts);

    expect(calls.bindVertices).toEqual([verts, verts]);
  });

  it("delegates each vertex array reference without copying it", () => {
    const { ctx, calls } = makeCtx();
    const a = new Float32Array([0, 0, 1, 0, 1, 1]);
    const b = new Float32Array([0, 0, 2, 0, 2, 2]);

    bindPositionBufferVertices(ctx, a);
    bindPositionBufferVertices(ctx, b);
    bindPositionBufferVertices(ctx, b);

    expect(calls.bindVertices).toEqual([a, b, b]);
  });
});
