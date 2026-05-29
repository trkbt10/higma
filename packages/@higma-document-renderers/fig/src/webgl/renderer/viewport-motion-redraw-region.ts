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

export type ScaledViewportMotionRedrawRegion = {
  readonly sourceRegion: WebGLEffectRenderRegion;
  readonly targetRegion: WebGLEffectRenderRegion;
  /**
   * True when the current viewport extends beyond the cached frame (zoom-out
   * reveals area the cached frame never covered). The caller must clear the
   * output to the background before blitting, because the scaled blit only
   * fills `targetRegion`; the remaining margin shows background until the
   * deferred settled render repaints it at full fidelity.
   */
  readonly needsBackgroundClear: boolean;
};

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Resolve a scaled-blit mapping that presents the cached settled frame at a
 * changed viewport scale (zoom). The cached frame covers `previousViewport`
 * stretched across the whole backing buffer; this maps the sub-rectangle of
 * that cache which corresponds to the current (zoomed) viewport onto the
 * output, magnifying or minifying it.
 *
 * Unlike the pan path this is intentionally lossy during the gesture — the
 * caller must keep the original sharp cache and schedule a full settled
 * render to restore fidelity once the gesture settles. Returns `null` when
 * the current viewport shares no area with the cache (caller falls back to a
 * full render).
 */
export function resolveScaledViewportMotionRedrawRegion(
  input: ResolveViewportMotionRedrawRegionInput,
): ScaledViewportMotionRedrawRegion | null {
  requirePositiveFiniteNumber(input.previousViewport.width, "previous viewport width");
  requirePositiveFiniteNumber(input.previousViewport.height, "previous viewport height");
  requirePositiveFiniteNumber(input.currentViewport.width, "current viewport width");
  requirePositiveFiniteNumber(input.currentViewport.height, "current viewport height");
  requirePositiveFiniteNumber(input.surfaceWidth, "surface width");
  requirePositiveFiniteNumber(input.surfaceHeight, "surface height");
  requirePositiveFiniteNumber(input.pixelRatio, "pixelRatio");
  const { previousViewport: previous, currentViewport: current } = input;
  const backingWidth = Math.round(input.surfaceWidth * input.pixelRatio);
  const backingHeight = Math.round(input.surfaceHeight * input.pixelRatio);

  // Current-viewport edges expressed as cache-space unit coordinates
  // (top-down: u along x, v along y), where [0,1] spans the cached frame.
  const u0 = (current.x - previous.x) / previous.width;
  const u1 = (current.x + current.width - previous.x) / previous.width;
  const v0 = (current.y - previous.y) / previous.height;
  const v1 = (current.y + current.height - previous.y) / previous.height;

  const cu0 = clampUnitInterval(u0);
  const cu1 = clampUnitInterval(u1);
  const cv0 = clampUnitInterval(v0);
  const cv1 = clampUnitInterval(v1);
  if (cu1 <= cu0 || cv1 <= cv0) {
    return null;
  }

  // Source sub-rect of the cached backing buffer (bottom-left scissor space).
  const srcLeft = Math.round(cu0 * backingWidth);
  const srcRight = Math.round(cu1 * backingWidth);
  const srcBottom = Math.round(backingHeight - cv1 * backingHeight);
  const srcTop = Math.round(backingHeight - cv0 * backingHeight);

  // Target sub-rect of the output: where the clamped cache region lands once
  // the full current viewport is stretched across the output backing buffer.
  const uSpan = u1 - u0;
  const vSpan = v1 - v0;
  const tu0 = (cu0 - u0) / uSpan;
  const tu1 = (cu1 - u0) / uSpan;
  const tv0 = (cv0 - v0) / vSpan;
  const tv1 = (cv1 - v0) / vSpan;
  const tgtLeft = Math.round(tu0 * backingWidth);
  const tgtRight = Math.round(tu1 * backingWidth);
  const tgtBottom = Math.round(backingHeight - tv1 * backingHeight);
  const tgtTop = Math.round(backingHeight - tv0 * backingHeight);
  if (srcRight <= srcLeft || srcTop <= srcBottom || tgtRight <= tgtLeft || tgtTop <= tgtBottom) {
    return null;
  }

  return {
    sourceRegion: effectRegionFromEdges({ left: srcLeft, bottom: srcBottom, right: srcRight, top: srcTop }),
    targetRegion: effectRegionFromEdges({ left: tgtLeft, bottom: tgtBottom, right: tgtRight, top: tgtTop }),
    needsBackgroundClear: cu0 > u0 || cu1 < u1 || cv0 > v0 || cv1 < v1,
  };
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
