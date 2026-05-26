/** @file Tests for WebGL viewport layer composition. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import { FigWebGLViewportLayer } from "./FigWebGLViewportLayer";

const sceneGraph: SceneGraph = {
  width: 320,
  height: 240,
  version: 1,
  viewport: {
    x: 0,
    y: 0,
    width: 320,
    height: 240,
  },
  root: {
    id: "0:1",
    type: "frame",
    name: "Root",
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    transform: "matrix(1 0 0 1 0 0)",
    opacity: 1,
    visible: true,
    children: [],
  },
};

const INITIAL_KIWI_DOCUMENT_MUTATION = Object.freeze({
  revision: 0,
  scope: "initial-load",
  changedGuidKeys: [],
});

describe("FigWebGLViewportLayer", () => {
  it("composes the WebGL canvas with preparation status UI", () => {
    const html = renderToStaticMarkup(
      createElement(FigWebGLViewportLayer, {
        sceneGraph,
        kiwiDocumentMutation: INITIAL_KIWI_DOCUMENT_MUTATION,
        surfaceWidth: sceneGraph.width,
        surfaceHeight: sceneGraph.height,
        viewportScale: 1,
        surface: {
          surfaceKey: "spec-webgl-surface",
          kind: "viewport",
          label: "Spec WebGL surface",
        },
      }),
    );

    expect(html).toContain("<canvas");
    expect(html).toContain("role=\"img\"");
    expect(html).toContain("aria-label=\"Spec WebGL surface\"");
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("WebGL resource preparation progress");
  });

  it("does not move stale canvas pixels during viewport panning", () => {
    const html = renderToStaticMarkup(
      createElement(FigWebGLViewportLayer, {
        sceneGraph,
        kiwiDocumentMutation: INITIAL_KIWI_DOCUMENT_MUTATION,
        surfaceWidth: sceneGraph.width,
        surfaceHeight: sceneGraph.height,
        viewportScale: 1,
        viewportRevision: 1,
        viewportInteractionActive: true,
        surface: {
          surfaceKey: "spec-webgl-surface-pan",
          kind: "viewport",
          label: "Spec WebGL panning surface",
        },
      }),
    );

    expect(html).not.toContain("translate3d");
    expect(html).not.toContain("will-change");
  });
});
