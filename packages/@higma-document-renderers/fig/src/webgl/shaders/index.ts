/**
 * @file Shader compilation and caching
 */

import { flatVertexShader, flatFragmentShader } from "./flat";
import { linearGradientVertexShader, linearGradientFragmentShader } from "./linear-gradient";
import { radialGradientVertexShader, radialGradientFragmentShader } from "./radial-gradient";
import { angularGradientVertexShader, angularGradientFragmentShader } from "./angular-gradient";
import { diamondGradientVertexShader, diamondGradientFragmentShader } from "./diamond-gradient";
import { texturedVertexShader, texturedFragmentShader } from "./textured";

export type ShaderProgramName = "flat" | "linearGradient" | "radialGradient" | "angularGradient" | "diamondGradient" | "textured";

type ShaderSources = {
  readonly vertex: string;
  readonly fragment: string;
};

const SHADER_SOURCES: Record<ShaderProgramName, ShaderSources> = {
  flat: { vertex: flatVertexShader, fragment: flatFragmentShader },
  linearGradient: { vertex: linearGradientVertexShader, fragment: linearGradientFragmentShader },
  radialGradient: { vertex: radialGradientVertexShader, fragment: radialGradientFragmentShader },
  angularGradient: { vertex: angularGradientVertexShader, fragment: angularGradientFragmentShader },
  diamondGradient: { vertex: diamondGradientVertexShader, fragment: diamondGradientFragmentShader },
  textured: { vertex: texturedVertexShader, fragment: texturedFragmentShader },
};

const SHADER_PROGRAM_NAMES: readonly ShaderProgramName[] = [
  "flat",
  "linearGradient",
  "radialGradient",
  "angularGradient",
  "diamondGradient",
  "textured",
];

/**
 * Compile a shader from source
 */
function compileShader(
  gl: WebGLRenderingContext,
  source: string,
  type: number
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${info}`);
  }

  return shader;
}

/**
 * Create a shader program from vertex and fragment sources
 */
function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);

  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create program");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program linking failed: ${info}`);
  }

  // Clean up shaders (they're part of the program now)
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return program;
}

/**
 * Shader program cache
 *
 * Lazily compiles and caches shader programs.
 */
/** Shader program cache interface */
export type ShaderCache = {
  /** Get (or compile) a shader program by name */
  get(name: ShaderProgramName): WebGLProgram;
  /** Compile every known shader program before interactive rendering starts. */
  precompileAll(): void;
  /** Get and cache an attribute location for a compiled program. */
  getAttribLocation(programName: ShaderProgramName, attributeName: string): number;
  /** Get and cache a uniform location for a compiled program. */
  getUniformLocation(programName: ShaderProgramName, uniformName: string): WebGLUniformLocation | null;
  /**
   * Bind a program. Returns the bound program for callers that need
   * it. Does not short-circuit on "already bound" because effects
   * rendering bypasses this cache with its own framebuffer programs,
   * which means our view of the active program may not match GL
   * state.
   */
  useProgram(name: ShaderProgramName): WebGLProgram;
  /**
   * Cached uniform setters — compare against the last value bound to
   * the (program, uniform) pair and skip the `gl.uniform*` call when
   * unchanged. Pan/zoom rerenders repeatedly bind the same
   * `u_resolution`, clip-mask `u_color`, and per-frame opacity / radius
   * values; without caching these uniforms get re-uploaded thousands
   * of times per frame across drawSolidFill / drawShadow / clip
   * rebuilds.
   */
  setUniform1f(programName: ShaderProgramName, uniformName: string, x: number): void;
  setUniform1i(programName: ShaderProgramName, uniformName: string, x: number): void;
  setUniform2f(programName: ShaderProgramName, uniformName: string, x: number, y: number): void;
  setUniform4f(programName: ShaderProgramName, uniformName: string, x: number, y: number, z: number, w: number): void;
  setUniformMatrix3fv(programName: ShaderProgramName, uniformName: string, matrix: Float32Array): void;
  /** Dispose all cached programs */
  dispose(): void;
};

/**
 * Cached uniform value. Stored as a 4-wide tuple so a single shape
 * fits every primitive uniform variant the renderer uses (1f/1i/2f/4f).
 * Matrix uniforms use a separate Float32Array tier so callers don't
 * pay the cost of comparing nine elements against a four-element tuple.
 */
type UniformValueCache = Map<string, readonly [number, number, number, number]>;
type UniformMatrixCache = Map<string, Float32Array>;

function matrix3Equal(a: Float32Array, b: Float32Array): boolean {
  return (
    a[0] === b[0] && a[1] === b[1] && a[2] === b[2] &&
    a[3] === b[3] && a[4] === b[4] && a[5] === b[5] &&
    a[6] === b[6] && a[7] === b[7] && a[8] === b[8]
  );
}

/** Create a shader cache that lazily compiles and caches shader programs */
export function createShaderCache(gl: WebGLRenderingContext): ShaderCache {
  const programs = new Map<ShaderProgramName, WebGLProgram>();
  const attribLocations = new Map<string, number>();
  const uniformLocations = new Map<string, WebGLUniformLocation | null>();
  const uniformValues: UniformValueCache = new Map();
  const uniformMatrices: UniformMatrixCache = new Map();

  function programLocationKey(programName: ShaderProgramName, locationName: string): string {
    return `${programName}:${locationName}`;
  }

  function getProgram(name: ShaderProgramName): WebGLProgram {
    const cached = programs.get(name);
    if (cached) {
      return cached;
    }

    const sources = SHADER_SOURCES[name];
    const program = createProgram(gl, sources.vertex, sources.fragment);
    programs.set(name, program);
    return program;
  }

  function getUniformLocation(programName: ShaderProgramName, uniformName: string): WebGLUniformLocation | null {
    const key = programLocationKey(programName, uniformName);
    if (uniformLocations.has(key)) {
      return uniformLocations.get(key) ?? null;
    }
    const location = gl.getUniformLocation(getProgram(programName), uniformName);
    uniformLocations.set(key, location);
    return location;
  }

  return {
    get(name) {
      return getProgram(name);
    },

    precompileAll() {
      for (const name of SHADER_PROGRAM_NAMES) {
        getProgram(name);
      }
    },

    getAttribLocation(programName, attributeName) {
      const key = programLocationKey(programName, attributeName);
      const cached = attribLocations.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const location = gl.getAttribLocation(getProgram(programName), attributeName);
      attribLocations.set(key, location);
      return location;
    },

    getUniformLocation(programName, uniformName) {
      return getUniformLocation(programName, uniformName);
    },

    useProgram(name) {
      const program = getProgram(name);
      gl.useProgram(program);
      return program;
    },

    setUniform1f(programName, uniformName, x) {
      const key = programLocationKey(programName, uniformName);
      const cached = uniformValues.get(key);
      if (cached && cached[0] === x) {
        return;
      }
      gl.uniform1f(getUniformLocation(programName, uniformName), x);
      uniformValues.set(key, [x, 0, 0, 0]);
    },

    setUniform1i(programName, uniformName, x) {
      const key = programLocationKey(programName, uniformName);
      const cached = uniformValues.get(key);
      if (cached && cached[0] === x) {
        return;
      }
      gl.uniform1i(getUniformLocation(programName, uniformName), x);
      uniformValues.set(key, [x, 0, 0, 0]);
    },

    setUniform2f(programName, uniformName, x, y) {
      const key = programLocationKey(programName, uniformName);
      const cached = uniformValues.get(key);
      if (cached && cached[0] === x && cached[1] === y) {
        return;
      }
      gl.uniform2f(getUniformLocation(programName, uniformName), x, y);
      uniformValues.set(key, [x, y, 0, 0]);
    },

    setUniform4f(programName, uniformName, x, y, z, w) {
      const key = programLocationKey(programName, uniformName);
      const cached = uniformValues.get(key);
      if (cached && cached[0] === x && cached[1] === y && cached[2] === z && cached[3] === w) {
        return;
      }
      gl.uniform4f(getUniformLocation(programName, uniformName), x, y, z, w);
      uniformValues.set(key, [x, y, z, w]);
    },

    setUniformMatrix3fv(programName, uniformName, matrix) {
      const key = programLocationKey(programName, uniformName);
      const cached = uniformMatrices.get(key);
      if (cached && matrix3Equal(cached, matrix)) {
        return;
      }
      gl.uniformMatrix3fv(getUniformLocation(programName, uniformName), false, matrix);
      // Copy: `matrix` is owned by the caller and may be reused for
      // the next draw, so storing the reference would track a future
      // value rather than the one we just bound.
      uniformMatrices.set(key, new Float32Array(matrix));
    },

    dispose() {
      for (const program of programs.values()) {
        gl.deleteProgram(program);
      }
      programs.clear();
      attribLocations.clear();
      uniformLocations.clear();
      uniformValues.clear();
      uniformMatrices.clear();
    },
  };
}
