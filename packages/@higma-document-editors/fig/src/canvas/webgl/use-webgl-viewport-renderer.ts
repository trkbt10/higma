/** @file Fig editor wrapper around the renderer-owned WebGL pipeline. */
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import {
  useWebGLViewportPipeline,
  type WebGLViewportPipelineState,
  type WebGLViewportPipelineParams,
} from "@higma-document-renderers/fig/webgl/react";

export type UseFigWebGLViewportRendererOptions = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly viewportScale: number;
  readonly viewportRevision?: number;
  readonly initializationDelayMs?: number;
  readonly onMetrics?: WebGLViewportPipelineParams["onMetrics"];
};

/** Use the shared WebGL viewport renderer lifecycle from the renderer package. */
export function useFigWebGLViewportRenderer({
  sceneGraph,
  renderOptions,
  viewportScale,
  viewportRevision,
  initializationDelayMs,
  onMetrics,
}: UseFigWebGLViewportRendererOptions): WebGLViewportPipelineState {
  return useWebGLViewportPipeline({
    sceneGraph,
    renderOptions,
    viewportScale,
    viewportRevision,
    initializationDelayMs,
    onMetrics,
    errorContext: "useFigWebGLViewportRenderer",
  });
}
