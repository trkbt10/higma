/** @file React binding for the WebGL viewport renderer controller. */

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  createWebGLViewportRendererGlobalThisScheduler,
  createWebGLViewportRendererController,
  getInitialWebGLViewportRendererControllerSnapshot,
  hasWebGLViewportRendererGlobalThisSchedulerHost,
  type WebGLViewportRendererController,
  type WebGLViewportRendererControllerInput,
  type WebGLViewportRendererControllerSnapshot,
} from "../viewport/webgl-viewport-renderer-controller";

export type WebGLViewportPipelineParams = Omit<WebGLViewportRendererControllerInput, "canvas">;

export type WebGLViewportPipelineState = WebGLViewportRendererControllerSnapshot & {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
};

function createGlobalThisController(): WebGLViewportRendererController | null {
  if (!hasWebGLViewportRendererGlobalThisSchedulerHost(globalThis)) {
    return null;
  }
  return createWebGLViewportRendererController(
    createWebGLViewportRendererGlobalThisScheduler(globalThis),
  );
}

/** Subscribe React to the renderer-owned WebGL viewport controller. */
export function useWebGLViewportPipeline({
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
  errorContext,
}: WebGLViewportPipelineParams): WebGLViewportPipelineState {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<WebGLViewportRendererController | null>(null);

  const getOrCreateController = useCallback(() => {
    const existing = controllerRef.current;
    if (existing !== null) {
      return existing;
    }
    const created = createGlobalThisController();
    controllerRef.current = created;
    return created;
  }, []);

  const subscribe = useCallback((listener: () => void) => {
    const controller = getOrCreateController();
    if (controller === null) {
      return () => undefined;
    }
    return controller.subscribe(listener);
  }, [getOrCreateController]);

  const getSnapshot = useCallback(() => {
    const controller = controllerRef.current;
    if (controller === null) {
      return getInitialWebGLViewportRendererControllerSnapshot();
    }
    return controller.getSnapshot();
  }, []);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getInitialWebGLViewportRendererControllerSnapshot,
  );

  useEffect(() => {
    const controller = getOrCreateController();
    if (controller === null) {
      return;
    }
    controller.update({
      canvas: canvasRef.current,
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
      errorContext,
    });
  }, [
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
    errorContext,
    getOrCreateController,
  ]);

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  return {
    ...snapshot,
    canvasRef,
  };
}
