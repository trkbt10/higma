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

type RenderableWindow = Window & {
  renderSceneGraph: (json: string, pixelRatio?: number, backgroundColor?: RGBA) => Promise<string>;
};

const DEFAULT_BACKGROUND: RGBA = { r: 1, g: 1, b: 1, a: 1 };

(window as unknown as RenderableWindow).renderSceneGraph = async (
  json: string,
  pixelRatio: number = 1,
  backgroundColor: RGBA = DEFAULT_BACKGROUND,
): Promise<string> => {
  const sceneGraph = JSON.parse(json) as SceneGraph;
  restoreUint8Arrays(sceneGraph as unknown as Record<string, unknown>);

  // CSS size always matches the authored width/height so downstream
  // image-compare diffs (which expect 1:1 with the source canvas)
  // stay consistent regardless of pixel ratio. The physical canvas
  // buffer is scaled by pixelRatio — the renderer paints into the
  // larger buffer and the resulting PNG carries `width * pixelRatio`
  // physical pixels, giving callers a real super-sampled bitmap
  // instead of a stretched 1x image.
  canvas.width = Math.round(sceneGraph.width * pixelRatio);
  canvas.height = Math.round(sceneGraph.height * pixelRatio);
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
    pixelRatio,
    antialias: true,
    backgroundColor,
  });
  try {
    await renderer.prepareScene(sceneGraph);
    renderer.render(sceneGraph);
  } finally {
    renderer.dispose();
  }
  return canvas.toDataURL("image/png");
};

document.title = "ready";
