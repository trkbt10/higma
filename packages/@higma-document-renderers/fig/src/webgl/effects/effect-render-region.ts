/** @file WebGL scissor region derived from the shared effect bounds SoT. */

import { resolveEffectBounds, type Effect, type RenderFrameNode, type RenderNode } from "../../scene-graph";
import { getRenderNodeLocalBounds, transformBounds, type Bounds } from "../scene/render-culling";
import { pathContoursBoundingBox } from "@higma-primitives/path";
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

function boundsUnion(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

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

function renderNodeChildren(node: RenderNode): readonly RenderNode[] {
  switch (node.type) {
    case "group":
    case "frame":
      return node.children;
    case "rect":
    case "ellipse":
    case "path":
    case "text":
    case "image":
      return [];
  }
}

function renderNodeLocalSubtreeBounds(node: RenderNode): Bounds | null {
  const ownBounds = getRenderNodeLocalBounds(node);
  const childBounds = renderNodeChildren(node)
    .map((child) => {
      const bounds = renderNodeLocalSubtreeBounds(child);
      if (bounds === null) {
        return null;
      }
      return transformBounds(bounds, child.source.transform);
    })
    .filter((bounds): bounds is Bounds => bounds !== null);
  const allBounds = ownBounds === null ? childBounds : [ownBounds, ...childBounds];
  if (allBounds.length === 0) {
    return null;
  }
  return allBounds.slice(1).reduce(boundsUnion, allBounds[0]);
}

/** Resolve the local content bounds used when a whole RenderNode is captured for an effect. */
export function resolveRenderNodeLocalEffectBounds(node: RenderNode): LocalEffectBounds {
  const bounds = renderNodeLocalSubtreeBounds(node);
  if (bounds === null) {
    throw new Error(`WebGL effect render region cannot resolve local bounds for node ${node.id}`);
  }
  return boundsToLocalEffectBounds(bounds);
}

/** Resolve the local FRAME surface bounds used by SVG surface filters. */
export function resolveRenderFrameSurfaceLocalEffectBounds(node: RenderFrameNode): LocalEffectBounds {
  switch (node.sourceSurfaceShape.type) {
    case "rect":
      return {
        x: 0,
        y: 0,
        width: node.sourceSurfaceShape.width,
        height: node.sourceSurfaceShape.height,
      };
    case "path": {
      const bbox = pathContoursBoundingBox(node.sourceSurfaceShape.contours);
      if (bbox === undefined) {
        throw new Error(`WebGL effect render region cannot resolve surface path bounds for frame ${node.id}`);
      }
      return { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h };
    }
  }
}

/**
 * Convert shared SVG/Figma effect bounds into a WebGL backing-buffer
 * scissor region. The Y coordinate is expressed in WebGL's bottom-left
 * scissor space, while the input transform and bounds are in renderer
 * top-left screen coordinates.
 */
export function resolveWebGLEffectRenderRegion({
  localBounds,
  effects,
  transform,
  canvasWidth,
  canvasHeight,
  pixelRatio,
}: ResolveWebGLEffectRenderRegionParams): WebGLEffectRenderRegion {
  const ratio = requirePositivePixelRatio(pixelRatio);
  const effectBounds = resolveEffectBounds(effects, localBounds);
  const screenBounds = transformBounds(localEffectBoundsToBounds(effectBounds), transform);
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
