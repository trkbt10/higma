/** @file FigPageRenderer backend selection tests over Kiwi context. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges, figDocumentResources, type FigDocumentContext } from "@higma-document-io/fig";
import type { FigNode } from "@higma-document-models/fig/types";
import { createKiwiSceneGraphPipeline, type KiwiSceneGraphMutation, type SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import {
  SECTION_COLORS,
  sectionNode,
  sectionPaints,
  sectionPage,
} from "../../panels/sections/section-specimen";
import { FigPageRenderer } from "./FigPageRenderer";

const INITIAL_KIWI_DOCUMENT_MUTATION: KiwiSceneGraphMutation = Object.freeze({
  revision: 0,
  scope: "initial-load",
  changedGuidKeys: [],
});

function requireSceneGraph({
  context,
  page,
  nodes,
  canvasWidth,
  canvasHeight,
  viewportX,
  viewportY,
  viewportWidth,
  viewportHeight,
}: {
  readonly context: FigDocumentContext;
  readonly page: FigNode;
  readonly nodes?: readonly FigNode[];
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): SceneGraph {
  const sceneGraph = createKiwiSceneGraphPipeline().resolve({
    page,
    nodes,
    canvasWidth,
    canvasHeight,
    viewportX,
    viewportY,
    viewportWidth,
    viewportHeight,
    kiwiDocumentMutation: INITIAL_KIWI_DOCUMENT_MUTATION,
    showHiddenNodes: false,
    resources: figDocumentResources(context),
  });
  if (sceneGraph === null) {
    throw new Error("FigPageRenderer spec requires a non-empty SceneGraph");
  }
  return sceneGraph;
}

function renderPage(renderer?: "svg" | "webgl", host?: "html" | "svg"): string {
  const page = sectionPage();
  const frame = sectionNode("FRAME", {
    guid: { sessionID: 81, localID: 2 },
    parentIndex: { guid: page.guid, position: "a" },
    name: "Frame",
    width: 320,
    height: 180,
    fillPaints: sectionPaints(SECTION_COLORS.blue),
  });
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: [page, frame],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return renderToStaticMarkup(createElement(FigPageRenderer, {
    sceneGraph: requireSceneGraph({
      context,
      page,
      canvasWidth: 320,
      canvasHeight: 180,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 320,
      viewportHeight: 180,
    }),
    kiwiDocumentMutation: INITIAL_KIWI_DOCUMENT_MUTATION,
    surfaceWidth: 320,
    surfaceHeight: 180,
    viewportScale: 1,
    renderer,
    host,
    webGLSurface: {
      surfaceKey: "fig-page-renderer-spec-webgl",
      kind: "viewport",
      label: "FigPageRenderer spec WebGL surface",
    },
  }));
}

function renderCompleteSceneGraphSvgPage(): string {
  const page = sectionPage();
  const visible = sectionNode("FRAME", {
    guid: { sessionID: 82, localID: 2 },
    parentIndex: { guid: page.guid, position: "a" },
    name: "Visible",
    width: 100,
    height: 100,
    fillPaints: sectionPaints(SECTION_COLORS.blue),
  });
  const outside = sectionNode("FRAME", {
    guid: { sessionID: 82, localID: 3 },
    parentIndex: { guid: page.guid, position: "b" },
    name: "Outside",
    width: 100,
    height: 100,
    transform: { m00: 1, m01: 0, m02: 300, m10: 0, m11: 1, m12: 0 },
    fillPaints: sectionPaints(SECTION_COLORS.red),
  });
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: [page, visible, outside],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return renderToStaticMarkup(createElement(FigPageRenderer, {
    sceneGraph: requireSceneGraph({
      context,
      page,
      nodes: [visible, outside],
      canvasWidth: 100,
      canvasHeight: 100,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 100,
      viewportHeight: 100,
    }),
    kiwiDocumentMutation: INITIAL_KIWI_DOCUMENT_MUTATION,
    surfaceWidth: 100,
    surfaceHeight: 100,
    viewportScale: 1,
    renderer: "svg",
    host: "html",
  }));
}

function renderScaledHtmlSvgPage(): string {
  const page = sectionPage();
  const frame = sectionNode("FRAME", {
    guid: { sessionID: 83, localID: 2 },
    parentIndex: { guid: page.guid, position: "a" },
    name: "Scaled Frame",
    width: 320,
    height: 180,
    fillPaints: sectionPaints(SECTION_COLORS.blue),
  });
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: [page, frame],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return renderToStaticMarkup(createElement(FigPageRenderer, {
    sceneGraph: requireSceneGraph({
      context,
      page,
      nodes: [frame],
      canvasWidth: 160,
      canvasHeight: 90,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 320,
      viewportHeight: 180,
    }),
    kiwiDocumentMutation: INITIAL_KIWI_DOCUMENT_MUTATION,
    surfaceWidth: 160,
    surfaceHeight: 90,
    viewportScale: 0.5,
    renderer: "svg",
    host: "html",
  }));
}

describe("FigPageRenderer", () => {
  it("defaults to the SVG backend without encoding an SVG image URL", () => {
    const html = renderPage();

    expect(html).toContain("<svg");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("keeps editor SVG output backed by the complete SceneGraph instead of viewport pruning", () => {
    const html = renderCompleteSceneGraphSvgPage();

    expect(html).toMatch(/fill="#3380e6"|fill="rgb\(51, ?128, ?230\)"/i);
    expect(html).toMatch(/fill="#e63333"|fill="rgb\(230, ?51, ?51\)"/i);
  });

  it("keeps editor-hosted SVG root dimensions in surface pixels while viewBox carries world viewport", () => {
    const html = renderScaledHtmlSvgPage();

    expect(html).toMatch(/<svg[^>]*width="160"[^>]*height="90"[^>]*viewBox="0 0 320 180"/);
    expect(html).toContain('style="width:100%;height:100%;display:block"');
    expect(html).toContain("aria-hidden=\"true\"");
  });

  it("rejects a renderer surface size that diverges from the SceneGraph render input", () => {
    const page = sectionPage();
    const frame = sectionNode("FRAME", {
      guid: { sessionID: 84, localID: 2 },
      parentIndex: { guid: page.guid, position: "a" },
      name: "Frame",
      width: 320,
      height: 180,
      fillPaints: sectionPaints(SECTION_COLORS.blue),
    });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [page, frame],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const sceneGraph = requireSceneGraph({
      context,
      page,
      nodes: [frame],
      canvasWidth: 160,
      canvasHeight: 90,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 320,
      viewportHeight: 180,
    });

    expect(() => renderToStaticMarkup(createElement(FigPageRenderer, {
      sceneGraph,
      kiwiDocumentMutation: INITIAL_KIWI_DOCUMENT_MUTATION,
      surfaceWidth: 320,
      surfaceHeight: 180,
      viewportScale: 0.5,
      renderer: "webgl",
      host: "html",
      webGLSurface: {
        surfaceKey: "fig-page-renderer-size-mismatch",
        kind: "viewport",
        label: "FigPageRenderer size mismatch",
      },
    }))).toThrow("surface size must match SceneGraph size");
  });

  it("renders the WebGL backend shell when requested", () => {
    const html = renderPage("webgl");

    expect(html).toContain("<foreignObject x=\"0\" y=\"0\" width=\"320\" height=\"180\"");
    expect(html).toContain("<canvas");
    expect(html).toContain("width=\"320\"");
    expect(html).toContain("height=\"180\"");
    expect(html).toContain("aria-label=\"FigPageRenderer spec WebGL surface\"");
  });

  it("renders WebGL directly when hosted by the editor screen viewport", () => {
    const html = renderPage("webgl", "html");

    expect(html).not.toContain("<foreignObject");
    expect(html).toContain("<canvas");
    expect(html).toContain("width=\"320\"");
    expect(html).toContain("height=\"180\"");
  });
});
