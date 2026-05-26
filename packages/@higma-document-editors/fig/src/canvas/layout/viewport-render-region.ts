/** @file Renderer viewport region derived from EditorCanvas viewport state. */

import type { ViewportSize, ViewportTransform } from "@higma-editor-kernel/core/viewport";
const MIN_RENDER_REGION_SIZE = 1;

export type ViewportRenderContext = {
  readonly viewport: ViewportTransform;
  readonly viewportSize: ViewportSize;
  readonly rulerThickness: number;
};

export type ViewportRenderRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
};

/** Resolve the world-space region and screen-pixel surface consumed by renderer backends. */
export function resolveViewportRenderRegion({
  context,
}: {
  readonly context: ViewportRenderContext | null;
}): ViewportRenderRegion | null {
  if (!context || context.viewportSize.width <= 0 || context.viewportSize.height <= 0 || context.viewport.scale <= 0) {
    return null;
  }

  const surfaceWidth = Math.max(MIN_RENDER_REGION_SIZE, context.viewportSize.width - context.rulerThickness);
  const surfaceHeight = Math.max(MIN_RENDER_REGION_SIZE, context.viewportSize.height - context.rulerThickness);

  return {
    x: -context.viewport.translateX / context.viewport.scale,
    y: -context.viewport.translateY / context.viewport.scale,
    width: surfaceWidth / context.viewport.scale,
    height: surfaceHeight / context.viewport.scale,
    surfaceWidth,
    surfaceHeight,
  };
}
