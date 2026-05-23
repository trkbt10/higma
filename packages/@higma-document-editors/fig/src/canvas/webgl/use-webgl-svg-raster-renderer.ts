/** @file Fig editor WebGL tab renderer backed by the SVG RenderTree SoT. */

import { useEffect, useRef, useState, type RefObject } from "react";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { renderSceneGraphToSvg } from "@higma-document-renderers/fig/svg";
import {
  getWebGLViewportPreparationStatus,
  resolveWebGLViewportPixelRatio,
  type WebGLViewportPreparationStatus,
} from "@higma-document-renderers/fig/webgl";
import type {
  WebGLFigmaRendererMetrics,
} from "@higma-document-renderers/fig/webgl";

export type UseWebGLSvgRasterRendererOptions = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly viewportScale: number;
  readonly viewportRevision?: number;
  readonly initializationDelayMs?: number;
  readonly onMetrics?: (canvas: HTMLCanvasElement, metrics: WebGLFigmaRendererMetrics) => void;
};

export type WebGLSvgRasterRendererState = {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly pixelRatio: number;
  readonly isReady: boolean;
  readonly status: WebGLViewportPreparationStatus;
};

type RasterMetrics = {
  prepareCount: number;
  renderCount: number;
  lastPrepareMs: number;
  lastRenderMs: number;
};

type RasterFrame = {
  readonly image: HTMLImageElement;
  readonly sceneGraph: SceneGraph;
  readonly pixelRatio: number;
  readonly renderOptions: SceneGraphRenderOptions | undefined;
};

type SceneViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type CancellationToken = {
  value: boolean;
};

type ScheduledWork = {
  value: number | null;
};

const AUTHORITATIVE_RASTER_REFRESH_DELAY_MS = 180;

function currentDevicePixelRatio(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  return window.devicePixelRatio || 1;
}

function requireInitializationDelayMs(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("useWebGLSvgRasterRenderer requires a non-negative initializationDelayMs when provided");
  }
  return value;
}

function loadSvgImage(svgText: string): Promise<HTMLImageElement> {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("WebGL SVG raster renderer failed to load SVG image"));
    };
    image.src = url;
  });
}

function syncCanvasSize({
  canvas,
  sceneGraph,
  pixelRatio,
}: {
  readonly canvas: HTMLCanvasElement;
  readonly sceneGraph: SceneGraph;
  readonly pixelRatio: number;
}): void {
  const backingWidth = Math.ceil(sceneGraph.width * pixelRatio);
  const backingHeight = Math.ceil(sceneGraph.height * pixelRatio);
  if (canvas.width !== backingWidth) {
    canvas.width = backingWidth;
  }
  if (canvas.height !== backingHeight) {
    canvas.height = backingHeight;
  }
  const cssWidth = `${sceneGraph.width}px`;
  const cssHeight = `${sceneGraph.height}px`;
  if (canvas.style.width !== cssWidth) {
    canvas.style.width = cssWidth;
  }
  if (canvas.style.height !== cssHeight) {
    canvas.style.height = cssHeight;
  }
}

function drawSvgImageToCanvas({
  canvas,
  image,
}: {
  readonly canvas: HTMLCanvasElement;
  readonly image: HTMLImageElement;
}): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("WebGL SVG raster renderer requires a 2D canvas context");
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function colorToCssRgba(color: NonNullable<SceneGraph["backgroundColor"]>): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
}

function fillCanvasBackground(canvas: HTMLCanvasElement, sceneGraph: SceneGraph): void {
  const color = sceneGraph.backgroundColor;
  if (color === undefined) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("WebGL SVG raster renderer requires a 2D canvas context");
  }
  ctx.fillStyle = colorToCssRgba(color);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function sceneViewport(sceneGraph: SceneGraph): SceneViewport {
  if (sceneGraph.viewport !== undefined) {
    return sceneGraph.viewport;
  }
  return {
    x: 0,
    y: 0,
    width: sceneGraph.width,
    height: sceneGraph.height,
  };
}

function sameViewportScale(previous: SceneViewport, next: SceneViewport): boolean {
  return previous.width === next.width && previous.height === next.height;
}

function canReprojectRasterFrame({
  frame,
  sceneGraph,
  pixelRatio,
  renderOptions,
}: {
  readonly frame: RasterFrame;
  readonly sceneGraph: SceneGraph;
  readonly pixelRatio: number;
  readonly renderOptions: SceneGraphRenderOptions | undefined;
}): boolean {
  if (frame.sceneGraph.root !== sceneGraph.root) {
    return false;
  }
  if (frame.sceneGraph.width !== sceneGraph.width || frame.sceneGraph.height !== sceneGraph.height) {
    return false;
  }
  if (frame.pixelRatio !== pixelRatio) {
    return false;
  }
  if (frame.renderOptions !== renderOptions) {
    return false;
  }
  return sameViewportScale(sceneViewport(frame.sceneGraph), sceneViewport(sceneGraph));
}

function reprojectedRasterOffset({
  frame,
  sceneGraph,
}: {
  readonly frame: RasterFrame;
  readonly sceneGraph: SceneGraph;
}): { readonly x: number; readonly y: number } {
  const previous = sceneViewport(frame.sceneGraph);
  const next = sceneViewport(sceneGraph);
  const cssPxPerWorldX = sceneGraph.width / next.width;
  const cssPxPerWorldY = sceneGraph.height / next.height;
  return {
    x: (previous.x - next.x) * cssPxPerWorldX * frame.pixelRatio,
    y: (previous.y - next.y) * cssPxPerWorldY * frame.pixelRatio,
  };
}

function drawReprojectedRasterFrame({
  canvas,
  frame,
  sceneGraph,
}: {
  readonly canvas: HTMLCanvasElement;
  readonly frame: RasterFrame;
  readonly sceneGraph: SceneGraph;
}): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("WebGL SVG raster renderer requires a 2D canvas context");
  }
  const offset = reprojectedRasterOffset({ frame, sceneGraph });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  fillCanvasBackground(canvas, sceneGraph);
  ctx.drawImage(frame.image, offset.x, offset.y, canvas.width, canvas.height);
}

function writeCanvasMetrics(
  canvas: HTMLCanvasElement,
  metrics: RasterMetrics,
  onMetrics: UseWebGLSvgRasterRendererOptions["onMetrics"],
): void {
  canvas.setAttribute("data-webgl-prepare-count", String(metrics.prepareCount));
  canvas.setAttribute("data-webgl-render-count", String(metrics.renderCount));
  canvas.setAttribute("data-webgl-last-prepare-ms", String(metrics.lastPrepareMs));
  canvas.setAttribute("data-webgl-last-render-ms", String(metrics.lastRenderMs));
  onMetrics?.(canvas, metrics);
}

function cancelScheduledWork(work: ScheduledWork): void {
  if (work.value === null || typeof window === "undefined") {
    return;
  }
  window.cancelAnimationFrame(work.value);
  work.value = null;
}

function cancelScheduledTimer(work: ScheduledWork): void {
  if (work.value === null || typeof window === "undefined") {
    return;
  }
  window.clearTimeout(work.value);
  work.value = null;
}

/** Render the editor WebGL tab from the same SVG RenderTree output as the SVG tab. */
export function useWebGLSvgRasterRenderer({
  sceneGraph,
  renderOptions,
  viewportScale,
  viewportRevision,
  initializationDelayMs,
  onMetrics,
}: UseWebGLSvgRasterRendererOptions): WebGLSvgRasterRendererState {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metricsRef = useRef<RasterMetrics>({
    prepareCount: 0,
    renderCount: 0,
    lastPrepareMs: 0,
    lastRenderMs: 0,
  });
  const frameRef = useRef<RasterFrame | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState(() => getWebGLViewportPreparationStatus("scheduled"));
  const [devicePixelRatio, setDevicePixelRatio] = useState(currentDevicePixelRatio);
  const pixelRatio = resolveWebGLViewportPixelRatio({
    devicePixelRatio,
    viewportScale,
    surfaceWidth: sceneGraph?.width ?? 1,
    surfaceHeight: sceneGraph?.height ?? 1,
  });

  if (error !== null) {
    throw error;
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const updatePixelRatio = () => {
      setDevicePixelRatio(currentDevicePixelRatio());
    };
    window.addEventListener("resize", updatePixelRatio);
    const media = window.matchMedia(`(resolution: ${currentDevicePixelRatio()}dppx)`);
    media.addEventListener("change", updatePixelRatio);
    return () => {
      window.removeEventListener("resize", updatePixelRatio);
      media.removeEventListener("change", updatePixelRatio);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || sceneGraph === null) {
      setStatus(getWebGLViewportPreparationStatus("scheduled"));
      return;
    }

    const delayMs = requireInitializationDelayMs(initializationDelayMs);
    const cancelled: CancellationToken = { value: false };
    const animationFrame: ScheduledWork = { value: null };
    const timer: ScheduledWork = { value: null };
    const setPhase = (phase: WebGLViewportPreparationStatus["phase"]): void => {
      if (!cancelled.value) {
        setStatus(getWebGLViewportPreparationStatus(phase));
      }
    };
    const run = async ({ reportStatus }: { readonly reportStatus: boolean }): Promise<void> => {
      if (reportStatus) {
        setPhase("preparing-resources");
      }
      syncCanvasSize({ canvas, sceneGraph, pixelRatio });
      const prepareStart = performance.now();
      const svgText = renderSceneGraphToSvg(sceneGraph, renderOptions) as string;
      if (cancelled.value) {
        return;
      }
      const image = await loadSvgImage(svgText);
      if (cancelled.value) {
        return;
      }
      frameRef.current = { image, sceneGraph, pixelRatio, renderOptions };
      metricsRef.current.prepareCount += 1;
      metricsRef.current.lastPrepareMs = performance.now() - prepareStart;
      writeCanvasMetrics(canvas, metricsRef.current, onMetrics);

      if (reportStatus) {
        setPhase("rendering");
      }
      const renderStart = performance.now();
      drawSvgImageToCanvas({ canvas, image });
      if (cancelled.value) {
        return;
      }
      metricsRef.current.renderCount += 1;
      metricsRef.current.lastRenderMs = performance.now() - renderStart;
      writeCanvasMetrics(canvas, metricsRef.current, onMetrics);
      if (reportStatus) {
        setPhase("ready");
      }
    };
    const scheduleRun = (reportStatus: boolean): void => {
      if (typeof window === "undefined") {
        void run({ reportStatus });
        return;
      }
      animationFrame.value = window.requestAnimationFrame(() => {
        animationFrame.value = null;
        void run({ reportStatus }).catch((reason: unknown) => {
          if (!cancelled.value) {
            setError(reason);
          }
        });
      });
    };
    const currentFrame = frameRef.current;
    if (
      currentFrame !== null &&
      canReprojectRasterFrame({ frame: currentFrame, sceneGraph, pixelRatio, renderOptions })
    ) {
      syncCanvasSize({ canvas, sceneGraph, pixelRatio });
      setPhase("rendering");
      const renderStart = performance.now();
      drawReprojectedRasterFrame({ canvas, frame: currentFrame, sceneGraph });
      metricsRef.current.renderCount += 1;
      metricsRef.current.lastRenderMs = performance.now() - renderStart;
      writeCanvasMetrics(canvas, metricsRef.current, onMetrics);
      setPhase("ready");
      timer.value = window.setTimeout(() => {
        timer.value = null;
        scheduleRun(false);
      }, AUTHORITATIVE_RASTER_REFRESH_DELAY_MS);
      return () => {
        cancelled.value = true;
        cancelScheduledWork(animationFrame);
        cancelScheduledTimer(timer);
      };
    }

    setPhase("scheduled");
    if (delayMs === undefined || delayMs === 0) {
      scheduleRun(true);
    } else {
      timer.value = window.setTimeout(() => scheduleRun(true), delayMs);
    }

    return () => {
      cancelled.value = true;
      cancelScheduledWork(animationFrame);
      cancelScheduledTimer(timer);
    };
  }, [sceneGraph, renderOptions, pixelRatio, viewportRevision, initializationDelayMs, onMetrics]);

  return {
    canvasRef,
    pixelRatio,
    isReady: status.phase === "ready",
    status,
  };
}
