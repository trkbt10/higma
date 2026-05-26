/** @file Redraw regions for WebGL viewport motion from a settled framebuffer cache. */

import type { WebGLEffectRenderRegion } from "../effects/effect-render-region";
import type { ViewportRect } from "../../scene-graph";

export type ViewportMotionSceneViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ViewportMotionRedrawRegion = {
  readonly sourceRegion: WebGLEffectRenderRegion;
  readonly targetRegion: WebGLEffectRenderRegion;
  readonly exposedViewportRegions: readonly ViewportRect[];
};

export type ResolveViewportMotionRedrawRegionInput = {
  readonly previousViewport: ViewportMotionSceneViewport;
  readonly currentViewport: ViewportMotionSceneViewport;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly pixelRatio: number;
};

type BackingPixelOffset = {
  readonly x: number;
  readonly y: number;
};

function requirePositiveFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Viewport-motion redraw region requires positive finite ${label}, got ${value}`);
  }
}

function sameViewportScale(
  previousViewport: ViewportMotionSceneViewport,
  currentViewport: ViewportMotionSceneViewport,
): boolean {
  return previousViewport.width === currentViewport.width &&
    previousViewport.height === currentViewport.height;
}

function resolveBackingPixelOffset({
  previousViewport,
  currentViewport,
  surfaceWidth,
  surfaceHeight,
  pixelRatio,
}: ResolveViewportMotionRedrawRegionInput): BackingPixelOffset {
  const cssPixelsPerWorldX = surfaceWidth / currentViewport.width;
  const cssPixelsPerWorldY = surfaceHeight / currentViewport.height;
  const cssOffsetX = (previousViewport.x - currentViewport.x) * cssPixelsPerWorldX;
  const cssOffsetY = (previousViewport.y - currentViewport.y) * cssPixelsPerWorldY;
  return {
    x: Math.round(cssOffsetX * pixelRatio),
    y: -Math.round(cssOffsetY * pixelRatio),
  };
}

function effectRegionFromEdges({
  left,
  bottom,
  right,
  top,
}: {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}): WebGLEffectRenderRegion {
  return {
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
  };
}

function viewportRectFromBackingEdges({
  left,
  bottom,
  right,
  top,
  backingHeight,
  pixelRatio,
}: {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
  readonly backingHeight: number;
  readonly pixelRatio: number;
}): ViewportRect {
  return {
    x: left / pixelRatio,
    y: (backingHeight - top) / pixelRatio,
    width: (right - left) / pixelRatio,
    height: (top - bottom) / pixelRatio,
  };
}

function appendViewportRectFromBackingEdges(
  regions: ViewportRect[],
  input: Parameters<typeof viewportRectFromBackingEdges>[0],
): void {
  if (input.right <= input.left || input.top <= input.bottom) {
    return;
  }
  regions.push(viewportRectFromBackingEdges(input));
}

function exposedViewportRegions({
  offset,
  backingWidth,
  backingHeight,
  pixelRatio,
}: {
  readonly offset: BackingPixelOffset;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly pixelRatio: number;
}): readonly ViewportRect[] {
  const regions: ViewportRect[] = [];
  if (offset.x > 0) {
    appendViewportRectFromBackingEdges(regions, {
      left: 0,
      bottom: 0,
      right: offset.x,
      top: backingHeight,
      backingHeight,
      pixelRatio,
    });
  }
  if (offset.x < 0) {
    appendViewportRectFromBackingEdges(regions, {
      left: backingWidth + offset.x,
      bottom: 0,
      right: backingWidth,
      top: backingHeight,
      backingHeight,
      pixelRatio,
    });
  }

  const horizontalLeft = Math.max(0, offset.x);
  const horizontalRight = Math.min(backingWidth, backingWidth + offset.x);
  if (offset.y > 0) {
    appendViewportRectFromBackingEdges(regions, {
      left: horizontalLeft,
      bottom: 0,
      right: horizontalRight,
      top: offset.y,
      backingHeight,
      pixelRatio,
    });
  }
  if (offset.y < 0) {
    appendViewportRectFromBackingEdges(regions, {
      left: horizontalLeft,
      bottom: backingHeight + offset.y,
      right: horizontalRight,
      top: backingHeight,
      backingHeight,
      pixelRatio,
    });
  }
  return regions;
}

/** Resolve framebuffer copy and redraw regions for a viewport-only pan. */
export function resolveViewportMotionRedrawRegion(
  input: ResolveViewportMotionRedrawRegionInput,
): ViewportMotionRedrawRegion | null {
  requirePositiveFiniteNumber(input.previousViewport.width, "previous viewport width");
  requirePositiveFiniteNumber(input.previousViewport.height, "previous viewport height");
  requirePositiveFiniteNumber(input.currentViewport.width, "current viewport width");
  requirePositiveFiniteNumber(input.currentViewport.height, "current viewport height");
  requirePositiveFiniteNumber(input.surfaceWidth, "surface width");
  requirePositiveFiniteNumber(input.surfaceHeight, "surface height");
  requirePositiveFiniteNumber(input.pixelRatio, "pixelRatio");
  if (!sameViewportScale(input.previousViewport, input.currentViewport)) {
    return null;
  }
  const backingWidth = Math.round(input.surfaceWidth * input.pixelRatio);
  const backingHeight = Math.round(input.surfaceHeight * input.pixelRatio);
  const offset = resolveBackingPixelOffset(input);
  if (offset.x === 0 && offset.y === 0) {
    return null;
  }
  if (Math.abs(offset.x) >= backingWidth || Math.abs(offset.y) >= backingHeight) {
    return null;
  }
  const targetLeft = Math.max(0, offset.x);
  const targetRight = Math.min(backingWidth, backingWidth + offset.x);
  const targetBottom = Math.max(0, offset.y);
  const targetTop = Math.min(backingHeight, backingHeight + offset.y);
  if (targetRight <= targetLeft || targetTop <= targetBottom) {
    return null;
  }
  return {
    sourceRegion: effectRegionFromEdges({
      left: targetLeft - offset.x,
      bottom: targetBottom - offset.y,
      right: targetRight - offset.x,
      top: targetTop - offset.y,
    }),
    targetRegion: effectRegionFromEdges({
      left: targetLeft,
      bottom: targetBottom,
      right: targetRight,
      top: targetTop,
    }),
    exposedViewportRegions: exposedViewportRegions({
      offset,
      backingWidth,
      backingHeight,
      pixelRatio: input.pixelRatio,
    }),
  };
}
