/**
 * @file Compose the WebGL canvas and its loading overlay for the
 * viewer's stage.
 *
 * The component owns no state — `useWebGLViewport` does. The canvas
 * is sized in *page-bounds* coordinates × the active zoom; the
 * underlying GL framebuffer multiplies that by `pixelRatio` for crisp
 * pixels at any zoom or DPI. The loading overlay covers the canvas
 * until the GL renderer reports `ready`.
 */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { FigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import { useWebGLViewport } from "./use-webgl-viewport";
import { WebGLLoadingOverlay } from "./WebGLLoadingOverlay";

type Props = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: FigFamilyRenderOptions;
  /** Active zoom; the renderer paints at `sceneGraph.width × sceneGraph.height` CSS px,
   *  so the caller is expected to apply the zoom via a parent CSS transform. The
   *  scale is still threaded into the renderer's pixel-ratio policy so the
   *  backing store sharpens up at large zooms. */
  readonly viewportScale: number;
  /** ms to defer GL init after mount so the overlay can paint first. */
  readonly initializationDelayMs?: number;
};

export function WebGLViewport({
  sceneGraph,
  renderOptions,
  viewportScale,
  initializationDelayMs = 16,
}: Props) {
  const { canvasRef, isReady, status } = useWebGLViewport({
    sceneGraph,
    renderOptions,
    viewportScale,
    initializationDelayMs,
  });
  // No `width` / `height` attributes here: `syncWebGLCanvasRenderSurface`
  // (inside the GL renderer) imperatively sets both the drawing buffer
  // and the inline style `width`/`height` to the scene graph's logical
  // dimensions every render. Setting them in JSX would only let React
  // and the renderer fight on every commit. The renderer always paints
  // at logical CSS px; zoom is applied by the parent CSS transform.
  return (
    <>
      <canvas
        ref={canvasRef}
        className="higma-fig-webgl-canvas"
        data-webgl-ready={isReady ? "true" : "false"}
      />
      {!isReady && <WebGLLoadingOverlay status={status} />}
    </>
  );
}
