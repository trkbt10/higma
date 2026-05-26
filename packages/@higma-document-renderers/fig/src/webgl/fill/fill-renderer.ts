/**
 * @file Fill rendering for WebGL
 *
 * Handles solid, linear gradient, radial gradient, and image fills.
 */

import type { Fill, Color } from "@higma-document-renderers/fig/scene-graph";
import type { ImagePaintFilter } from "@higma-codecs/raster";
import { hasImagePaintFilter, resolveImagePaintFilterUniforms } from "@higma-codecs/raster";
import type { ShaderCache } from "../shaders";
import type { GLStateCache } from "../state/gl-state-cache";
import type { WebGLVertexBufferCache } from "../resources/vertex-buffer-cache";
import type { AffineMatrix } from "@higma-primitives/path";

// =============================================================================
// Types
// =============================================================================

export type GLContext = {
  readonly gl: WebGLRenderingContext;
  readonly shaders: ShaderCache;
  /**
   * Cached GL state setters (stencil, color mask, capability toggles,
   * stencil-clear value). Renderer code calls these instead of the
   * raw `gl.X` setters so redundant state changes — the typical case
   * during clip stencil rebuilds — short-circuit at the JS boundary.
   */
  readonly glState: GLStateCache;
  readonly vertexBuffers: WebGLVertexBufferCache;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
};

/**
 * Bind a WebGL vertex buffer for `vertices`. The cache promotes repeated
 * RenderTree geometry arrays to static GPU buffers and keeps one-off arrays
 * on its dynamic buffer.
 */
export function bindPositionBufferVertices(ctx: GLContext, vertices: Float32Array): void {
  ctx.vertexBuffers.bindVertices(vertices);
}

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

  const { gl, shaders, width, height, pixelRatio } = ctx;
  const programName = "flat";
  shaders.useProgram(programName);

  bindPositionBufferVertices(ctx, vertices);

  const posLoc = shaders.getAttribLocation(programName, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  shaders.setUniformMatrix3fv(programName, "u_transform", matrixToGLUniform(transform, pixelRatio));
  shaders.setUniform2f(programName, "u_resolution", width * pixelRatio, height * pixelRatio);
  shaders.setUniform4f(programName, "u_color", color.r, color.g, color.b, color.a * opacity);

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

  const { gl, shaders } = ctx;
  const programName = "linearGradient";
  shaders.useProgram(programName);

  bindGradientGeometry({ ctx, programName, vertices, transform });
  shaders.setUniform2f(programName, "u_gradientStart", fill.start.x, fill.start.y);
  shaders.setUniform2f(programName, "u_gradientEnd", fill.end.x, fill.end.y);
  shaders.setUniform2f(programName, "u_elementSize", elementSize.width, elementSize.height);
  shaders.setUniform2f(programName, "u_elementOrigin", elementSize.x ?? 0, elementSize.y ?? 0);
  shaders.setUniform1f(programName, "u_opacity", opacity * fill.opacity);
  bindGradientStops({ shaders, programName, stops: fill.stops });

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

/**
 * Resolve the matrix consumed by the radial-gradient shader.
 *
 * Kiwi `paint.transform` maps normalised object coordinates into
 * Figma radial-gradient coordinates. The shader consumes that matrix
 * directly and samples distance from Figma's canonical centre
 * `(0.5, 0.5)` with radius `0.5`. When Kiwi did not author a transform,
 * the RenderTree fill's explicit `center` and `radius` fields define
 * the same object→gradient mapping.
 */
export function resolveWebGLRadialGradientObjectToGradientUniform(
  fill: Extract<Fill, { type: "radial-gradient" }>,
): Float32Array {
  const t = fill.gradientTransform;
  if (t !== undefined) {
    return affineToGLUniform(t);
  }
  if (!Number.isFinite(fill.radius) || fill.radius <= 0) {
    throw new Error(`WebGL radial gradient requires positive radius when gradientTransform is absent, got ${fill.radius}`);
  }
  const scale = 0.5 / fill.radius;
  return affineToGLUniform({
    m00: scale,
    m01: 0,
    m02: 0.5 - fill.center.x * scale,
    m10: 0,
    m11: scale,
    m12: 0.5 - fill.center.y * scale,
  });
}

function affineToGLUniform(transform: AffineMatrix): Float32Array {
  return new Float32Array([
    transform.m00, transform.m10, 0,
    transform.m01, transform.m11, 0,
    transform.m02, transform.m12, 1,
  ]);
}

/** Draw a radial gradient fill using WebGL */
export function drawRadialGradientFill(
  { ctx, vertices, fill, transform, opacity, elementSize }: RadialGradientFillParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders } = ctx;
  const programName = "radialGradient";
  shaders.useProgram(programName);

  bindGradientGeometry({ ctx, programName, vertices, transform });
  shaders.setUniformMatrix3fv(programName, "u_objectToGradient", resolveWebGLRadialGradientObjectToGradientUniform(fill));
  shaders.setUniform2f(programName, "u_elementSize", elementSize.width, elementSize.height);
  shaders.setUniform2f(programName, "u_elementOrigin", elementSize.x ?? 0, elementSize.y ?? 0);
  shaders.setUniform1f(programName, "u_opacity", opacity * fill.opacity);
  bindGradientStops({ shaders, programName, stops: fill.stops });

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

/** Draw an angular gradient fill using WebGL */
export function drawAngularGradientFill(
  { ctx, vertices, fill, transform, opacity, elementSize }: AngularGradientFillParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders } = ctx;
  const programName = "angularGradient";
  shaders.useProgram(programName);

  bindGradientGeometry({ ctx, programName, vertices, transform });
  shaders.setUniform2f(programName, "u_center", fill.center.x, fill.center.y);
  shaders.setUniform1f(programName, "u_rotation", fill.rotation * (Math.PI / 180));
  shaders.setUniform2f(programName, "u_elementSize", elementSize.width, elementSize.height);
  shaders.setUniform2f(programName, "u_elementOrigin", elementSize.x ?? 0, elementSize.y ?? 0);
  shaders.setUniform1f(programName, "u_opacity", opacity * fill.opacity);
  bindGradientStops({ shaders, programName, stops: fill.stops });

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

/** Draw a diamond gradient fill using WebGL */
export function drawDiamondGradientFill(
  { ctx, vertices, fill, transform, opacity, elementSize }: DiamondGradientFillParams
): void {
  if (vertices.length === 0 || opacity <= 0) {return;}

  const { gl, shaders } = ctx;
  const programName = "diamondGradient";
  shaders.useProgram(programName);

  bindGradientGeometry({ ctx, programName, vertices, transform });
  shaders.setUniform2f(programName, "u_center", fill.center.x, fill.center.y);
  shaders.setUniform2f(programName, "u_elementSize", elementSize.width, elementSize.height);
  shaders.setUniform2f(programName, "u_elementOrigin", elementSize.x ?? 0, elementSize.y ?? 0);
  shaders.setUniform1f(programName, "u_opacity", opacity * fill.opacity);
  bindGradientStops({ shaders, programName, stops: fill.stops });

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

function bindGradientGeometry({
  ctx,
  programName,
  vertices,
  transform,
}: {
  readonly ctx: GLContext;
  readonly programName: "linearGradient" | "radialGradient" | "angularGradient" | "diamondGradient";
  readonly vertices: Float32Array;
  readonly transform: AffineMatrix;
}): void {
  const { gl, shaders, width, height, pixelRatio } = ctx;
  bindPositionBufferVertices(ctx, vertices);

  const posLoc = shaders.getAttribLocation(programName, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  shaders.setUniformMatrix3fv(programName, "u_transform", matrixToGLUniform(transform, pixelRatio));
  shaders.setUniform2f(programName, "u_resolution", width * pixelRatio, height * pixelRatio);
}

function bindGradientStops({
  shaders,
  programName,
  stops,
}: {
  readonly shaders: ShaderCache;
  readonly programName: "linearGradient" | "radialGradient" | "angularGradient" | "diamondGradient";
  readonly stops: Extract<Fill, { type: "linear-gradient" | "radial-gradient" | "angular-gradient" | "diamond-gradient" }>["stops"];
}): void {
  const stopCount = Math.min(stops.length, 8);
  shaders.setUniform1i(programName, "u_stopCount", stopCount);

  for (let i = 0; i < stopCount; i++) {
    const s = stops[i];
    shaders.setUniform4f(programName, `u_stops[${i}]`, s.position, s.color.r, s.color.g, s.color.b);
    shaders.setUniform4f(programName, `u_stopAlphas[${i}]`, s.color.a, 0, 0, 0);
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
  /**
   * User-positioned crop transform. Required when `scaleMode === "CROP"`:
   * maps element-uv space (0..1) into image-uv space (0..1) so the shader
   * samples the slice of the image the user dragged into view.
   */
  readonly imageTransform?: AffineMatrix;
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

  const { gl, shaders, width, height, pixelRatio } = ctx;
  const programName = "textured";
  shaders.useProgram(programName);

  bindPositionBufferVertices(ctx, vertices);

  const posLoc = shaders.getAttribLocation(programName, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  shaders.setUniformMatrix3fv(programName, "u_transform", matrixToGLUniform(transform, pixelRatio));
  shaders.setUniform2f(programName, "u_resolution", width * pixelRatio, height * pixelRatio);

  // Bind texture
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  shaders.setUniform1i(programName, "u_texture", 0);

  // Compute UV scale/offset based on scaleMode
  const { texScale, texOffset, repeat, clipTransparent } = computeImageUV({
    elementW: elementSize.width,
    elementH: elementSize.height,
    imageW: options?.imageWidth ?? elementSize.width,
    imageH: options?.imageHeight ?? elementSize.height,
    scaleMode: options?.scaleMode ?? "STRETCH",
    scalingFactor: options?.scalingFactor,
    imageTransform: options?.imageTransform,
  });

  shaders.setUniform2f(programName, "u_texScale", texScale.x, texScale.y);
  shaders.setUniform2f(programName, "u_texOffset", texOffset.x, texOffset.y);
  shaders.setUniform1i(programName, "u_repeat", repeat ? 1 : 0);
  shaders.setUniform1i(programName, "u_clipTransparent", clipTransparent ? 1 : 0);
  shaders.setUniform1f(programName, "u_opacity", opacity);
  const filterUniforms = resolveImagePaintFilterUniforms(options?.paintFilter);
  shaders.setUniform1i(programName, "u_hasPaintFilter", hasImagePaintFilter(options?.paintFilter) ? 1 : 0);
  shaders.setUniform1f(programName, "u_exposure", filterUniforms.exposure);
  shaders.setUniform1f(programName, "u_contrast", filterUniforms.contrast);
  shaders.setUniform1f(programName, "u_brightness", filterUniforms.brightness);
  shaders.setUniform1f(programName, "u_temperature", filterUniforms.temperature);
  shaders.setUniform1f(programName, "u_tint", filterUniforms.tint);
  shaders.setUniform1f(programName, "u_saturation", filterUniforms.saturation);
  shaders.setUniform1f(programName, "u_vibrance", filterUniforms.vibrance);

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
  imageTransform?: AffineMatrix;
};

/** Compute UV scale and offset for image fills */
export function computeImageUV(
  { elementW, elementH, imageW, imageH, scaleMode, scalingFactor, imageTransform }: ImageUVParams
): ImageUVResult {
  if (scaleMode === "CROP") {
    return computeCropImageUV({ elementW, elementH, imageTransform });
  }

  if (scaleMode === "FILL" && imageW > 0 && imageH > 0) {
    return computeFillImageUV({ elementW, elementH, imageW, imageH });
  }

  if (scaleMode === "FIT" && imageW > 0 && imageH > 0) {
    return computeFitImageUV({ elementW, elementH, imageW, imageH });
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

type ImageUVResult = {
  texScale: { x: number; y: number };
  texOffset: { x: number; y: number };
  repeat: boolean;
  clipTransparent: boolean;
};

function computeCropImageUV(
  { elementW, elementH, imageTransform }: Pick<ImageUVParams, "elementW" | "elementH" | "imageTransform">,
): ImageUVResult {
  if (imageTransform === undefined) {
    throw new Error("CROP imageScaleMode requires an explicit imageTransform");
  }
  // Figma's user-positioned crop: imageTransform maps element-uv (0..1)
  // into image-uv (0..1) — image_uv = M · element_uv. The shader formula
  // is `uv = v_texCoord * u_texScale + u_texOffset` with v_texCoord in
  // element-pixel space (0..elementW, 0..elementH), so:
  //   u = (m00 / elementW) * vx + (m01 / elementH) * vy + m02
  //   v = (m10 / elementW) * vx + (m11 / elementH) * vy + m12
  // The current shader stores texScale/texOffset per-component (no
  // off-diagonal cross-coupling), so rotated/skewed crops are rejected
  // here rather than rendered incorrectly. Sampling outside the image
  // bounds is treated as transparent so the underlying fill (e.g. the
  // solid layer beneath this image paint) shows through, matching the
  // Figma editor's behaviour for cropped images that do not fully cover
  // the element.
  if (imageTransform.m01 !== 0 || imageTransform.m10 !== 0) {
    throw new Error("CROP imageScaleMode with a rotated/skewed imageTransform is not yet supported by the WebGL renderer");
  }
  return {
    texScale: { x: imageTransform.m00 / elementW, y: imageTransform.m11 / elementH },
    texOffset: { x: imageTransform.m02, y: imageTransform.m12 },
    repeat: false,
    clipTransparent: true,
  };
}

function computeFillImageUV(
  { elementW, elementH, imageW, imageH }: Pick<ImageUVParams, "elementW" | "elementH" | "imageW" | "imageH">,
): ImageUVResult {
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
  }
  // Image taller than element: full width, crop height
  const uvHeight = imageAR / elementAR;
  return {
    texScale: { x: 1 / elementW, y: uvHeight / elementH },
    texOffset: { x: 0, y: (1 - uvHeight) / 2 },
    repeat: false,
    clipTransparent: false,
  };
}

function computeFitImageUV(
  { elementW, elementH, imageW, imageH }: Pick<ImageUVParams, "elementW" | "elementH" | "imageW" | "imageH">,
): ImageUVResult {
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
  }
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
