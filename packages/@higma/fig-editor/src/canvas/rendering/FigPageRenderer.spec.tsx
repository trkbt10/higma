/**
 * @file FigPageRenderer integration test
 *
 * Ensures the fig-editor renderer shell consumes selectable renderer
 * backends instead of duplicating a third React rendering path.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createDemoFigDesignDocument } from "@higma/fig-builder/context";
import type { FigDesignDocument, FigPage } from "@higma/fig/domain";
import { FigPageRenderer } from "./FigPageRenderer";
import type { FigEditorRendererKind } from "./renderer-kind";

// eslint-disable-next-line no-restricted-syntax -- initialized in beforeAll
let doc: FigDesignDocument;

beforeAll(async () => {
  doc = await createDemoFigDesignDocument();
});

function renderPage(
  { page, width, height, renderer }: {
    readonly page: FigPage;
    readonly width: number;
    readonly height: number;
    readonly renderer?: FigEditorRendererKind;
  },
): string {
  return renderToStaticMarkup(
    createElement(FigPageRenderer, {
      page,
      canvasWidth: width,
      canvasHeight: height,
      images: doc.images,
      blobs: doc.blobs,
      symbolMap: doc.components,
      styleRegistry: doc.styleRegistry,
      renderer,
    }),
  );
}

describe("FigPageRenderer — selectable renderer backend shell", () => {
  it("defaults to the SVG backend layer", () => {
    const html = renderPage({ page: doc.pages[0], width: 1200, height: 800 });
    expect(html).toContain("<img");
    expect(html).toContain("data:image/svg+xml");
  });

  it("does not emit a React SVG scene tree in the editor renderer shell", () => {
    const html = renderPage({ page: doc.pages[0], width: 1200, height: 800 });
    expect(html).not.toMatch(/<rect[^>]+fill="#ffffff"/i);
    expect(html).not.toMatch(/<(linearGradient|radialGradient)\b/);
  });

  it("can explicitly render through the SVG backend layer", () => {
    const html = renderPage({ page: doc.pages[0], width: 1200, height: 800, renderer: "svg" });
    expect(html).toContain("<img");
    expect(html).toContain("data:image/svg+xml");
  });

  it("can render through the WebGL backend layer shell", () => {
    const html = renderPage({ page: doc.pages[0], width: 1200, height: 800, renderer: "webgl" });
    expect(html).toContain("<canvas");
  });

  it("keeps the SVG viewport image screen-aligned when a viewport window is supplied", () => {
    const page = doc.pages[0];
    const html = renderToStaticMarkup(
      createElement(FigPageRenderer, {
        page,
        canvasWidth: 980,
        canvasHeight: 700,
        images: doc.images,
        blobs: doc.blobs,
        symbolMap: doc.components,
        styleRegistry: doc.styleRegistry,
        renderer: "svg",
        viewportX: 125,
        viewportY: -50,
        viewportWidth: 490,
        viewportHeight: 350,
        viewportPlacement: "screen",
      }),
    );

    expect(html).toContain("left:0");
    expect(html).toContain("top:0");
    expect(html).toContain("width:980px");
    expect(html).toContain("height:700px");
    expect(decodeURIComponent(html)).toContain('viewBox="125 -50 490 350"');
  });
});
