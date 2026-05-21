/** @file FigPageRenderer backend selection tests over Kiwi context. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges, figDocumentResources } from "@higma-document-io/fig";
import {
  SECTION_COLORS,
  sectionNode,
  sectionPaints,
  sectionPage,
} from "../../panels/sections/section-specimen";
import { FigPageRenderer } from "./FigPageRenderer";

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
    page,
    canvasWidth: 320,
    canvasHeight: 180,
    viewportX: 0,
    viewportY: 0,
    viewportWidth: 320,
    viewportHeight: 180,
    viewportScale: 1,
    resources: figDocumentResources(context),
    renderer,
    host,
  }));
}

function renderPrunedSvgPage(): string {
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
    page,
    nodes: [visible, outside],
    canvasWidth: 100,
    canvasHeight: 100,
    viewportX: 0,
    viewportY: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    viewportScale: 1,
    resources: figDocumentResources(context),
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

  it("renders the same viewport-pruned SceneGraph that SVG and WebGL share", () => {
    const html = renderPrunedSvgPage();

    expect(html).toMatch(/fill="#3380e6"|fill="rgb\(51, ?128, ?230\)"/i);
    expect(html).not.toMatch(/fill="#e63333"|fill="rgb\(230, ?51, ?51\)"/i);
  });

  it("renders the WebGL backend shell when requested", () => {
    const html = renderPage("webgl");

    expect(html).toContain("<foreignObject x=\"0\" y=\"0\" width=\"320\" height=\"180\"");
    expect(html).toContain("<canvas");
    expect(html).toContain("width=\"320\"");
    expect(html).toContain("height=\"180\"");
    expect(html).toContain("data-webgl-ready=\"false\"");
  });

  it("renders WebGL directly when hosted by the editor screen viewport", () => {
    const html = renderPage("webgl", "html");

    expect(html).not.toContain("<foreignObject");
    expect(html).toContain("<canvas");
    expect(html).toContain("width=\"320\"");
    expect(html).toContain("height=\"180\"");
  });
});
