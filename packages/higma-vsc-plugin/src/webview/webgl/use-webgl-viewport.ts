/**
 * @file React hook that drives a `createWebGLFigmaRenderer` for the
 * vsc-plugin's preview canvas.
 *
 * Thin wrapper around the shared `useWebGLViewportPipeline` SoT. Hit
 * testing happens against the document model (see
 * `geometry/node-bounds`) — this hook does not own any selection
 * state, only paint state.
 */

import type { SceneGraph } from "@higma-document-models/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import {
  useWebGLViewportPipeline,
  type WebGLViewportPipelineState,
} from "@higma-document-renderers/fig/webgl/react";

type UseWebGLViewportParams = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
  /** CSS-pixel scale (1 == 100%). Combines with devicePixelRatio. */
  readonly viewportScale: number;
  /**
   * Defer renderer creation by this many ms after mount. Lets React
   * commit the loading overlay before the synchronous program-compile
   * pass starts. Keep small (~16ms / one frame) for snappy feel.
   */
  readonly initializationDelayMs?: number;
};

export function useWebGLViewport(params: UseWebGLViewportParams): WebGLViewportPipelineState {
  return useWebGLViewportPipeline({
    ...params,
    errorContext: "useWebGLViewport",
  });
}
