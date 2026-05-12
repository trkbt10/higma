/** @file Shared viewport layout planning for fig editor renderer backends. */

import type { ViewportSize, ViewportTransform } from "@higma-editor-kernel/core/viewport";
import type { SceneGraph } from "@higma-document-models/fig/scene-graph";

const MIN_RENDER_WINDOW_SIZE = 1;

export type ViewportRenderContext = {
  readonly viewport: ViewportTransform;
  readonly viewportSize: ViewportSize;
  readonly rulerThickness: number;
};

export type ViewportRenderWindow = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
};

export type ViewportLayerPlacement = "screen" | "world";

export type ViewportLayerFrame = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** Resolve the world-space window and pixel surface consumed by renderer backends. */
export function resolveViewportRenderWindow({
  context,
}: {
  readonly context: ViewportRenderContext | null;
}): ViewportRenderWindow | null {
  if (!context || context.viewportSize.width <= 0 || context.viewportSize.height <= 0 || context.viewport.scale <= 0) {
    return null;
  }

  const surfaceWidth = Math.max(MIN_RENDER_WINDOW_SIZE, context.viewportSize.width - context.rulerThickness);
  const surfaceHeight = Math.max(MIN_RENDER_WINDOW_SIZE, context.viewportSize.height - context.rulerThickness);

  return {
    x: -context.viewport.translateX / context.viewport.scale,
    y: -context.viewport.translateY / context.viewport.scale,
    width: surfaceWidth / context.viewport.scale,
    height: surfaceHeight / context.viewport.scale,
    surfaceWidth,
    surfaceHeight,
  };
}

/** Resolve backend DOM placement from the same scene graph viewport contract. */
export function resolveViewportLayerFrame({
  sceneGraph,
  placement,
}: {
  readonly sceneGraph: SceneGraph;
  readonly placement: ViewportLayerPlacement;
}): ViewportLayerFrame {
  if (placement === "screen") {
    return {
      left: 0,
      top: 0,
      width: sceneGraph.width,
      height: sceneGraph.height,
    };
  }

  const viewport = sceneGraph.viewport ?? {
    x: 0,
    y: 0,
    width: sceneGraph.width,
    height: sceneGraph.height,
  };

  return {
    left: viewport.x,
    top: viewport.y,
    width: viewport.width,
    height: viewport.height,
  };
}
