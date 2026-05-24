/**
 * @file Single source of truth for the WebGL viewport renderer lifecycle hook.
 *
 * The lifecycle is:
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
 * Pan/zoom rebuilds `sceneGraph` (a fresh viewport gets stamped onto
 * the cached content scene each tick), so this hook re-fires constantly
 * during interaction. Once the renderer exists *and* it has already
 * prepared the resources for this scene's content, only the
 * world-window rectangle has changed — we render directly and keep
 * `phase: "ready"` so the loading overlay does not flash.
 *
 * Two surface-level wrappers consume this hook (the fig editor and the
 * vsc-plugin webview); their differences are surfaced via:
 *   - `sceneGraph` is nullable here (vsc-plugin's sceneGraph is built
 *     async; the editor always has one),
 *   - `onMetrics` lets the editor surface renderer metrics on the
 *     canvas dataset for its WebGL Playwright tests; the vsc-plugin
 *     does not ship those tests and passes `undefined`,
 *   - `errorContext` parameterises the throw message that points at
 *     the offending caller's hook name.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import {
  createWebGLFigmaRenderer,
  resolveWebGLViewportPixelRatio,
  type WebGLFigmaRendererInstance,
  type WebGLFigmaRendererMetrics,
} from "../index";
import {
  getWebGLViewportPreparationStatus,
  type WebGLViewportPreparationStatus,
} from "../scene/preparation-status";

export type WebGLViewportPipelineParams = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: {
    readonly exportSettings?: Parameters<typeof createWebGLFigmaRenderer>[0]["exportSettings"];
  };
  /** CSS-pixel scale (1 == 100%). Combines with devicePixelRatio. */
  readonly viewportScale: number;
  /** Monotonic viewport transform revision supplied by the embedding surface. */
  readonly viewportRevision?: number;
  /**
   * Defer renderer creation by this many ms after mount. Lets React
   * commit the loading overlay before the synchronous program-compile
   * pass starts. Keep small (~16ms / one frame) for snappy feel.
   */
  readonly initializationDelayMs?: number;
  /**
   * Called whenever the renderer reports new metrics. The editor uses
   * this to write `data-webgl-*` attributes onto the canvas that its
   * Playwright tests inspect; other surfaces can omit it.
   */
  readonly onMetrics?: (canvas: HTMLCanvasElement, metrics: WebGLFigmaRendererMetrics) => void;
  /**
   * Hook name for the non-finite `initializationDelayMs` error message.
   * Keeps the failure surface attributable to the calling hook.
   */
  readonly errorContext: string;
};

export type WebGLViewportPipelineState = {
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

/** Manage WebGL renderer creation, resource preparation, rendering, and metrics. */
export function useWebGLViewportPipeline({
  sceneGraph,
  renderOptions,
  viewportScale,
  viewportRevision,
  initializationDelayMs,
  onMetrics,
  errorContext,
}: WebGLViewportPipelineParams): WebGLViewportPipelineState {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLFigmaRendererInstance | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const initializeFrameRef = useRef<number | null>(null);
  const initializeTimerRef = useRef<number | null>(null);
  const prepareRunningRef = useRef(false);
  const pendingPrepareRef = useRef<PendingPrepare | null>(null);
  const latestRenderRef = useRef<LatestRender | null>(null);
  const hasPresentedFrameRef = useRef(false);
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
      throw new Error(`${errorContext} requires a non-negative initializationDelayMs when provided`);
    }

    const setPhase = (phase: WebGLViewportPreparationStatus["phase"]) => {
      if (!disposedRef.current) {
        setStatus(getWebGLViewportPreparationStatus(phase));
      }
    };
    const setPhaseUntilFirstPresentedFrame = (phase: WebGLViewportPreparationStatus["phase"]) => {
      if (hasPresentedFrameRef.current) {
        return;
      }
      setPhase(phase);
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
      if (!onMetrics) {
        return;
      }
      onMetrics(canvas, renderer.getMetrics());
    };

    const createRenderer = (): WebGLFigmaRendererInstance => {
      setPhaseUntilFirstPresentedFrame("precompiling");
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
      exposeCachedGeometryFrame: boolean,
    ) => {
      renderFrameRef.current = null;
      setPhaseUntilFirstPresentedFrame("rendering");
      renderer.setPixelRatio(nextPixelRatio);
      renderer.render(scene);
      writeMetrics(renderer);
      if (exposeCachedGeometryFrame) {
        renderer.render(scene);
        writeMetrics(renderer);
      }
      hasPresentedFrameRef.current = true;
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
        renderScene(renderer, scene, nextPixelRatio, false);
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
      setPhaseUntilFirstPresentedFrame("preparing-resources");
      void renderer.prepareScene(next.scene).then(
        () => {
          prepareRunningRef.current = false;
          writeMetrics(renderer);
          const latest = latestRenderRef.current;
          if (latest?.scene === next.scene && latest.pixelRatio === next.pixelRatio) {
            renderer.setPixelRatio(next.pixelRatio);
            renderScene(renderer, next.scene, next.pixelRatio, true);
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
        setPhaseUntilFirstPresentedFrame("scheduled");
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
      setPhaseUntilFirstPresentedFrame("scheduled");
      const requestInitialize = () => {
        initializeFrameRef.current = window.requestAnimationFrame(initializeAndRender);
      };
      if (initializationDelayMs === undefined || initializationDelayMs === 0) {
        requestInitialize();
        return;
      }
      if (hasPresentedFrameRef.current) {
        requestInitialize();
        return;
      }
      initializeTimerRef.current = window.setTimeout(requestInitialize, initializationDelayMs);
    };

    const existing = rendererRef.current;
    if (existing && typeof window !== "undefined" && existing.isScenePrepared(sceneGraph)) {
      requestRender(existing, sceneGraph, pixelRatio);
    } else {
      scheduleInitialization();
    }

    return () => {
      cancelInitializationSchedule();
      if (renderFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
    };
  }, [sceneGraph, renderOptions, pixelRatio, viewportRevision, initializationDelayMs, onMetrics, errorContext]);

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (renderFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      pendingPrepareRef.current = null;
      latestRenderRef.current = null;
      hasPresentedFrameRef.current = false;
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
