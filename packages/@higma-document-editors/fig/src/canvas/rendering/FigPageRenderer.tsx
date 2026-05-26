/** @file Renderer switch for the Fig editor canvas. */
import { useMemo } from "react";
import { FigSceneSvgRenderer } from "@higma-document-renderers/fig/react";
import {
  type KiwiSceneGraphMutation,
  type SceneGraphNodeTranslation,
  type SceneGraph,
} from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { FigWebGLViewportLayer } from "../webgl/FigWebGLViewportLayer";
import type { FigEditorRendererKind } from "./renderer-kind";
import type { FigEditorWebGLSurfaceIdentity } from "../webgl/fig-editor-webgl-surface-state";

export type FigPageRendererProps = {
  readonly kiwiDocumentMutation: KiwiSceneGraphMutation;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly viewportScale: number;
  readonly viewportRevision?: number;
  readonly viewportInteractionActive?: boolean;
  readonly sceneGraphNodeTranslation?: SceneGraphNodeTranslation;
  readonly sceneGraphInteractionRevision?: number;
  readonly sceneGraphInteractionActive?: boolean;
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly renderer?: FigEditorRendererKind;
  readonly host?: "html" | "svg";
  readonly webglInitializationDelayMs?: number;
  readonly webGLSurface?: FigEditorWebGLSurfaceIdentity;
};

function requireFigPageRendererWebGLSurface(
  surface: FigEditorWebGLSurfaceIdentity | undefined,
): FigEditorWebGLSurfaceIdentity {
  if (surface === undefined) {
    throw new Error("FigPageRenderer requires webGLSurface when renderer is webgl");
  }
  return surface;
}

function htmlSvgRootProps(surfaceWidth: number, surfaceHeight: number): {
  readonly width: number;
  readonly height: number;
  readonly style: { readonly width: "100%"; readonly height: "100%"; readonly display: "block" };
  readonly pointerEvents: "none";
  readonly "aria-hidden": true;
} {
  return {
    width: surfaceWidth,
    height: surfaceHeight,
    style: { width: "100%", height: "100%", display: "block" },
    pointerEvents: "none",
    "aria-hidden": true,
  };
}

function resolveFigPageRendererSurfaceSize(
  sceneGraph: SceneGraph | null,
  surfaceWidth: number,
  surfaceHeight: number,
): { readonly width: number; readonly height: number } {
  if (sceneGraph === null) {
    return { width: surfaceWidth, height: surfaceHeight };
  }
  if (sceneGraph.width !== surfaceWidth || sceneGraph.height !== surfaceHeight) {
    throw new Error(
      `FigPageRenderer surface size must match SceneGraph size: scene=${sceneGraph.width}x${sceneGraph.height}, surface=${surfaceWidth}x${surfaceHeight}`,
    );
  }
  return { width: sceneGraph.width, height: sceneGraph.height };
}

/** Render a prepared SceneGraph through the requested backend. */
export function FigPageRenderer({
  sceneGraph,
  surfaceWidth,
  surfaceHeight,
  viewportScale,
  kiwiDocumentMutation,
  viewportRevision,
  viewportInteractionActive,
  sceneGraphNodeTranslation,
  sceneGraphInteractionRevision,
  sceneGraphInteractionActive,
  renderOptions,
  renderer = "svg",
  host = "svg",
  webglInitializationDelayMs,
  webGLSurface,
}: FigPageRendererProps) {
  const surfaceSize = useMemo(
    () => resolveFigPageRendererSurfaceSize(sceneGraph, surfaceWidth, surfaceHeight),
    [sceneGraph, surfaceHeight, surfaceWidth],
  );

  if (renderer !== "webgl" && sceneGraph === null && host === "svg") {
    return <g aria-hidden="true" />;
  }
  if (renderer !== "webgl" && sceneGraph === null) {
    return (
      <svg {...htmlSvgRootProps(surfaceWidth, surfaceHeight)}>
        <g aria-hidden="true" />
      </svg>
    );
  }
  if (renderer !== "webgl" && host === "svg" && sceneGraph !== null) {
    return (
      <FigSceneSvgRenderer
        sceneGraph={sceneGraph}
        sceneGraphNodeTranslation={sceneGraphNodeTranslation}
        renderOptions={renderOptions}
      />
    );
  }
  if (renderer !== "webgl" && sceneGraph !== null) {
    return (
      <FigSceneSvgRenderer
        sceneGraph={sceneGraph}
        sceneGraphNodeTranslation={sceneGraphNodeTranslation}
        renderOptions={renderOptions}
        rootProps={htmlSvgRootProps(surfaceWidth, surfaceHeight)}
      />
    );
  }

  const webglLayer = (
    <FigWebGLViewportLayer
      sceneGraph={sceneGraph}
      renderOptions={renderOptions}
      kiwiDocumentMutation={kiwiDocumentMutation}
      surfaceWidth={surfaceSize.width}
      surfaceHeight={surfaceSize.height}
      viewportScale={viewportScale}
      viewportRevision={viewportRevision}
      viewportInteractionActive={viewportInteractionActive}
      sceneGraphInteractionRevision={sceneGraphInteractionRevision}
      sceneGraphInteractionActive={sceneGraphInteractionActive}
      sceneGraphNodeTranslation={sceneGraphNodeTranslation}
      initializationDelayMs={webglInitializationDelayMs}
      surface={requireFigPageRendererWebGLSurface(webGLSurface)}
    />
  );

  if (host === "html") {
    return webglLayer;
  }

  return (
    <foreignObject x={0} y={0} width={surfaceSize.width} height={surfaceSize.height} pointerEvents="none">
      {webglLayer}
    </foreignObject>
  );
}
