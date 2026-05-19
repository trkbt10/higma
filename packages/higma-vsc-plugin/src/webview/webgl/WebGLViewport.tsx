/**
 * @file Compose the WebGL canvas and its loading overlay for the
 * viewer's stage.
 *
 * The component owns no state — `useWebGLViewport` does. The canvas
 * is sized in *visible-stage* CSS pixels (`sceneGraph.width` ×
 * `sceneGraph.height`); the underlying GL framebuffer multiplies that
 * by `pixelRatio` for crisp pixels at any zoom or DPI. Pan / zoom is
 * applied inside the renderer by mapping the scene's world-space
 * `viewport` rectangle onto the surface — the canvas DOM never grows
 * with zoom, so a 50k×50k design at 8× still uses the same backing
 * buffer footprint. The loading overlay covers the canvas until the
 * GL renderer reports `ready`.
 */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph/model";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { useWebGLViewport } from "./use-webgl-viewport";
import { WebGLLoadingOverlay } from "./WebGLLoadingOverlay";

type Props = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
  /** Active zoom (the viewport transform's `scale`). The renderer paints
   *  the world-space `sceneGraph.viewport` rect onto the surface itself,
   *  so this value is *not* used as a CSS transform. It only feeds the
   *  pixel-ratio policy so the GL backing store sharpens up at large
   *  zooms — e.g. zooming to 4× allocates a denser framebuffer so 1px
   *  on screen still maps to ~1px of fidelity in the GL output. */
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
  // at logical CSS px equal to the visible stage, then maps the world
  // viewport into that surface internally — no parent CSS transform.
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
