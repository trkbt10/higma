/**
 * @file Fig page renderer component
 *
 * Selects the concrete fig renderer backend consumed by the React editor
 * shell. React owns mounting and editor chrome; node pixels come from the
 * SVG or WebGL backend.
 */

import type { FigPage } from "@higma-document-models/fig/domain";
import type { FigDocumentResources } from "@higma-document-io/fig/context";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import { useFigSceneGraph } from "@higma-figma-runtime/react-renderer";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { FigWebGLViewportLayer } from "../webgl/FigWebGLViewportLayer";
import { FigSvgViewportScene } from "./FigSvgViewportScene";
import type { FigEditorRendererKind } from "./renderer-kind";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";
import type { ViewportLayerPlacement } from "../layout/viewport-render-plan";

// =============================================================================
// Types
// =============================================================================

type FigPageRendererProps = {
  readonly page: FigPage;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /**
   * Renderer-facing resource bundle (`symbolMap` / `styleRegistry` /
   * `blobs` / `images`).
   *
   * SoT: obtain via `useFigDocumentResources()` (or
   * `figDocumentResources(document)`) — never destructure a
   * `FigDesignDocument` inline. Keeping every consumer on the bundle
   * means the four maps cannot drift relative to each other on a future
   * document refactor.
   */
  readonly resources: FigDocumentResources;
  readonly renderer?: FigEditorRendererKind;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly sceneGraph?: SceneGraph | null;
  readonly viewportX?: number;
  readonly viewportY?: number;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly viewportScale?: number;
  readonly viewportPlacement?: ViewportLayerPlacement;
  readonly webglPlacement?: ViewportLayerPlacement;
  readonly webglInitializationDelayMs?: number;
  readonly textFontResolver?: TextFontResolver;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Renders a fig page through the selected renderer backend.
 *
 * Builds a scene graph from the page's FigDesignNode tree (domain objects)
 * and hands that scene graph to either the SVG or WebGL backend layer.
 *
 * The scene graph is memoized and only recomputed when the page content,
 * dimensions, or resources change.
 */
export function FigPageRenderer({
  page,
  canvasWidth,
  canvasHeight,
  resources,
  renderer = "svg",
  renderOptions,
  sceneGraph: sceneGraphProp,
  viewportX = 0,
  viewportY = 0,
  viewportWidth,
  viewportHeight,
  viewportScale = 1,
  viewportPlacement,
  webglPlacement = "world",
  webglInitializationDelayMs,
  textFontResolver,
}: FigPageRendererProps) {
  const builtSceneGraph = useFigSceneGraph({
    page,
    canvasWidth,
    canvasHeight,
    viewportX,
    viewportY,
    viewportWidth,
    viewportHeight,
    images: resources.images,
    blobs: resources.blobs,
    symbolMap: resources.symbolMap,
    styleRegistry: resources.styleRegistry,
    textFontResolver,
  });
  const sceneGraph = sceneGraphProp ?? builtSceneGraph;

  if (!sceneGraph) {
    return <g />;
  }

  switch (renderer) {
    case "svg":
      return <FigSvgViewportScene sceneGraph={sceneGraph} renderOptions={renderOptions} placement={viewportPlacement ?? "world"} />;
    case "webgl":
      return (
        <FigWebGLViewportLayer
          sceneGraph={sceneGraph}
          renderOptions={renderOptions}
          viewportScale={viewportScale}
          placement={viewportPlacement ?? webglPlacement}
          initializationDelayMs={webglInitializationDelayMs}
        />
      );
  }
}
