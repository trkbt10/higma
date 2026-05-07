/**
 * @file Fill rendering for WebGL
 *
 * Handles solid, linear gradient, radial gradient, and image fills.
 */

import type { Fill, Color, AffineMatrix, ImagePaintFilter } from "../scene-graph/types";
import { hasImagePaintFilter, resolveImagePaintFilterUniforms } from "../scene-graph/render/image-paint-filter";
import type { ShaderCache } from "./shaders";

// =============================================================================
// Types
// =============================================================================

export type GLContext = {
  readonly gl: WebGLRenderingContext;
  readonly shaders: ShaderCache;
  readonly positionBuffer: WebGLBuffer;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
};

// =============================================================================
// Matrix Utilities
// =============================================================================

function matrixToGLUniform(m: AffineMatrix, pixelRatio: number): Float32Array {
  return new Float32Array([
    m.m00 * pixelRatio, m.m10 * pixelRatio, 0,
    m.m01 * pixelRatio, m.m11 * pixelRatio, 0,
    m.m02 * pixelRatio, m.m12 * pixelRatio, 1,
  ]);
}

// =============================================================================
// Solid Color
// =============================================================================






/** Parameters for drawing a solid color fill */
export type SolidFillParams = {
  ctx: GLContext;
  vertices: Float32Array;
  color: Color;
  transform: AffineMatrix;
  opacity: number;
};

/** Draw a solid color fill using WebGL */
export function drawSolidFill(
  { ctx, vertices, color, transform, opacity }: SolidFillParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders, positionBuffer, width, height, pixelRatio } = ctx;
  const programName = "flat";
  const program = shaders.get(programName);
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

  const posLoc = shaders.getAttribLocation(programName, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.uniformMatrix3fv(
    shaders.getUniformLocation(programName, "u_transform"),
    false,
    matrixToGLUniform(transform, pixelRatio)
  );
  gl.uniform2f(
    shaders.getUniformLocation(programName, "u_resolution"),
    width * pixelRatio,
    height * pixelRatio
  );
  gl.uniform4f(
    shaders.getUniformLocation(programName, "u_color"),
    color.r,
    color.g,
    color.b,
    color.a * opacity
  );

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

// =============================================================================
// Linear Gradient
// =============================================================================






/** Parameters for drawing a linear gradient fill */
export type LinearGradientFillParams = {
  ctx: GLContext;
  vertices: Float32Array;
  fill: Extract<Fill, { type: "linear-gradient" }>;
  transform: AffineMatrix;
  opacity: number;
  elementSize: { width: number; height: number; x?: number; y?: number };
};

/** Draw a linear gradient fill using WebGL */
export function drawLinearGradientFill(
  { ctx, vertices, fill, transform, opacity, elementSize }: LinearGradientFillParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders, positionBuffer, width, height, pixelRatio } = ctx;
  const programName = "linearGradient";
  const program = shaders.get(programName);
  gl.useProgram(program);

  bindGradientGeometry({ gl, shaders, programName, positionBuffer, vertices, transform, width, height, pixelRatio });
  gl.uniform2f(shaders.getUniformLocation(programName, "u_gradientStart"), fill.start.x, fill.start.y);
  gl.uniform2f(shaders.getUniformLocation(programName, "u_gradientEnd"), fill.end.x, fill.end.y);
  gl.uniform2f(shaders.getUniformLocation(programName, "u_elementSize"), elementSize.width, elementSize.height);
  gl.uniform2f(shaders.getUniformLocation(programName, "u_elementOrigin"), elementSize.x ?? 0, elementSize.y ?? 0);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_opacity"), opacity * fill.opacity);
  bindGradientStops({ gl, shaders, programName, stops: fill.stops });

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

// =============================================================================
// Radial Gradient
// =============================================================================






/** Parameters for drawing a radial gradient fill */
export type RadialGradientFillParams = {
  ctx: GLContext;
  vertices: Float32Array;
  fill: Extract<Fill, { type: "radial-gradient" }>;
  transform: AffineMatrix;
  opacity: number;
  elementSize: { width: number; height: number; x?: number; y?: number };
};

export type AngularGradientFillParams = {
  ctx: GLContext;
  vertices: Float32Array;
  fill: Extract<Fill, { type: "angular-gradient" }>;
  transform: AffineMatrix;
  opacity: number;
  elementSize: { width: number; height: number; x?: number; y?: number };
};

export type DiamondGradientFillParams = {
  ctx: GLContext;
  vertices: Float32Array;
  fill: Extract<Fill, { type: "diamond-gradient" }>;
  transform: AffineMatrix;
  opacity: number;
  elementSize: { width: number; height: number; x?: number; y?: number };
};

/** Draw a radial gradient fill using WebGL */
export function drawRadialGradientFill(
  { ctx, vertices, fill, transform, opacity, elementSize }: RadialGradientFillParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders, positionBuffer, width, height, pixelRatio } = ctx;
  const programName = "radialGradient";
  const program = shaders.get(programName);
  gl.useProgram(program);

  bindGradientGeometry({ gl, shaders, programName, positionBuffer, vertices, transform, width, height, pixelRatio });
  gl.uniform2f(shaders.getUniformLocation(programName, "u_center"), fill.center.x, fill.center.y);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_radius"), fill.radius);
  gl.uniform2f(shaders.getUniformLocation(programName, "u_elementSize"), elementSize.width, elementSize.height);
  gl.uniform2f(shaders.getUniformLocation(programName, "u_elementOrigin"), elementSize.x ?? 0, elementSize.y ?? 0);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_opacity"), opacity * fill.opacity);
  bindGradientStops({ gl, shaders, programName, stops: fill.stops });

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

/** Draw an angular gradient fill using WebGL */
export function drawAngularGradientFill(
  { ctx, vertices, fill, transform, opacity, elementSize }: AngularGradientFillParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders, positionBuffer, width, height, pixelRatio } = ctx;
  const programName = "angularGradient";
  const program = shaders.get(programName);
  gl.useProgram(program);

  bindGradientGeometry({ gl, shaders, programName, positionBuffer, vertices, transform, width, height, pixelRatio });
  gl.uniform2f(shaders.getUniformLocation(programName, "u_center"), fill.center.x, fill.center.y);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_rotation"), fill.rotation * (Math.PI / 180));
  gl.uniform2f(shaders.getUniformLocation(programName, "u_elementSize"), elementSize.width, elementSize.height);
  gl.uniform2f(shaders.getUniformLocation(programName, "u_elementOrigin"), elementSize.x ?? 0, elementSize.y ?? 0);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_opacity"), opacity * fill.opacity);
  bindGradientStops({ gl, shaders, programName, stops: fill.stops });

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

/** Draw a diamond gradient fill using WebGL */
export function drawDiamondGradientFill(
  { ctx, vertices, fill, transform, opacity, elementSize }: DiamondGradientFillParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders, positionBuffer, width, height, pixelRatio } = ctx;
  const programName = "diamondGradient";
  const program = shaders.get(programName);
  gl.useProgram(program);

  bindGradientGeometry({ gl, shaders, programName, positionBuffer, vertices, transform, width, height, pixelRatio });
  gl.uniform2f(shaders.getUniformLocation(programName, "u_center"), fill.center.x, fill.center.y);
  gl.uniform2f(shaders.getUniformLocation(programName, "u_elementSize"), elementSize.width, elementSize.height);
  gl.uniform2f(shaders.getUniformLocation(programName, "u_elementOrigin"), elementSize.x ?? 0, elementSize.y ?? 0);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_opacity"), opacity * fill.opacity);
  bindGradientStops({ gl, shaders, programName, stops: fill.stops });

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

function bindGradientGeometry({
  gl,
  shaders,
  programName,
  positionBuffer,
  vertices,
  transform,
  width,
  height,
  pixelRatio,
}: {
  readonly gl: WebGLRenderingContext;
  readonly shaders: ShaderCache;
  readonly programName: "linearGradient" | "radialGradient" | "angularGradient" | "diamondGradient";
  readonly positionBuffer: WebGLBuffer;
  readonly vertices: Float32Array;
  readonly transform: AffineMatrix;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

  const posLoc = shaders.getAttribLocation(programName, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.uniformMatrix3fv(
    shaders.getUniformLocation(programName, "u_transform"),
    false,
    matrixToGLUniform(transform, pixelRatio)
  );
  gl.uniform2f(
    shaders.getUniformLocation(programName, "u_resolution"),
    width * pixelRatio,
    height * pixelRatio
  );
}

function bindGradientStops({
  gl,
  shaders,
  programName,
  stops,
}: {
  readonly gl: WebGLRenderingContext;
  readonly shaders: ShaderCache;
  readonly programName: "linearGradient" | "radialGradient" | "angularGradient" | "diamondGradient";
  readonly stops: Extract<Fill, { type: "linear-gradient" | "radial-gradient" | "angular-gradient" | "diamond-gradient" }>["stops"];
}): void {
  const stopCount = Math.min(stops.length, 8);
  gl.uniform1i(shaders.getUniformLocation(programName, "u_stopCount"), stopCount);

  for (let i = 0; i < stopCount; i++) {
    const s = stops[i];
    gl.uniform4f(shaders.getUniformLocation(programName, `u_stops[${i}]`), s.position, s.color.r, s.color.g, s.color.b);
    gl.uniform4f(shaders.getUniformLocation(programName, `u_stopAlphas[${i}]`), s.color.a, 0, 0, 0);
  }
}

// =============================================================================
// Image Fill
// =============================================================================

export type ImageFillOptions = {
  /** Image natural width in pixels */
  readonly imageWidth?: number;
  /** Image natural height in pixels */
  readonly imageHeight?: number;
  /** Figma scale mode: FILL (cover+crop), FIT (contain), STRETCH (default) */
  readonly scaleMode?: string;
  /** TILE scale multiplier */
  readonly scalingFactor?: number;
  readonly paintFilter?: ImagePaintFilter;
};






/** Parameters for drawing an image fill */
export type ImageFillDrawParams = {
  ctx: GLContext;
  vertices: Float32Array;
  texture: WebGLTexture;
  transform: AffineMatrix;
  opacity: number;
  elementSize: { width: number; height: number };
  options?: ImageFillOptions;
};

/** Draw an image fill using WebGL */
export function drawImageFill(
  { ctx, vertices, texture, transform, opacity, elementSize, options }: ImageFillDrawParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders, positionBuffer, width, height, pixelRatio } = ctx;
  const programName = "textured";
  const program = shaders.get(programName);
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

  const posLoc = shaders.getAttribLocation(programName, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.uniformMatrix3fv(
    shaders.getUniformLocation(programName, "u_transform"),
    false,
    matrixToGLUniform(transform, pixelRatio)
  );
  gl.uniform2f(
    shaders.getUniformLocation(programName, "u_resolution"),
    width * pixelRatio,
    height * pixelRatio
  );

  // Bind texture
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(shaders.getUniformLocation(programName, "u_texture"), 0);

  // Compute UV scale/offset based on scaleMode
  const { texScale, texOffset, repeat, clipTransparent } = computeImageUV({
    elementW: elementSize.width,
    elementH: elementSize.height,
    imageW: options?.imageWidth ?? elementSize.width,
    imageH: options?.imageHeight ?? elementSize.height,
    scaleMode: options?.scaleMode ?? "STRETCH",
    scalingFactor: options?.scalingFactor,
  });

  gl.uniform2f(
    shaders.getUniformLocation(programName, "u_texScale"),
    texScale.x,
    texScale.y
  );
  gl.uniform2f(
    shaders.getUniformLocation(programName, "u_texOffset"),
    texOffset.x,
    texOffset.y
  );
  gl.uniform1i(shaders.getUniformLocation(programName, "u_repeat"), repeat ? 1 : 0);
  gl.uniform1i(shaders.getUniformLocation(programName, "u_clipTransparent"), clipTransparent ? 1 : 0);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_opacity"), opacity);
  const filterUniforms = resolveImagePaintFilterUniforms(options?.paintFilter);
  gl.uniform1i(shaders.getUniformLocation(programName, "u_hasPaintFilter"), hasImagePaintFilter(options?.paintFilter) ? 1 : 0);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_exposure"), filterUniforms.exposure);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_contrast"), filterUniforms.contrast);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_brightness"), filterUniforms.brightness);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_temperature"), filterUniforms.temperature);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_tint"), filterUniforms.tint);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_saturation"), filterUniforms.saturation);
  gl.uniform1f(shaders.getUniformLocation(programName, "u_vibrance"), filterUniforms.vibrance);

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

/**
 * Compute UV scale and offset for image fills.
 *
 * Vertex positions go from (0,0) to (elementW, elementH).
 * The shader computes: uv = position * texScale + texOffset
 *
 * - STRETCH: image is distorted to fill element exactly
 * - FILL: image is scaled to cover element, maintaining aspect ratio, then center-cropped
 * - FIT: image is scaled to fit within element, maintaining aspect ratio, centered
 */
/** Parameters for computing image UV mapping */
type ImageUVParams = {
  elementW: number;
  elementH: number;
  imageW: number;
  imageH: number;
  scaleMode: string;
  scalingFactor?: number;
};

/** Compute UV scale and offset for image fills */
export function computeImageUV(
  { elementW, elementH, imageW, imageH, scaleMode, scalingFactor }: ImageUVParams
): {
  texScale: { x: number; y: number };
  texOffset: { x: number; y: number };
  repeat: boolean;
  clipTransparent: boolean;
} {
  if (scaleMode === "FILL" && imageW > 0 && imageH > 0) {
    const imageAR = imageW / imageH;
    const elementAR = elementW / elementH;

    if (imageAR > elementAR) {
      // Image wider than element: full height, crop width
      const uvWidth = elementAR / imageAR;
      return {
        texScale: { x: uvWidth / elementW, y: 1 / elementH },
        texOffset: { x: (1 - uvWidth) / 2, y: 0 },
        repeat: false,
        clipTransparent: false,
      };
    } else {
      // Image taller than element: full width, crop height
      const uvHeight = imageAR / elementAR;
      return {
        texScale: { x: 1 / elementW, y: uvHeight / elementH },
        texOffset: { x: 0, y: (1 - uvHeight) / 2 },
        repeat: false,
        clipTransparent: false,
      };
    }
  }

  if (scaleMode === "FIT" && imageW > 0 && imageH > 0) {
    const imageAR = imageW / imageH;
    const elementAR = elementW / elementH;

    if (imageAR > elementAR) {
      // Image wider: fit width, letterbox height
      const visibleH = elementW / imageAR;
      const padding = (elementH - visibleH) / 2;
      return {
        texScale: { x: 1 / elementW, y: 1 / visibleH },
        texOffset: { x: 0, y: -padding / visibleH },
        repeat: false,
        clipTransparent: true,
      };
    } else {
      // Image taller: fit height, pillarbox width
      const visibleW = elementH * imageAR;
      const padding = (elementW - visibleW) / 2;
      return {
        texScale: { x: 1 / visibleW, y: 1 / elementH },
        texOffset: { x: -padding / visibleW, y: 0 },
        repeat: false,
        clipTransparent: true,
      };
    }
  }

  if (scaleMode === "TILE" && imageW > 0 && imageH > 0) {
    const tileScale = scalingFactor ?? 1;
    return {
      texScale: { x: 1 / (imageW * tileScale), y: 1 / (imageH * tileScale) },
      texOffset: { x: 0, y: 0 },
      repeat: true,
      clipTransparent: false,
    };
  }

  // STRETCH (default): map 0..w → 0..1
  return {
    texScale: { x: 1 / elementW, y: 1 / elementH },
    texOffset: { x: 0, y: 0 },
    repeat: false,
    clipTransparent: false,
  };
}
