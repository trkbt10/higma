/** @file WebGL shader cache tests. */

import { createShaderCache } from "./index";

type ShaderFakeGL = Pick<
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
  | "getAttribLocation"
  | "getUniformLocation"
  | "useProgram"
  | "uniform1f"
  | "uniform1i"
  | "uniform2f"
  | "uniform4f"
  | "uniformMatrix3fv"
> & {
  readonly VERTEX_SHADER: number;
  readonly FRAGMENT_SHADER: number;
  readonly COMPILE_STATUS: number;
  readonly LINK_STATUS: number;
};

type ShaderFakeCalls = {
  shaders: number;
  programs: number;
  attribs: number;
  uniforms: number;
  uniform1f: number;
  uniform1i: number;
  uniform2f: number;
  uniform4f: number;
  uniformMatrix3fv: number;
};

function makeShaderFakeGL(): { readonly gl: WebGLRenderingContext; readonly calls: ShaderFakeCalls } {
  const calls: ShaderFakeCalls = {
    shaders: 0, programs: 0, attribs: 0, uniforms: 0,
    uniform1f: 0, uniform1i: 0, uniform2f: 0, uniform4f: 0, uniformMatrix3fv: 0,
  };
  const gl: ShaderFakeGL = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
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
    getAttribLocation: () => {
      calls.attribs += 1;
      return 3;
    },
    getUniformLocation: () => {
      calls.uniforms += 1;
      return {} as WebGLUniformLocation;
    },
    useProgram: () => undefined,
    uniform1f: () => { calls.uniform1f += 1; },
    uniform1i: () => { calls.uniform1i += 1; },
    uniform2f: () => { calls.uniform2f += 1; },
    uniform4f: () => { calls.uniform4f += 1; },
    uniformMatrix3fv: () => { calls.uniformMatrix3fv += 1; },
  };
  return { gl: gl as WebGLRenderingContext, calls };
}

describe("createShaderCache", () => {
  it("precompiles all configured WebGL fill programs", () => {
    const { gl, calls } = makeShaderFakeGL();
    const cache = createShaderCache(gl);

    cache.precompileAll();
    cache.precompileAll();

    expect(calls.programs).toBe(6);
    expect(calls.shaders).toBe(12);
  });

  it("caches attribute and uniform locations by program name", () => {
    const { gl, calls } = makeShaderFakeGL();
    const cache = createShaderCache(gl);

    expect(cache.getAttribLocation("flat", "a_position")).toBe(3);
    expect(cache.getAttribLocation("flat", "a_position")).toBe(3);
    expect(cache.getUniformLocation("flat", "u_transform")).not.toBeNull();
    expect(cache.getUniformLocation("flat", "u_transform")).not.toBeNull();

    expect(calls.attribs).toBe(1);
    expect(calls.uniforms).toBe(1);
  });

  it("skips redundant uniform uploads so pan/zoom clip rebuilds do not re-bind constant values", () => {
    const { gl, calls } = makeShaderFakeGL();
    const cache = createShaderCache(gl);

    // Same (program, name, value) — second call must short-circuit.
    cache.setUniform2f("flat", "u_resolution", 1920, 1080);
    cache.setUniform2f("flat", "u_resolution", 1920, 1080);
    expect(calls.uniform2f).toBe(1);

    // Value change — must hit GL.
    cache.setUniform2f("flat", "u_resolution", 1920, 1081);
    expect(calls.uniform2f).toBe(2);

    // Same name on a different program — independent cache line.
    cache.setUniform2f("textured", "u_resolution", 1920, 1081);
    expect(calls.uniform2f).toBe(3);

    cache.setUniform4f("flat", "u_color", 0, 0, 0, 1);
    cache.setUniform4f("flat", "u_color", 0, 0, 0, 1);
    expect(calls.uniform4f).toBe(1);

    cache.setUniform1f("flat", "u_opacity", 0.5);
    cache.setUniform1f("flat", "u_opacity", 0.5);
    expect(calls.uniform1f).toBe(1);

    cache.setUniform1i("flat", "u_repeat", 0);
    cache.setUniform1i("flat", "u_repeat", 0);
    expect(calls.uniform1i).toBe(1);

    const matrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    cache.setUniformMatrix3fv("flat", "u_transform", matrix);
    // Caller often mutates the same Float32Array for the next draw —
    // the cache must compare by element, not by reference, so the same
    // values in a fresh array still short-circuit.
    cache.setUniformMatrix3fv("flat", "u_transform", new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    expect(calls.uniformMatrix3fv).toBe(1);

    cache.setUniformMatrix3fv("flat", "u_transform", new Float32Array([2, 0, 0, 0, 1, 0, 0, 0, 1]));
    expect(calls.uniformMatrix3fv).toBe(2);
  });
});
