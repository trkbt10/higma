/**
 * @file WebGL verify harness entry point.
 *
 * Loaded by Puppeteer when the verifier starts the Vite dev server.
 * Receives a SceneGraph (as JSON), restores its embedded
 * `Uint8Array`s, runs it through `WebGLFigmaRenderer`, and returns a
 * PNG data URL of the canvas.
 *
 * Mirrors `@higma-document-renderers/fig`'s harness so the verifier
 * uses the same renderer the parity tests already trust.
 */
import { createWebGLFigmaRenderer } from "@higma-document-renderers/fig/webgl";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

// preserveDrawingBuffer must be true *before* the renderer creates
// the WebGL context; otherwise `toDataURL` returns a blank canvas
// after the first FBO swap.
const preCtx = canvas.getContext("webgl", {
  antialias: true,
  alpha: true,
  premultipliedAlpha: false,
  stencil: true,
  preserveDrawingBuffer: true,
});
if (preCtx === null) {
  console.error("[harness] failed to acquire WebGL context");
}

/**
 * The verifier base64-encodes every `Uint8Array` field before calling
 * `JSON.stringify`. Walk the parsed scene graph in-place and flip each
 * `{ __base64: "..." }` back to a `Uint8Array`.
 */
function restoreUint8Arrays(node: Record<string, unknown>): void {
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (val !== null && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.__base64 === "string") {
        const binary = atob(obj.__base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        node[key] = bytes;
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (item !== null && typeof item === "object") {
            restoreUint8Arrays(item as Record<string, unknown>);
          }
        }
      } else {
        restoreUint8Arrays(obj);
      }
    }
  }
}

type RGBA = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- ambient Window augmentation
  interface Window {
    renderSceneGraph?: (json: string, pixelRatio?: number, backgroundColor?: RGBA) => Promise<string>;
  }
}

const DEFAULT_BACKGROUND: RGBA = { r: 1, g: 1, b: 1, a: 1 };

/**
 * Internal supersampling factor for the verify harness.
 *
 * The WebGL renderer paints into a 1-bit stencil and resolves with a
 * cover-quad pass. Without MSAA the default framebuffer hands back hard
 * binary edges, and headless Chromium often discards `antialias: true`
 * silently. To produce anti-aliased PNGs deterministically we render
 * into a canvas `SUPERSAMPLING_FACTOR` times the requested size, then
 * downscale through the 2D Canvas API's high-quality image-smoothing
 * filter. The 2D draw integrates 4 subpixels per output pixel (at 2×)
 * and gives back smooth edges regardless of what the headless GL
 * implementation actually delivered for MSAA.
 */
const SUPERSAMPLING_FACTOR = 2;

window.renderSceneGraph = async (
  json: string,
  pixelRatio: number = 1,
  backgroundColor: RGBA = DEFAULT_BACKGROUND,
): Promise<string> => {
  const sceneGraph = JSON.parse(json) as SceneGraph;
  restoreUint8Arrays(sceneGraph as Record<string, unknown>);

  const outputWidth = Math.round(sceneGraph.width * pixelRatio);
  const outputHeight = Math.round(sceneGraph.height * pixelRatio);
  const superWidth = outputWidth * SUPERSAMPLING_FACTOR;
  const superHeight = outputHeight * SUPERSAMPLING_FACTOR;

  // CSS size always matches the authored width/height so downstream
  // image-compare diffs (which expect 1:1 with the source canvas)
  // stay consistent regardless of pixel ratio. The physical canvas
  // buffer is scaled by pixelRatio × SUPERSAMPLING_FACTOR — the
  // renderer paints into the supersampled buffer and the 2D
  // downscale below resolves it to the logical output size.
  canvas.width = superWidth;
  canvas.height = superHeight;
  canvas.style.width = `${sceneGraph.width}px`;
  canvas.style.height = `${sceneGraph.height}px`;

  // Fresh renderer per frame so a failed effect on one frame doesn't
  // leave stale shader state behind for the next. The default
  // background colour is opaque white — that matches the legacy
  // verify-fidelity diff target. Callers that want transparent
  // backgrounds (e.g. fig-to-image emitting card sprites for
  // SwiftUI composition) pass `{r:0, g:0, b:0, a:0}` so the
  // exported PNG carries the authored alpha channel.
  const renderer = createWebGLFigmaRenderer({
    canvas,
    pixelRatio: pixelRatio * SUPERSAMPLING_FACTOR,
    antialias: true,
    backgroundColor,
  });
  try {
    await renderer.prepareScene(sceneGraph);
    renderer.render(sceneGraph);
  } finally {
    renderer.dispose();
  }

  // Downscale the supersampled WebGL canvas into a logical-size 2D
  // canvas. `imageSmoothingQuality = "high"` enables a Lanczos-class
  // filter in Chromium that integrates the SUPERSAMPLING_FACTOR²
  // input pixels per output pixel — that's where the anti-aliased
  // edges come from. The output canvas's PNG export at logical size
  // is what the caller compares against the captured screenshot.
  const downscale = document.createElement("canvas");
  downscale.width = outputWidth;
  downscale.height = outputHeight;
  const ctx = downscale.getContext("2d");
  if (ctx === null) {
    throw new Error("[harness] failed to acquire 2D context for downscale");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, outputWidth, outputHeight);
  return downscale.toDataURL("image/png");
};

document.title = "ready";
