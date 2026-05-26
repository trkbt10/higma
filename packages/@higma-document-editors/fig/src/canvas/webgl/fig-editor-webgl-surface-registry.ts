/** @file Live registry for Fig editor WebGL surfaces read by operation surface automation. */
import type { WebGLFigmaRendererMetrics } from "@higma-document-renderers/fig/webgl";
import type {
  FigEditorWebGLSurfaceIdentity,
  FigEditorWebGLSurfaceSnapshot,
  FigEditorWebGLSurfaceState,
} from "./fig-editor-webgl-surface-state";

type FigEditorWebGLSurfaceSceneViewport = FigEditorWebGLSurfaceSnapshot["controllerInputSceneViewport"];

const webGLSurfaceStates = new Map<string, FigEditorWebGLSurfaceState>();

function cloneWebGLRendererMetrics(
  metrics: WebGLFigmaRendererMetrics | undefined,
): WebGLFigmaRendererMetrics | undefined {
  if (metrics === undefined) {
    return undefined;
  }
  return { ...metrics };
}

function cloneWebGLSurfaceSceneViewport(
  viewport: FigEditorWebGLSurfaceSceneViewport,
): FigEditorWebGLSurfaceSceneViewport {
  if (viewport === undefined) {
    return undefined;
  }
  return { ...viewport };
}

function cloneWebGLSurfaceState(state: FigEditorWebGLSurfaceState): FigEditorWebGLSurfaceSnapshot {
  return {
    ...state,
    status: { ...state.status },
    kiwiDocumentMutationChangedGuidKeys: [...state.kiwiDocumentMutationChangedGuidKeys],
    controllerInputSceneViewport: cloneWebGLSurfaceSceneViewport(state.controllerInputSceneViewport),
    controllerInputKiwiDocumentMutationChangedGuidKeys: [...state.controllerInputKiwiDocumentMutationChangedGuidKeys],
    lastRenderedSceneViewport: cloneWebGLSurfaceSceneViewport(state.lastRenderedSceneViewport),
    lastRenderedKiwiDocumentMutationChangedGuidKeys: [...state.lastRenderedKiwiDocumentMutationChangedGuidKeys],
    metrics: cloneWebGLRendererMetrics(state.metrics),
  };
}

/** Publish the current readiness/status state for one Fig editor WebGL surface. */
export function publishFigEditorWebGLSurfaceState(state: FigEditorWebGLSurfaceState): void {
  webGLSurfaceStates.set(state.surfaceKey, cloneWebGLSurfaceState(state));
}

/** Publish status fields while preserving the last renderer metrics for the same surface. */
export function publishFigEditorWebGLSurfaceStatus(
  state: Omit<FigEditorWebGLSurfaceState, "metrics">,
): void {
  const previous = webGLSurfaceStates.get(state.surfaceKey);
  publishFigEditorWebGLSurfaceState({
    ...state,
    metricsRevision: previous?.metricsRevision ?? state.metricsRevision,
    metrics: previous?.metrics,
  });
}

/** Publish fresh WebGL renderer metrics for an already registered Fig editor surface. */
export function publishFigEditorWebGLSurfaceMetrics(
  identity: FigEditorWebGLSurfaceIdentity,
  metrics: WebGLFigmaRendererMetrics,
): void {
  const previous = webGLSurfaceStates.get(identity.surfaceKey);
  if (previous === undefined) {
    throw new Error(`publishFigEditorWebGLSurfaceMetrics requires registered WebGL surface ${identity.surfaceKey}`);
  }
  publishFigEditorWebGLSurfaceState({
    ...previous,
    ...identity,
    metricsRevision: previous.metricsRevision + 1,
    metrics,
  });
}

/** Remove one Fig editor WebGL surface from the runtime registry. */
export function clearFigEditorWebGLSurfaceState(surfaceKey: string): void {
  webGLSurfaceStates.delete(surfaceKey);
}

/** Snapshot all registered Fig editor WebGL surfaces for automation. */
export function snapshotFigEditorWebGLSurfaces(): readonly FigEditorWebGLSurfaceSnapshot[] {
  return Array.from(webGLSurfaceStates.values()).map(cloneWebGLSurfaceState);
}

/** Require one registered Fig editor WebGL surface snapshot by key. */
export function requireFigEditorWebGLSurfaceSnapshot(surfaceKey: string): FigEditorWebGLSurfaceSnapshot {
  const state = webGLSurfaceStates.get(surfaceKey);
  if (state === undefined) {
    throw new Error(`Fig editor WebGL surface ${surfaceKey} is not registered`);
  }
  return cloneWebGLSurfaceState(state);
}
