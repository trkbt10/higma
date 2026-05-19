/** @file WebGL viewport layer for Fig editor rendering. */
import type { CSSProperties } from "react";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { FigWebGLViewportLoadingOverlay } from "../status/FigWebGLViewportLoadingOverlay";
import { useFigWebGLViewportRenderer } from "./use-webgl-viewport-renderer";

export type FigWebGLViewportLayerProps = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly viewportScale: number;
  readonly viewportRevision?: number;
  readonly initializationDelayMs?: number;
};

type WebGLViewportMetrics = {
  readonly prepareCount: number;
  readonly renderCount: number;
  readonly lastPrepareMs: number;
  readonly lastRenderMs: number;
};

const hostStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  pointerEvents: "none",
};

const canvasStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "block",
};

function writeWebGLViewportMetrics(canvas: HTMLCanvasElement, metrics: WebGLViewportMetrics): void {
  canvas.setAttribute("data-webgl-prepare-count", String(metrics.prepareCount));
  canvas.setAttribute("data-webgl-render-count", String(metrics.renderCount));
  canvas.setAttribute("data-webgl-last-prepare-ms", String(metrics.lastPrepareMs));
  canvas.setAttribute("data-webgl-last-render-ms", String(metrics.lastRenderMs));
}

/** Render a scene graph through WebGL. */
export function FigWebGLViewportLayer({
  sceneGraph,
  renderOptions,
  viewportScale,
  viewportRevision,
  initializationDelayMs,
}: FigWebGLViewportLayerProps) {
  const state = useFigWebGLViewportRenderer({
    sceneGraph,
    renderOptions,
    viewportScale,
    viewportRevision,
    initializationDelayMs,
    onMetrics: writeWebGLViewportMetrics,
  });

  return (
    <div style={hostStyle} data-fig-editor-webgl-layer="">
      <canvas
        ref={state.canvasRef}
        width={sceneGraph?.width ?? 1}
        height={sceneGraph?.height ?? 1}
        style={canvasStyle}
        data-webgl-ready={state.isReady ? "true" : "false"}
        data-webgl-pixel-ratio={state.pixelRatio}
        data-webgl-prepare-count={0}
        data-webgl-render-count={0}
        data-webgl-last-prepare-ms={0}
        data-webgl-last-render-ms={0}
      />
      <FigWebGLViewportLoadingOverlay status={state.status} />
    </div>
  );
}
