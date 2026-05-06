/** @file WebGL viewport renderer lifecycle and resource preparation hook. */

import { useEffect, useRef, useState, type RefObject } from "react";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import {
  createWebGLFigmaRenderer,
  resolveWebGLViewportPixelRatio,
  type WebGLFigmaRendererInstance,
} from "@higma-document-renderers/fig/webgl";
import { getWebGLSceneResourceKey, isWebGLSceneResourceKeyEqual, type WebGLSceneResourceKey } from "./webgl-scene-resource-key";
import {
  getWebGLViewportPreparationStatus,
  type WebGLViewportPreparationStatus,
} from "./webgl-viewport-preparation-status";

type UseWebGLViewportRendererParams = {
  readonly sceneGraph: SceneGraph;
  readonly viewportScale: number;
  readonly initializationDelayMs?: number;
};

type PendingPrepare = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
};

type LatestRender = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
};

export type WebGLViewportRendererState = {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly pixelRatio: number;
  readonly isReady: boolean;
  readonly status: WebGLViewportPreparationStatus;
};

/** Manage WebGL renderer creation, resource preparation, rendering, and metrics. */
export function useWebGLViewportRenderer({
  sceneGraph,
  viewportScale,
  initializationDelayMs,
}: UseWebGLViewportRendererParams): WebGLViewportRendererState {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLFigmaRendererInstance | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const initializeFrameRef = useRef<number | null>(null);
  const initializeTimerRef = useRef<number | null>(null);
  const prepareRunningRef = useRef(false);
  const pendingPrepareRef = useRef<PendingPrepare | null>(null);
  const latestRenderRef = useRef<LatestRender | null>(null);
  const preparedResourceKeyRef = useRef<WebGLSceneResourceKey | null>(null);
  const disposedRef = useRef(false);
  const [status, setStatus] = useState(() => getWebGLViewportPreparationStatus("scheduled"));
  const [devicePixelRatio, setDevicePixelRatio] = useState(() => typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const pixelRatio = resolveWebGLViewportPixelRatio({
    devicePixelRatio,
    viewportScale,
    surfaceWidth: sceneGraph.width,
    surfaceHeight: sceneGraph.height,
  });

  useEffect(() => {
    if (typeof window === "undefined") { return; }
    const updatePixelRatio = () => {
      setDevicePixelRatio(window.devicePixelRatio || 1);
    };
    window.addEventListener("resize", updatePixelRatio);
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    media.addEventListener("change", updatePixelRatio);
    return () => {
      window.removeEventListener("resize", updatePixelRatio);
      media.removeEventListener("change", updatePixelRatio);
    };
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) { return; }
    if (initializationDelayMs !== undefined && (!Number.isFinite(initializationDelayMs) || initializationDelayMs < 0)) {
      throw new Error("useWebGLViewportRenderer requires a non-negative initializationDelayMs when provided");
    }

    const setPhase = (phase: WebGLViewportPreparationStatus["phase"]) => {
      if (!disposedRef.current) {
        setStatus(getWebGLViewportPreparationStatus(phase));
      }
    };

    const cancelInitializationSchedule = () => {
      if (initializeFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(initializeFrameRef.current);
        initializeFrameRef.current = null;
      }
      if (initializeTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(initializeTimerRef.current);
        initializeTimerRef.current = null;
      }
    };

    const writeMetrics = (renderer: WebGLFigmaRendererInstance) => {
      const metrics = renderer.getMetrics();
      canvas.dataset.webglLastPrepareMs = metrics.lastPrepareMs.toFixed(3);
      canvas.dataset.webglPrepareCount = `${metrics.prepareCount}`;
      canvas.dataset.webglLastRenderMs = metrics.lastRenderMs.toFixed(3);
      canvas.dataset.webglRenderCount = `${metrics.renderCount}`;
    };

    const createRenderer = (): WebGLFigmaRendererInstance => {
      setPhase("precompiling");
      const renderer = createWebGLFigmaRenderer({
        canvas,
        antialias: true,
        pixelRatio,
        backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
      });
      renderer.precompileResources();
      rendererRef.current = renderer;
      return renderer;
    };

    latestRenderRef.current = { scene: sceneGraph, pixelRatio };

    const renderScene = (renderer: WebGLFigmaRendererInstance, scene: SceneGraph, nextPixelRatio: number) => {
      renderFrameRef.current = null;
      setPhase("rendering");
      renderer.setPixelRatio(nextPixelRatio);
      renderer.render(scene);
      writeMetrics(renderer);
      setPhase("ready");
    };

    const requestRender = (renderer: WebGLFigmaRendererInstance, scene: SceneGraph, nextPixelRatio: number) => {
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
      }
      renderFrameRef.current = window.requestAnimationFrame(() => {
        renderScene(renderer, scene, nextPixelRatio);
      });
    };

    const runPrepareQueue = (renderer: WebGLFigmaRendererInstance) => {
      if (prepareRunningRef.current) {
        return;
      }
      const next = pendingPrepareRef.current;
      if (!next) {
        return;
      }
      pendingPrepareRef.current = null;
      prepareRunningRef.current = true;
      setPhase("preparing-resources");
      const resourceKey = getWebGLSceneResourceKey(next.scene);
      void renderer.prepareScene(next.scene).then(
        () => {
          prepareRunningRef.current = false;
          preparedResourceKeyRef.current = resourceKey;
          writeMetrics(renderer);
          const latest = latestRenderRef.current;
          if (latest?.scene === next.scene && latest.pixelRatio === next.pixelRatio) {
            renderer.setPixelRatio(next.pixelRatio);
            setPhase("rendering");
            renderer.render(next.scene);
            writeMetrics(renderer);
            setPhase("ready");
          }
          runPrepareQueue(renderer);
        },
        (error: unknown) => {
          prepareRunningRef.current = false;
          throw error;
        },
      );
    };

    const renderWithResources = (renderer: WebGLFigmaRendererInstance) => {
      const resourceKey = getWebGLSceneResourceKey(sceneGraph);
      if (!isWebGLSceneResourceKeyEqual(preparedResourceKeyRef.current, resourceKey)) {
        setPhase("scheduled");
        pendingPrepareRef.current = { scene: sceneGraph, pixelRatio };
        runPrepareQueue(renderer);
        return;
      }
      requestRender(renderer, sceneGraph, pixelRatio);
    };

    const initializeAndRender = () => {
      initializeFrameRef.current = null;
      const renderer = rendererRef.current ?? createRenderer();
      renderWithResources(renderer);
    };

    const scheduleInitialization = () => {
      if (typeof window === "undefined") {
        initializeAndRender();
        return;
      }
      cancelInitializationSchedule();
      setPhase("scheduled");
      const requestInitialize = () => {
        initializeFrameRef.current = window.requestAnimationFrame(initializeAndRender);
      };
      if (initializationDelayMs === undefined || initializationDelayMs === 0) {
        requestInitialize();
        return;
      }
      initializeTimerRef.current = window.setTimeout(requestInitialize, initializationDelayMs);
    };

    scheduleInitialization();

    return () => {
      cancelInitializationSchedule();
      if (renderFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
    };
  }, [sceneGraph, pixelRatio, initializationDelayMs]);

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (renderFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      pendingPrepareRef.current = null;
      latestRenderRef.current = null;
      preparedResourceKeyRef.current = null;
      setStatus(getWebGLViewportPreparationStatus("scheduled"));
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  return {
    canvasRef,
    pixelRatio,
    isReady: status.phase === "ready",
    status,
  };
}
