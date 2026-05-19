/** @file WebGL viewport canvas entry for editor surfaces. */
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { FigWebGLViewportLayer } from "./FigWebGLViewportLayer";

export type FigWebGLViewportCanvasProps = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly viewportScale: number;
  readonly viewportRevision?: number;
  readonly initializationDelayMs?: number;
};

/** Render a WebGL viewport canvas. */
export function FigWebGLViewportCanvas(props: FigWebGLViewportCanvasProps) {
  return <FigWebGLViewportLayer {...props} />;
}
