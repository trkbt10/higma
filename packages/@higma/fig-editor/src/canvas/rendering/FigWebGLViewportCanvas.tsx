/** @file WebGL viewport canvas for the fig editor. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SceneGraph } from "@higma/fig-renderer/scene-graph";
import {
  createWebGLFigmaRenderer,
  resolveWebGLViewportPixelRatio,
  type WebGLFigmaRendererInstance,
} from "@higma/fig-renderer/webgl";
import { resolveViewportLayerFrame, type ViewportLayerPlacement } from "./viewport-render-plan";
import { getWebGLSceneResourceKey, isWebGLSceneResourceKeyEqual, type WebGLSceneResourceKey } from "./webgl-scene-resource-key";

type FigWebGLViewportCanvasProps = {
  readonly sceneGraph: SceneGraph;
  readonly viewportScale: number;
  readonly placement?: ViewportLayerPlacement;
};

/** Render the WebGL backend as an inert viewport-aligned canvas layer. */
export function FigWebGLViewportCanvas({ sceneGraph, viewportScale, placement = "world" }: FigWebGLViewportCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLFigmaRendererInstance | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const prepareRunningRef = useRef(false);
  const pendingPrepareRef = useRef<{ readonly scene: SceneGraph; readonly pixelRatio: number } | null>(null);
  const latestRenderRef = useRef<{ readonly scene: SceneGraph; readonly pixelRatio: number } | null>(null);
  const preparedResourceKeyRef = useRef<WebGLSceneResourceKey | null>(null);
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

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) { return; }

    if (!rendererRef.current) {
      rendererRef.current = createWebGLFigmaRenderer({
        canvas,
        antialias: true,
        pixelRatio: effectivePixelRatio,
        backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
      });
    }

    const renderer = rendererRef.current;
    latestRenderRef.current = { scene: sceneGraph, pixelRatio: effectivePixelRatio };
    const renderLatestScene = () => {
      renderFrameRef.current = null;
      renderer.setPixelRatio(effectivePixelRatio);
      renderer.render(sceneGraph);
    };

    if (typeof window === "undefined") {
      renderLatestScene();
    } else {
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
      }
      renderFrameRef.current = window.requestAnimationFrame(renderLatestScene);
    }

    const runPrepareQueue = () => {
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
      void renderer.prepareScene(next.scene).then(() => {
        prepareRunningRef.current = false;
        preparedResourceKeyRef.current = resourceKey;
        const latest = latestRenderRef.current;
        if (latest?.scene === next.scene && latest.pixelRatio === next.pixelRatio) {
          renderer.setPixelRatio(next.pixelRatio);
          renderer.render(next.scene);
        }
        runPrepareQueue();
      });
    };

    const resourceKey = getWebGLSceneResourceKey(sceneGraph);
    if (!isWebGLSceneResourceKeyEqual(preparedResourceKeyRef.current, resourceKey)) {
      pendingPrepareRef.current = { scene: sceneGraph, pixelRatio: effectivePixelRatio };
      runPrepareQueue();
    }

    return () => {
      if (renderFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
    };
  }, [sceneGraph, effectivePixelRatio]);

  useEffect(() => {
    return () => {
      if (renderFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      pendingPrepareRef.current = null;
      latestRenderRef.current = null;
      preparedResourceKeyRef.current = null;
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
    <canvas
      ref={canvasRef}
      width={Math.ceil(sceneGraph.width * effectivePixelRatio)}
      height={Math.ceil(sceneGraph.height * effectivePixelRatio)}
      style={{
        position: "absolute",
        left: frame.left,
        top: frame.top,
        display: "block",
        width: frame.width,
        height: frame.height,
      }}
    />
  );
}
