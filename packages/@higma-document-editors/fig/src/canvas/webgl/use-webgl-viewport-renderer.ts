/** @file WebGL viewport renderer lifecycle and resource preparation hook. */

import type { SceneGraph } from "@higma-document-models/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import {
  useWebGLViewportPipeline,
  type WebGLViewportPipelineState,
} from "@higma-document-renderers/fig/webgl/react";

type UseWebGLViewportRendererParams = {
  readonly sceneGraph: SceneGraph;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly viewportScale: number;
  readonly initializationDelayMs?: number;
};

/**
 * Manage WebGL renderer creation, resource preparation, rendering, and metrics.
 *
 * Surfaces renderer metrics on the canvas dataset (`data-webgl-*`) so the
 * editor's WebGL Playwright tests can assert on prepare/render counts.
 *
 * The hook returns a `WebGLViewportPipelineState` (owned by
 * `@higma-document-renderers/fig/webgl/react`) — consumers that need the
 * type must import that name directly from its origin.
 */
export function useWebGLViewportRenderer(
  params: UseWebGLViewportRendererParams,
): WebGLViewportPipelineState {
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
