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
  /** Dispose all cached programs */
  dispose(): void;
};

/** Create a shader cache that lazily compiles and caches shader programs */
export function createShaderCache(gl: WebGLRenderingContext): ShaderCache {
  const programs = new Map<ShaderProgramName, WebGLProgram>();
  const attribLocations = new Map<string, number>();
  const uniformLocations = new Map<string, WebGLUniformLocation | null>();

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
      const key = programLocationKey(programName, uniformName);
      if (uniformLocations.has(key)) {
        return uniformLocations.get(key) ?? null;
      }
      const location = gl.getUniformLocation(getProgram(programName), uniformName);
      uniformLocations.set(key, location);
      return location;
    },

    dispose() {
      for (const program of programs.values()) {
        gl.deleteProgram(program);
      }
      programs.clear();
      attribLocations.clear();
      uniformLocations.clear();
    },
  };
}
