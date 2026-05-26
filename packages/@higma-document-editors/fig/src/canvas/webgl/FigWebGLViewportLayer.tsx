/** @file WebGL viewport layer for Fig editor rendering. */
import { useCallback, useEffect, useMemo, type CSSProperties } from "react";
import type { SceneGraph, SceneGraphNodeTranslation } from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import {
  type WebGLFigmaRendererMetrics,
  type WebGLViewportRendererControllerSnapshot,
} from "@higma-document-renderers/fig/webgl";
import { FigWebGLViewportLoadingOverlay } from "../status/FigWebGLViewportLoadingOverlay";
import type { FigEditorWebGLSurfaceIdentity } from "./fig-editor-webgl-surface-state";
import {
  clearFigEditorWebGLSurfaceState,
  publishFigEditorWebGLSurfaceMetrics,
  publishFigEditorWebGLSurfaceStatus,
} from "./fig-editor-webgl-surface-registry";
import {
  useFigWebGLViewportRenderer,
  type UseFigWebGLViewportRendererOptions,
} from "./use-webgl-viewport-renderer";

export type FigWebGLViewportLayerProps = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly kiwiDocumentMutation: UseFigWebGLViewportRendererOptions["kiwiDocumentMutation"];
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly viewportScale: number;
  readonly viewportRevision?: number;
  readonly viewportInteractionActive?: boolean;
  readonly sceneGraphInteractionRevision?: number;
  readonly sceneGraphInteractionActive?: boolean;
  readonly sceneGraphNodeTranslation?: SceneGraphNodeTranslation;
  readonly initializationDelayMs?: number;
  readonly surface: FigEditorWebGLSurfaceIdentity;
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

/** Render a scene graph through WebGL. */
export function FigWebGLViewportLayer({
  sceneGraph,
  renderOptions,
  kiwiDocumentMutation,
  surfaceWidth,
  surfaceHeight,
  viewportScale,
  viewportRevision,
  viewportInteractionActive,
  sceneGraphInteractionRevision,
  sceneGraphInteractionActive,
  sceneGraphNodeTranslation,
  initializationDelayMs,
  surface,
}: FigWebGLViewportLayerProps) {
  const handleMetrics = useCallback((_canvas: HTMLCanvasElement, metrics: WebGLFigmaRendererMetrics) => {
    publishFigEditorWebGLSurfaceMetrics({
      surfaceKey: surface.surfaceKey,
      kind: surface.kind,
      label: surface.label,
      rootGuidKey: surface.rootGuidKey,
    }, metrics);
  }, [surface.kind, surface.label, surface.rootGuidKey, surface.surfaceKey]);

  const handleControllerSnapshot = useCallback((snapshot: WebGLViewportRendererControllerSnapshot) => {
    publishFigEditorWebGLSurfaceStatus({
      ...surface,
      ready: snapshot.isReady,
      status: snapshot.status,
      pixelRatio: snapshot.pixelRatio,
      canvasWidth: surfaceWidth,
      canvasHeight: surfaceHeight,
      kiwiDocumentMutationRevision: kiwiDocumentMutation.revision,
      kiwiDocumentMutationChangedGuidKeys: kiwiDocumentMutation.changedGuidKeys,
      controllerInputRevision: snapshot.inputRevision,
      controllerInputSceneViewport: snapshot.inputSceneViewport,
      controllerInputKiwiDocumentMutationRevision: snapshot.inputKiwiDocumentMutationRevision,
      controllerInputKiwiDocumentMutationChangedGuidKeys: snapshot.inputKiwiDocumentMutationChangedGuidKeys,
      renderRevision: snapshot.renderRevision,
      lastRenderedSceneViewport: snapshot.lastRenderedSceneViewport,
      lastRenderedKiwiDocumentMutationRevision: snapshot.lastRenderedKiwiDocumentMutationRevision,
      lastRenderedKiwiDocumentMutationChangedGuidKeys: snapshot.lastRenderedKiwiDocumentMutationChangedGuidKeys,
      metricsRevision: 0,
    });
  }, [
    kiwiDocumentMutation.changedGuidKeys,
    kiwiDocumentMutation.revision,
    surface,
    surfaceHeight,
    surfaceWidth,
  ]);

  const state = useFigWebGLViewportRenderer({
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
    onMetrics: handleMetrics,
    onSnapshot: handleControllerSnapshot,
  });
  const renderedCanvasStyle = useMemo(() => canvasStyle, []);

  useEffect(() => {
    return () => clearFigEditorWebGLSurfaceState(surface.surfaceKey);
  }, [surface.surfaceKey]);

  return (
    <div style={hostStyle}>
      <canvas
        ref={state.canvasRef}
        width={surfaceWidth}
        height={surfaceHeight}
        style={renderedCanvasStyle}
        role="img"
        aria-label={surface.label}
        aria-busy={state.isReady ? "false" : "true"}
      />
      <FigWebGLViewportLoadingOverlay status={state.status} />
    </div>
  );
}
