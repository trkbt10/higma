/**
 * @file React renderer boundary color profile tests.
 */

import { Buffer } from "node:buffer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";
import { EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";
import { createNodeId, type SceneGraph } from "@higma-document-models/fig/scene-graph";
import {
  createFigFamilyRenderOptions,
  FigFamilyPageRenderer,
} from "./index";

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
));

function createDocument(profile: FigDesignDocument["documentColorProfile"]): FigDesignDocument {
  return {
    pages: [],
    documentColorProfile: profile,
    components: new Map(),
    images: new Map(),
    blobs: [],
    metadata: null,
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
  };
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
          id: createNodeId("image-rect"),
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

describe("createFigFamilyRenderOptions", () => {
  it("maps an explicit SRGB document color profile into renderer export settings", () => {
    const options = createFigFamilyRenderOptions(createDocument({ value: 1, name: "SRGB" }));

    expect(options).toEqual({ exportSettings: { colorProfile: "SRGB" } });
  });

  it("keeps missing document color profile detectable by managed image rendering", () => {
    const options = createFigFamilyRenderOptions(createDocument(undefined));

    expect(options).toBeUndefined();
  });

  it("requires an explicit Display P3 ICC profile instead of guessing one", () => {
    expect(() => createFigFamilyRenderOptions(createDocument({ value: 2, name: "DISPLAY_P3_V4" })))
      .toThrow("Display P3 rendering requires explicit exportSettings.displayP3IccProfile");
  });
});

describe("FigFamilyPageRenderer", () => {
  it("passes explicit render export settings to color-managed image fills", () => {
    const sceneGraph = createManagedImageSceneGraph();
    const renderOptions = createFigFamilyRenderOptions(createDocument({ value: 1, name: "SRGB" }));

    const html = renderToStaticMarkup(createElement(FigFamilyPageRenderer, {
      page: null,
      canvasWidth: 1,
      canvasHeight: 1,
      images: new Map(),
      blobs: [],
      symbolMap: new Map(),
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      sceneGraph,
      renderOptions,
    }));

    expect(html).toContain("data:image/png");
  });
});
