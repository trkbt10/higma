/** @file WebGL scissor region derived from the shared effect bounds SoT. */

import {
  resolveEffectBounds,
  getClipShapeLocalBounds,
  getRenderFrameLocalSurfaceFilterInputBounds,
  resolveRenderNodeLocalSourceEffectInputBounds,
  resolveRenderNodeLocalSubtreeVisualBounds,
  transformBounds,
  type Effect,
  type RenderFrameNode,
  type RenderNode,
  type Bounds,
  type RenderBackgroundBlur,
  type RenderNodeVisualTransform,
  type ResolvedEffectStack,
} from "../../scene-graph";
import type { AffineMatrix } from "@higma-primitives/path";

export type WebGLEffectRenderRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type WebGLEffectBackdropCopyRegion = {
  readonly textureX: number;
  readonly textureY: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly width: number;
  readonly height: number;
};

export type ExpandWebGLEffectRenderRegionForShaderSamplingParams = {
  readonly region: WebGLEffectRenderRegion;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly paddingInBackingPixels: number;
};

type LocalEffectBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type ResolveWebGLEffectRenderRegionParams = {
  readonly localBounds: LocalEffectBounds;
  readonly effects: readonly Effect[];
  readonly transform: AffineMatrix;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
};

function localEffectBoundsToBounds(bounds: LocalEffectBounds): Bounds {
  return {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
  };
}

function boundsToLocalEffectBounds(bounds: Bounds): LocalEffectBounds {
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function localEffectBoundsToWebGLRenderRegion({
  localBounds,
  transform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: {
  readonly localBounds: LocalEffectBounds;
  readonly transform: AffineMatrix;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
}): WebGLEffectRenderRegion {
  const ratio = requirePositivePixelRatio(pixelRatio);
  const screenBounds = transformBounds(localEffectBoundsToBounds(localBounds), transform);
  const backingMinX = clampFloor(screenBounds.minX * ratio, 0, canvasWidth);
  const backingMaxX = clampCeil(screenBounds.maxX * ratio, 0, canvasWidth);
  const backingMinY = clampFloor(screenBounds.minY * ratio, 0, canvasHeight);
  const backingMaxY = clampCeil(screenBounds.maxY * ratio, 0, canvasHeight);
  return {
    x: backingMinX,
    y: canvasHeight - backingMaxY,
    width: Math.max(0, backingMaxX - backingMinX),
    height: Math.max(0, backingMaxY - backingMinY),
  };
}

function clampFloor(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampCeil(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.ceil(value)));
}

function requirePositivePixelRatio(pixelRatio: number): number {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new Error(`WebGL effect render region requires positive pixelRatio, got ${pixelRatio}`);
  }
  return pixelRatio;
}

function requireNonNegativeFinitePaddingInBackingPixels(paddingInBackingPixels: number): number {
  if (!Number.isFinite(paddingInBackingPixels) || paddingInBackingPixels < 0) {
    throw new Error(
      `WebGL effect render region requires non-negative finite paddingInBackingPixels, got ${paddingInBackingPixels}`,
    );
  }
  return paddingInBackingPixels;
}

/** Resolve the sub-rectangle copied from the current framebuffer into the backdrop texture. */
export function resolveWebGLEffectBackdropCopyRegion(
  region: WebGLEffectRenderRegion,
): WebGLEffectBackdropCopyRegion | null {
  if (region.width === 0 || region.height === 0) {
    return null;
  }
  return {
    textureX: region.x,
    textureY: region.y,
    sourceX: region.x,
    sourceY: region.y,
    width: region.width,
    height: region.height,
  };
}

/** Intersect two WebGL backing-buffer regions in bottom-left scissor space. */
export function intersectWebGLEffectRenderRegions(
  left: WebGLEffectRenderRegion,
  right: WebGLEffectRenderRegion,
): WebGLEffectRenderRegion | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const maxX = Math.min(left.x + left.width, right.x + right.width);
  const maxY = Math.min(left.y + left.height, right.y + right.height);
  if (maxX <= x || maxY <= y) {
    return null;
  }
  return {
    x,
    y,
    width: maxX - x,
    height: maxY - y,
  };
}

/** Expand a backing-buffer region to cover texels read by effect shaders outside the draw scissor. */
export function expandWebGLEffectRenderRegionForShaderSampling({
  region,
  canvasWidth,
  canvasHeight,
  paddingInBackingPixels,
}: ExpandWebGLEffectRenderRegionForShaderSamplingParams): WebGLEffectRenderRegion {
  const padding = requireNonNegativeFinitePaddingInBackingPixels(paddingInBackingPixels);
  const x = clampFloor(region.x - padding, 0, canvasWidth);
  const y = clampFloor(region.y - padding, 0, canvasHeight);
  const maxX = clampCeil(region.x + region.width + padding, 0, canvasWidth);
  const maxY = clampCeil(region.y + region.height + padding, 0, canvasHeight);
  return {
    x,
    y,
    width: Math.max(0, maxX - x),
    height: Math.max(0, maxY - y),
  };
}

/** Resolve the WebGL backing-buffer region occupied by a RenderNode's source input. */
export function resolveWebGLRenderNodeSourceInputRegion({
  node,
  transform,
  visualTransform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: {
  readonly node: RenderNode;
  readonly transform: AffineMatrix;
  readonly visualTransform: RenderNodeVisualTransform;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
}): WebGLEffectRenderRegion {
  const sourceEffectInputBounds = resolveRenderNodeLocalSourceEffectInputBounds({ node, visualTransform });
  if (sourceEffectInputBounds === null) {
    throw new Error(`WebGL render region cannot resolve source input bounds for node ${node.id}`);
  }
  return localEffectBoundsToWebGLRenderRegion({
    localBounds: boundsToLocalEffectBounds(sourceEffectInputBounds),
    transform,
    canvasWidth,
    canvasHeight,
    pixelRatio,
  });
}

/** Resolve the WebGL backing-buffer region occupied by a prepared paint-blend instruction. */
export function resolveWebGLLocalPaintBlendRegion({
  localBounds,
  transform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: {
  readonly localBounds: LocalEffectBounds;
  readonly transform: AffineMatrix;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
}): WebGLEffectRenderRegion {
  return localEffectBoundsToWebGLRenderRegion({
    localBounds,
    transform,
    canvasWidth,
    canvasHeight,
    pixelRatio,
  });
}

/** Resolve the WebGL backing-buffer region consumed by a RenderNode effect-stack pass. */
export function resolveWebGLRenderNodeEffectStackOutputRegion({
  node,
  effectStack,
  transform,
  visualTransform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: {
  readonly node: RenderNode;
  readonly effectStack: ResolvedEffectStack;
  readonly transform: AffineMatrix;
  readonly visualTransform: RenderNodeVisualTransform;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
}): WebGLEffectRenderRegion {
  const sourceEffectInputBounds = resolveRenderNodeLocalSourceEffectInputBounds({ node, visualTransform });
  if (sourceEffectInputBounds === null) {
    throw new Error(`WebGL effect render region cannot resolve effect-stack input bounds for node ${node.id}`);
  }
  return resolveWebGLEffectRenderRegion({
    localBounds: boundsToLocalEffectBounds(sourceEffectInputBounds),
    effects: effectStack.allEffects,
    transform,
    canvasWidth,
    canvasHeight,
    pixelRatio,
  });
}

/** Resolve the WebGL backing-buffer region occupied by the Kiwi-authored FRAME surface. */
export function resolveWebGLRenderFrameSurfaceRegion({
  node,
  transform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: {
  readonly node: RenderFrameNode;
  readonly transform: AffineMatrix;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
}): WebGLEffectRenderRegion {
  return localEffectBoundsToWebGLRenderRegion({
    localBounds: boundsToLocalEffectBounds(getClipShapeLocalBounds(node.sourceSurfaceShape)),
    transform,
    canvasWidth,
    canvasHeight,
    pixelRatio,
  });
}

/** Resolve the WebGL backing-buffer region occupied by a RenderTree background-blur instruction. */
export function resolveWebGLRenderBackgroundBlurRegion({
  backgroundBlur,
  transform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: {
  readonly backgroundBlur: RenderBackgroundBlur;
  readonly transform: AffineMatrix;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
}): WebGLEffectRenderRegion {
  return localEffectBoundsToWebGLRenderRegion({
    localBounds: backgroundBlur.backdropBounds,
    transform,
    canvasWidth,
    canvasHeight,
    pixelRatio,
  });
}

/** Resolve the WebGL backing-buffer region consumed by a FRAME surface filter instruction. */
export function resolveWebGLRenderFrameSurfaceFilterRegion({
  node,
  frameSurfaceFilterStack,
  transform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: {
  readonly node: RenderFrameNode;
  readonly frameSurfaceFilterStack: ResolvedEffectStack;
  readonly transform: AffineMatrix;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
}): WebGLEffectRenderRegion {
  if (node.surfaceFilterAttr === undefined) {
    throw new Error(`WebGL frame surface filter region requires surfaceFilterAttr for node ${node.id}`);
  }
  const inputBounds = getRenderFrameLocalSurfaceFilterInputBounds(node);
  if (inputBounds === null) {
    throw new Error(`WebGL frame surface filter region cannot resolve surface input bounds for node ${node.id}`);
  }
  if (frameSurfaceFilterStack.allEffects.length === 0) {
    throw new Error(`WebGL frame surface filter region requires surface filter effects for node ${node.id}`);
  }
  return resolveWebGLEffectRenderRegion({
    localBounds: boundsToLocalEffectBounds(inputBounds),
    effects: frameSurfaceFilterStack.allEffects,
    transform,
    canvasWidth,
    canvasHeight,
    pixelRatio,
  });
}

/**
 * Convert shared SVG/Figma effect bounds into a WebGL backing-buffer
 * scissor region. The Y coordinate is expressed in WebGL's bottom-left
 * scissor space, while the input transform and bounds are in renderer
 * top-left screen coordinates.
 */
function resolveWebGLEffectRenderRegion({
  localBounds,
  effects,
  transform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: ResolveWebGLEffectRenderRegionParams): WebGLEffectRenderRegion {
  const effectBounds = resolveEffectBounds(effects, localBounds);
  return localEffectBoundsToWebGLRenderRegion({
    localBounds: effectBounds,
    transform,
    canvasWidth,
    canvasHeight,
    pixelRatio,
  });
}

/** Resolve the WebGL backing-buffer region occupied by a RenderNode subtree's visual output. */
export function resolveWebGLRenderNodeSubtreeVisualOutputRegion({
  node,
  transform,
  visualTransform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: {
  readonly node: RenderNode;
  readonly transform: AffineMatrix;
  readonly visualTransform: RenderNodeVisualTransform;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelRatio: number;
}): WebGLEffectRenderRegion {
  const bounds = resolveRenderNodeLocalSubtreeVisualBounds({ node, visualTransform });
  if (bounds === null) {
    throw new Error(`WebGL effect render region cannot resolve local visual output bounds for node ${node.id}`);
  }
  return localEffectBoundsToWebGLRenderRegion({
    localBounds: boundsToLocalEffectBounds(bounds),
    transform,
    canvasWidth,
    canvasHeight,
    pixelRatio,
  });
}
