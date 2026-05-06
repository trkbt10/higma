/** @file WebGL viewport canvas for the fig editor. */

import { useEffect, useRef, useState } from "react";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import {
  createWebGLFigmaRenderer,
  resolveWebGLViewportPixelRatio,
  type WebGLFigmaRendererInstance,
} from "@higma-document-renderers/fig/webgl";
import { resolveViewportLayerFrame, type ViewportLayerPlacement } from "./viewport-render-plan";
import { getWebGLSceneResourceKey, isWebGLSceneResourceKeyEqual, type WebGLSceneResourceKey } from "./webgl-scene-resource-key";

type FigWebGLViewportCanvasProps = {
  readonly sceneGraph: SceneGraph;
  readonly viewportScale: number;
  readonly placement?: ViewportLayerPlacement;
  readonly initializationDelayMs?: number;
};

/** Render the WebGL backend as an inert viewport-aligned canvas layer. */
export function FigWebGLViewportCanvas({ sceneGraph, viewportScale, placement = "world", initializationDelayMs }: FigWebGLViewportCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLFigmaRendererInstance | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const initializeFrameRef = useRef<number | null>(null);
  const initializeTimerRef = useRef<number | null>(null);
  const prepareRunningRef = useRef(false);
  const pendingPrepareRef = useRef<{ readonly scene: SceneGraph; readonly pixelRatio: number } | null>(null);
  const latestRenderRef = useRef<{ readonly scene: SceneGraph; readonly pixelRatio: number } | null>(null);
  const preparedResourceKeyRef = useRef<WebGLSceneResourceKey | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [devicePixelRatio, setDevicePixelRatio] = useState(() => typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const frame = resolveViewportLayerFrame({ sceneGraph, placement });
  const effectivePixelRatio = resolveWebGLViewportPixelRatio({
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
    const canvas = canvasRef.current;
    if (!canvas) { return; }
    if (initializationDelayMs !== undefined && (!Number.isFinite(initializationDelayMs) || initializationDelayMs < 0)) {
      throw new Error("FigWebGLViewportCanvas requires a non-negative initializationDelayMs when provided");
    }

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

    const createRenderer = (): WebGLFigmaRendererInstance => {
      const renderer = createWebGLFigmaRenderer({
        canvas,
        antialias: true,
        pixelRatio: effectivePixelRatio,
        backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
      });
      renderer.precompileResources();
      rendererRef.current = renderer;
      return renderer;
    };

    latestRenderRef.current = { scene: sceneGraph, pixelRatio: effectivePixelRatio };

    const renderScene = (renderer: WebGLFigmaRendererInstance, scene: SceneGraph, pixelRatio: number) => {
      renderFrameRef.current = null;
      renderer.setPixelRatio(pixelRatio);
      renderer.render(scene);
      const metrics = renderer.getMetrics();
      canvas.dataset.webglLastRenderMs = metrics.lastRenderMs.toFixed(3);
      canvas.dataset.webglRenderCount = `${metrics.renderCount}`;
    };

    const requestRender = (renderer: WebGLFigmaRendererInstance, scene: SceneGraph, pixelRatio: number) => {
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
      }
      renderFrameRef.current = window.requestAnimationFrame(() => {
        renderScene(renderer, scene, pixelRatio);
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
      const resourceKey = getWebGLSceneResourceKey(next.scene);
      void renderer.prepareScene(next.scene).then(
        () => {
          prepareRunningRef.current = false;
          preparedResourceKeyRef.current = resourceKey;
          const prepareMetrics = renderer.getMetrics();
          canvas.dataset.webglLastPrepareMs = prepareMetrics.lastPrepareMs.toFixed(3);
          canvas.dataset.webglPrepareCount = `${prepareMetrics.prepareCount}`;
          const latest = latestRenderRef.current;
          if (latest?.scene === next.scene && latest.pixelRatio === next.pixelRatio) {
            renderer.setPixelRatio(next.pixelRatio);
            renderer.render(next.scene);
            const renderMetrics = renderer.getMetrics();
            canvas.dataset.webglLastRenderMs = renderMetrics.lastRenderMs.toFixed(3);
            canvas.dataset.webglRenderCount = `${renderMetrics.renderCount}`;
            setIsReady(true);
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
        setIsReady(false);
        pendingPrepareRef.current = { scene: sceneGraph, pixelRatio: effectivePixelRatio };
        runPrepareQueue(renderer);
        return;
      }
      requestRender(renderer, sceneGraph, effectivePixelRatio);
      setIsReady(true);
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
  }, [sceneGraph, effectivePixelRatio, initializationDelayMs]);

  useEffect(() => {
    return () => {
      if (renderFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      pendingPrepareRef.current = null;
      latestRenderRef.current = null;
      preparedResourceKeyRef.current = null;
      setIsReady(false);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  if (sceneGraph.width <= 0 || sceneGraph.height <= 0) {
    return null;
  }

  if (!sceneGraph.viewport) {
    throw new Error("FigWebGLViewportCanvas requires sceneGraph.viewport");
  }

  return (
    <>
    <canvas
      ref={canvasRef}
      width={Math.ceil(sceneGraph.width * effectivePixelRatio)}
      height={Math.ceil(sceneGraph.height * effectivePixelRatio)}
      data-webgl-ready={isReady ? "true" : "false"}
      style={{
        position: "absolute",
        left: frame.left,
        top: frame.top,
        display: "block",
        width: frame.width,
        height: frame.height,
      }}
    />
      {!isReady && (
        <div
          role="status"
          aria-label="Preparing WebGL canvas"
          data-webgl-loading="true"
          style={{
            position: "absolute",
            left: frame.left,
            top: frame.top,
            width: frame.width,
            height: frame.height,
            display: "grid",
            placeItems: "center",
            background: "rgba(247, 249, 252, 0.92)",
            color: "#1f2937",
            fontSize: 13,
            fontFamily: "inherit",
            pointerEvents: "none",
          }}
        >
          Preparing WebGL canvas
        </div>
      )}
    </>
  );
}
