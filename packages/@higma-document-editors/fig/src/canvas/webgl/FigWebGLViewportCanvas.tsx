/** @file Presentational WebGL viewport canvas element. */

import type { RefObject } from "react";
import type { ViewportLayerFrame } from "../rendering/viewport-render-plan";

type FigWebGLViewportCanvasProps = {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly frame: ViewportLayerFrame;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly isReady: boolean;
};

/** Render only the WebGL canvas DOM element for a viewport layer. */
export function FigWebGLViewportCanvas({
  canvasRef,
  frame,
  width,
  height,
  pixelRatio,
  isReady,
}: FigWebGLViewportCanvasProps) {
  return (
    <canvas
      ref={canvasRef}
      width={Math.ceil(width * pixelRatio)}
      height={Math.ceil(height * pixelRatio)}
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
  );
}
