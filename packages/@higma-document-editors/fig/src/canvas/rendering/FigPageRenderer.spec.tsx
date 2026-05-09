/**
 * @file FigPageRenderer integration test
 *
 * Ensures the fig-editor renderer shell consumes selectable renderer
 * backends. The SVG backend is React-owned so editor updates can be
 * diffed instead of reparsing a full SVG image data URL.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Buffer } from "node:buffer";
import { createDemoFigDesignDocument, figDocumentResources } from "@higma-document-io/fig/context";
import type { FigPage } from "@higma-document-models/fig/domain";
import { createNodeId, type SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import { FigPageRenderer } from "./FigPageRenderer";
import type { FigEditorRendererKind } from "./renderer-kind";
import type { AbstractFont } from "@higma-document-models/fig/font";
import type { FigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";

const docPromise = createDemoFigDesignDocument();
const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
));

const testFont: AbstractFont = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  charToGlyph(char) {
    return {
      index: char.codePointAt(0) ?? 0,
      advanceWidth: 600,
      getPath() {
        return { commands: [], toPathData: () => "" };
      },
    };
  },
  getPath() {
    return { commands: [], toPathData: () => "" };
  },
};

async function renderPage(
  { page, width, height, renderer }: {
    readonly page: FigPage;
    readonly width: number;
    readonly height: number;
    readonly renderer?: FigEditorRendererKind;
  },
): Promise<string> {
  const doc = await docPromise;
  return renderToStaticMarkup(
    createElement(FigPageRenderer, {
      page,
      canvasWidth: width,
      canvasHeight: height,
      resources: figDocumentResources(doc),
      renderer,
      textFontResolver: () => testFont,
    }),
  );
}

function createManagedImageSceneGraph(): SceneGraph {
  return {
    width: 1,
    height: 1,
    version: 1,
    root: {
      type: "group",
      id: createNodeId("root"),
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      opacity: 1,
      visible: true,
      effects: [],
      children: [
        {
          type: "rect",
          id: createNodeId("managed-image"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 1,
          height: 1,
          fills: [
            {
              type: "image",
              imageRef: "pixel",
              data: ONE_PIXEL_PNG,
              mimeType: "image/png",
              scaleMode: "FILL",
              opacity: 1,
              imageShouldColorManage: true,
            },
          ],
        },
      ],
    },
  };
}

describe("FigPageRenderer — selectable renderer backend shell", () => {
  it("defaults to the SVG backend layer", async () => {
    const doc = await docPromise;
    const html = await renderPage({ page: doc.pages[0], width: 1200, height: 800 });
    expect(html).toContain("<svg");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("emits a React SVG scene tree in the editor renderer shell", async () => {
    const doc = await docPromise;
    const html = await renderPage({ page: doc.pages[0], width: 1200, height: 800 });
    expect(html).toMatch(/<rect[^>]+fill="#ffffff"/i);
  });

  it("can explicitly render through the SVG backend layer", async () => {
    const doc = await docPromise;
    const html = await renderPage({ page: doc.pages[0], width: 1200, height: 800, renderer: "svg" });
    expect(html).toContain("<svg");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("can render through the WebGL backend layer shell", async () => {
    const doc = await docPromise;
    const html = await renderPage({ page: doc.pages[0], width: 1200, height: 800, renderer: "webgl" });
    expect(html).toContain("<canvas");
    expect(html).toContain("data-webgl-ready=\"false\"");
  });

  it("keeps the SVG viewport image screen-aligned when a viewport window is supplied", async () => {
    const doc = await docPromise;
    const page = doc.pages[0];
    const html = renderToStaticMarkup(
      createElement(FigPageRenderer, {
        page,
        canvasWidth: 980,
        canvasHeight: 700,
        resources: figDocumentResources(doc),
        renderer: "svg",
        viewportX: 125,
        viewportY: -50,
        viewportWidth: 490,
        viewportHeight: 350,
        viewportPlacement: "screen",
        textFontResolver: () => testFont,
      }),
    );

    expect(html).toContain("left:0");
    expect(html).toContain("top:0");
    expect(html).toContain("width:980px");
    expect(html).toContain("height:700px");
    expect(html).toContain('viewBox="125 -50 490 350"');
  });

  it("passes explicit render settings to the SVG backend for color-managed image fills", async () => {
    const doc = await docPromise;
    const renderOptions: FigFamilyRenderOptions = { exportSettings: { colorProfile: "SRGB" } };
    const html = renderToStaticMarkup(
      createElement(FigPageRenderer, {
        page: doc.pages[0],
        canvasWidth: 1,
        canvasHeight: 1,
        resources: figDocumentResources(doc),
        renderer: "svg",
        sceneGraph: createManagedImageSceneGraph(),
        renderOptions,
        textFontResolver: () => testFont,
      }),
    );

    expect(html).toContain("data:image/png");
  });
});
