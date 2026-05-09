/** @file WebGL viewport renderer lifecycle and resource preparation hook. */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { FigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import {
  useWebGLViewportPipeline,
  type WebGLViewportPipelineState,
} from "@higma-document-renderers/fig/webgl/react";

type UseWebGLViewportRendererParams = {
  readonly sceneGraph: SceneGraph;
  readonly renderOptions?: FigFamilyRenderOptions;
  readonly viewportScale: number;
  readonly initializationDelayMs?: number;
};

export type WebGLViewportRendererState = WebGLViewportPipelineState;

/**
 * Manage WebGL renderer creation, resource preparation, rendering, and metrics.
 *
 * Surfaces renderer metrics on the canvas dataset (`data-webgl-*`) so the
 * editor's WebGL Playwright tests can assert on prepare/render counts.
 */
export function useWebGLViewportRenderer(
  params: UseWebGLViewportRendererParams,
): WebGLViewportRendererState {
  return useWebGLViewportPipeline({
    ...params,
    errorContext: "useWebGLViewportRenderer",
    onMetrics: (canvas, metrics) => {
      canvas.dataset.webglLastPrepareMs = metrics.lastPrepareMs.toFixed(3);
      canvas.dataset.webglPrepareCount = `${metrics.prepareCount}`;
      canvas.dataset.webglLastRenderMs = metrics.lastRenderMs.toFixed(3);
      canvas.dataset.webglRenderCount = `${metrics.renderCount}`;
    },
  });
}
