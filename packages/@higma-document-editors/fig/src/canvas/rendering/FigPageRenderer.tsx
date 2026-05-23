/** @file Renderer switch for the Fig editor canvas. */
import {
  useFigSceneGraph,
} from "@higma-figma-runtime/react-renderer";
import type { FigDocumentResources } from "@higma-document-io/fig";
import type { FigNode } from "@higma-document-models/fig/types";
import { FigSceneSvgRenderer } from "@higma-document-renderers/fig/react";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";
import { FigWebGLViewportLayer } from "../webgl/FigWebGLViewportLayer";
import type { FigEditorRendererKind } from "./renderer-kind";

export type FigPageRendererProps = {
  readonly page: FigNode;
  readonly nodes?: readonly FigNode[];
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportScale: number;
  readonly viewportRevision?: number;
  readonly resources: FigDocumentResources;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly renderer?: FigEditorRendererKind;
  readonly host?: "html" | "svg";
  readonly textFontResolver?: TextFontResolver;
  readonly webglInitializationDelayMs?: number;
};

function htmlSvgRootProps(viewportWidth: number, viewportHeight: number): {
  readonly width: number;
  readonly height: number;
  readonly style: { readonly width: "100%"; readonly height: "100%"; readonly display: "block" };
  readonly "data-fig-family-page-renderer": "";
  readonly pointerEvents: "none";
  readonly "aria-hidden": true;
} {
  return {
    width: viewportWidth,
    height: viewportHeight,
    style: { width: "100%", height: "100%", display: "block" },
    "data-fig-family-page-renderer": "",
    pointerEvents: "none",
    "aria-hidden": true,
  };
}

/** Render a page through the requested backend while sharing the same scene graph inputs. */
export function FigPageRenderer({
  page,
  nodes,
  canvasWidth,
  canvasHeight,
  viewportX,
  viewportY,
  viewportWidth,
  viewportHeight,
  viewportScale,
  viewportRevision,
  resources,
  renderOptions,
  renderer = "svg",
  host = "svg",
  textFontResolver,
  webglInitializationDelayMs,
}: FigPageRendererProps) {
  const sceneGraph = useFigSceneGraph({
    page,
    nodes,
    canvasWidth,
    canvasHeight,
    viewportX,
    viewportY,
    viewportWidth,
    viewportHeight,
    resources,
    textFontResolver,
  });

  if (renderer !== "webgl" && sceneGraph === null && host === "svg") {
    return <g data-fig-page-renderer-empty="" />;
  }
  if (renderer !== "webgl" && sceneGraph === null) {
    return (
      <svg {...htmlSvgRootProps(viewportWidth, viewportHeight)}>
        <g data-fig-page-renderer-empty="" />
      </svg>
    );
  }
  if (renderer !== "webgl" && host === "svg" && sceneGraph !== null) {
    return (
      <FigSceneSvgRenderer sceneGraph={sceneGraph} renderOptions={renderOptions} />
    );
  }
  if (renderer !== "webgl" && sceneGraph !== null) {
    return (
      <FigSceneSvgRenderer
        sceneGraph={sceneGraph}
        renderOptions={renderOptions}
        rootProps={htmlSvgRootProps(viewportWidth, viewportHeight)}
      />
    );
  }

  const webglLayer = (
    <FigWebGLViewportLayer
      sceneGraph={sceneGraph}
      renderOptions={renderOptions}
      viewportScale={viewportScale}
      viewportRevision={viewportRevision}
      initializationDelayMs={webglInitializationDelayMs}
    />
  );

  if (host === "html") {
    return webglLayer;
  }

  return (
    <foreignObject x={0} y={0} width={canvasWidth} height={canvasHeight} pointerEvents="none">
      {webglLayer}
    </foreignObject>
  );
}
