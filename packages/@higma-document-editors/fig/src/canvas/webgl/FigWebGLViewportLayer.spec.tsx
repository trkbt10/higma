/** @file Tests for WebGL viewport layer composition. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SceneGraph } from "@higma-document-models/fig/scene-graph";
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

describe("FigWebGLViewportLayer", () => {
  it("composes the WebGL canvas with preparation status UI", () => {
    const html = renderToStaticMarkup(
      createElement(FigWebGLViewportLayer, {
        sceneGraph,
        viewportScale: 1,
      }),
    );

    expect(html).toContain("<canvas");
    expect(html).toContain("data-webgl-ready=\"false\"");
    expect(html).toContain("data-webgl-loading=\"true\"");
    expect(html).toContain("data-webgl-loading-phase=\"scheduled\"");
    expect(html).toContain("WebGL resource preparation progress");
  });
});
