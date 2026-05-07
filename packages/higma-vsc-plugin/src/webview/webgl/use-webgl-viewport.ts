/**
 * @file React hook that drives a `createWebGLFigmaRenderer` for the
 * vsc-plugin's preview canvas.
 *
 * The lifecycle mirrors the editor's `useWebGLViewportRenderer`:
 *   - schedule on mount (so the React tree commits and the loading
 *     overlay paints before the GPU starts uploading textures),
 *   - precompile shader programs,
 *   - prepare resources (textures, geometry buffers),
 *   - render a frame,
 *   - mark ready.
 *
 * A new scene graph or pixel-ratio change re-enters the prepare/render
 * queue; resource caches inside the renderer survive across calls so
 * subsequent renders are cheap.
 *
 * Hit testing happens against the document model (see
 * `geometry/node-bounds`) — this hook does not own any selection
 * state, only paint state.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { FigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import {
  createWebGLFigmaRenderer,
  resolveWebGLViewportPixelRatio,
  type WebGLFigmaRendererInstance,
} from "@higma-document-renderers/fig/webgl";
import {
  getWebGLViewportPreparationStatus,
  type WebGLViewportPreparationStatus,
} from "./webgl-status";

type UseWebGLViewportParams = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: FigFamilyRenderOptions;
  /** CSS-pixel scale (1 == 100%). Combines with devicePixelRatio. */
  readonly viewportScale: number;
  /**
   * Defer renderer creation by this many ms after mount. Lets React
   * commit the loading overlay before the synchronous program-compile
   * pass starts. Keep small (~16ms / one frame) for snappy feel.
   */
  readonly initializationDelayMs?: number;
};

export type WebGLViewportState = {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly pixelRatio: number;
  readonly isReady: boolean;
  readonly status: WebGLViewportPreparationStatus;
};

type PendingPrepare = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
};

type LatestRender = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
};

export function useWebGLViewport({
  sceneGraph,
  renderOptions,
  viewportScale,
  initializationDelayMs,
}: UseWebGLViewportParams): WebGLViewportState {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLFigmaRendererInstance | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const initializeFrameRef = useRef<number | null>(null);
  const initializeTimerRef = useRef<number | null>(null);
  const prepareRunningRef = useRef(false);
  const pendingPrepareRef = useRef<PendingPrepare | null>(null);
  const latestRenderRef = useRef<LatestRender | null>(null);
  const disposedRef = useRef(false);
  const [status, setStatus] = useState(() => getWebGLViewportPreparationStatus("scheduled"));
  const [devicePixelRatio, setDevicePixelRatio] = useState(() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  const surfaceWidth = sceneGraph?.width ?? 1;
  const surfaceHeight = sceneGraph?.height ?? 1;
  const pixelRatio = resolveWebGLViewportPixelRatio({
    devicePixelRatio,
    viewportScale,
    surfaceWidth,
    surfaceHeight,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
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
    if (!canvas || !sceneGraph) {
      return;
    }
    if (
      initializationDelayMs !== undefined &&
      (!Number.isFinite(initializationDelayMs) || initializationDelayMs < 0)
    ) {
      throw new Error("useWebGLViewport requires a non-negative initializationDelayMs when provided");
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

    const createRenderer = (): WebGLFigmaRendererInstance => {
      setPhase("precompiling");
      const renderer = createWebGLFigmaRenderer({
        canvas,
        antialias: true,
        pixelRatio,
        backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
        exportSettings: renderOptions?.exportSettings,
      });
      renderer.precompileResources();
      rendererRef.current = renderer;
      return renderer;
    };

    latestRenderRef.current = { scene: sceneGraph, pixelRatio };

    const renderScene = (
      renderer: WebGLFigmaRendererInstance,
      scene: SceneGraph,
      nextPixelRatio: number,
    ) => {
      renderFrameRef.current = null;
      setPhase("rendering");
      renderer.setPixelRatio(nextPixelRatio);
      renderer.render(scene);
      setPhase("ready");
    };

    const requestRender = (
      renderer: WebGLFigmaRendererInstance,
      scene: SceneGraph,
      nextPixelRatio: number,
    ) => {
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
      void renderer.prepareScene(next.scene).then(
        () => {
          prepareRunningRef.current = false;
          const latest = latestRenderRef.current;
          if (latest?.scene === next.scene && latest.pixelRatio === next.pixelRatio) {
            renderer.setPixelRatio(next.pixelRatio);
            setPhase("rendering");
            renderer.render(next.scene);
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
      if (!renderer.isScenePrepared(sceneGraph)) {
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
  }, [sceneGraph, renderOptions, pixelRatio, initializationDelayMs]);

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (renderFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      pendingPrepareRef.current = null;
      latestRenderRef.current = null;
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
