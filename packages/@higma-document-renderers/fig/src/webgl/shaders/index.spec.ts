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
> & {
  readonly VERTEX_SHADER: number;
  readonly FRAGMENT_SHADER: number;
  readonly COMPILE_STATUS: number;
  readonly LINK_STATUS: number;
};

function makeShaderFakeGL(): { readonly gl: WebGLRenderingContext; readonly calls: { shaders: number; programs: number; attribs: number; uniforms: number } } {
  const calls = { shaders: 0, programs: 0, attribs: 0, uniforms: 0 };
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
});
