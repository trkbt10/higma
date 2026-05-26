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
  readonly kiwiDocumentMutation: WebGLViewportPipelineParams["kiwiDocumentMutation"];
  readonly viewportScale: number;
  readonly viewportRevision?: number;
  readonly viewportInteractionActive?: boolean;
  readonly sceneGraphInteractionRevision?: number;
  readonly sceneGraphInteractionActive?: boolean;
  readonly sceneGraphNodeTranslation?: WebGLViewportPipelineParams["sceneGraphNodeTranslation"];
  readonly initializationDelayMs?: number;
  readonly onMetrics?: WebGLViewportPipelineParams["onMetrics"];
  readonly onSnapshot?: WebGLViewportPipelineParams["onSnapshot"];
};

/** Use the shared WebGL viewport renderer lifecycle from the renderer package. */
export function useFigWebGLViewportRenderer({
  sceneGraph,
  renderOptions,
  kiwiDocumentMutation,
  viewportScale,
  viewportRevision,
  viewportInteractionActive,
  sceneGraphInteractionRevision,
  sceneGraphInteractionActive,
  sceneGraphNodeTranslation,
  initializationDelayMs,
  onMetrics,
  onSnapshot,
}: UseFigWebGLViewportRendererOptions): WebGLViewportPipelineState {
  return useWebGLViewportPipeline({
    sceneGraph,
    renderOptions,
    kiwiDocumentMutation,
    viewportScale,
    viewportRevision,
    viewportInteractionActive,
    sceneGraphInteractionRevision,
    sceneGraphInteractionActive,
    sceneGraphNodeTranslation,
    initializationDelayMs,
    onMetrics,
    onSnapshot,
    errorContext: "useFigWebGLViewportRenderer",
  });
}
