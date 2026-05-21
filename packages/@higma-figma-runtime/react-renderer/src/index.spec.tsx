/** @file React renderer boundary color profile tests. */

import { Buffer } from "node:buffer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges, figDocumentResources } from "@higma-document-io/fig/context";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import { EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";
import { createNodeId, type SceneGraph } from "@higma-document-renderers/fig/scene-graph/model";
import {
  createFigFamilyRenderOptions,
  FigFamilyPageRenderer,
} from "./index";

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
));

function createContext(profile: { readonly value: number; readonly name: string } | undefined): FigDocumentContext {
  return createFigDocumentContextFromNodeChanges({
    nodeChanges: [{
      guid: { sessionID: 0, localID: 0 },
      phase: { value: 0, name: "CREATED" },
      type: { value: 1, name: "DOCUMENT" },
      documentColorProfile: profile,
    }],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
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
              imageHash: "pixel",
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
    const options = createFigFamilyRenderOptions(createContext({ value: 1, name: "SRGB" }));

    expect(options).toEqual({ exportSettings: { colorProfile: "SRGB" } });
  });

  it("keeps missing document color profile detectable by managed image rendering", () => {
    const options = createFigFamilyRenderOptions(createContext(undefined));

    expect(options).toBeUndefined();
  });

  it("requires an explicit Display P3 ICC profile instead of guessing one", () => {
    expect(() => createFigFamilyRenderOptions(createContext({ value: 2, name: "DISPLAY_P3_V4" })))
      .toThrow("Display P3 rendering requires explicit exportSettings.displayP3IccProfile");
  });
});

describe("FigFamilyPageRenderer", () => {
  it("passes explicit render export settings to color-managed image fills", () => {
    const context = createContext({ value: 1, name: "SRGB" });
    const sceneGraph = createManagedImageSceneGraph();
    const renderOptions = createFigFamilyRenderOptions(context);

    const html = renderToStaticMarkup(createElement(FigFamilyPageRenderer, {
      page: null,
      canvasWidth: 1,
      canvasHeight: 1,
      resources: {
        ...figDocumentResources(context),
        styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      },
      sceneGraph,
      renderOptions,
    }));

    expect(html).toContain("data:image/png");
  });
});
