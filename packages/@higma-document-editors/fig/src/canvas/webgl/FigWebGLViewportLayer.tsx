/** @file WebGL viewport layer composition for the fig editor. */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { FigWebGLViewportLoadingOverlay } from "../status/FigWebGLViewportLoadingOverlay";
import { resolveViewportLayerFrame, type ViewportLayerPlacement } from "../layout/viewport-render-plan";
import { FigWebGLViewportCanvas } from "./FigWebGLViewportCanvas";
import { useWebGLViewportRenderer } from "./use-webgl-viewport-renderer";

type FigWebGLViewportLayerProps = {
  readonly sceneGraph: SceneGraph;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly viewportScale: number;
  readonly placement?: ViewportLayerPlacement;
  readonly initializationDelayMs?: number;
};

/** Compose the WebGL viewport canvas with lifecycle state and loading UI. */
export function FigWebGLViewportLayer({
  sceneGraph,
  renderOptions,
  viewportScale,
  placement = "world",
  initializationDelayMs,
}: FigWebGLViewportLayerProps) {
  const frame = resolveViewportLayerFrame({ sceneGraph, placement });
  const renderer = useWebGLViewportRenderer({ sceneGraph, renderOptions, viewportScale, initializationDelayMs });
  const loadingOverlay = renderer.isReady ? null : <FigWebGLViewportLoadingOverlay frame={frame} status={renderer.status} />;

  if (sceneGraph.width <= 0 || sceneGraph.height <= 0) {
    return null;
  }

  if (!sceneGraph.viewport) {
    throw new Error("FigWebGLViewportLayer requires sceneGraph.viewport");
  }

  return (
    <>
      <FigWebGLViewportCanvas
        canvasRef={renderer.canvasRef}
        frame={frame}
        width={sceneGraph.width}
        height={sceneGraph.height}
        pixelRatio={renderer.pixelRatio}
        isReady={renderer.isReady}
      />
      {loadingOverlay}
    </>
  );
}
