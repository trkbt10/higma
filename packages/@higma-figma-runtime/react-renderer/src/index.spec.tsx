/** @file React renderer boundary color profile tests. */

import { Buffer } from "node:buffer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges, figDocumentResources } from "@higma-document-io/fig/context";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import { EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigColor, FigGuid, FigMatrix, FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { createNodeId, type SceneGraph } from "@higma-document-renderers/fig/scene-graph/model";
import {
  createFigFamilyRenderOptions,
  FigFamilyPageRenderer,
} from "./index";

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
));

const PHASE_PAINT: KiwiEnumValue = { value: 0, name: "PAINT" };
const IDENTITY_MATRIX: FigMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
type RuntimeFixtureNodeType = "CANVAS" | "RECTANGLE";

function kiwiGuid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function nodeTypeValue(name: RuntimeFixtureNodeType): KiwiEnumValue<RuntimeFixtureNodeType> {
  return { value: NODE_TYPE_VALUES[name], name };
}

function solidPaint(color: FigColor): NonNullable<FigNode["fillPaints"]>[number] {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
  };
}

function rectNode(input: {
  readonly guid: FigGuid;
  readonly parentGuid: FigGuid;
  readonly position: string;
  readonly name: string;
  readonly x: number;
  readonly color: FigColor;
}): FigNode {
  return {
    guid: input.guid,
    phase: PHASE_PAINT,
    type: nodeTypeValue("RECTANGLE"),
    name: input.name,
    parentIndex: { guid: input.parentGuid, position: input.position },
    visible: true,
    opacity: 1,
    transform: { ...IDENTITY_MATRIX, m02: input.x },
    size: { x: 50, y: 50 },
    fillPaints: [solidPaint(input.color)],
  };
}

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

function createViewportContext(): {
  readonly context: FigDocumentContext;
  readonly page: FigNode;
  readonly nodes: readonly FigNode[];
} {
  const page = {
    guid: kiwiGuid(9, 1),
    phase: PHASE_PAINT,
    type: nodeTypeValue("CANVAS"),
    name: "Viewport",
    visible: true,
    opacity: 1,
    transform: IDENTITY_MATRIX,
    size: { x: 300, y: 100 },
  };
  const visible = rectNode({
    guid: kiwiGuid(9, 2),
    parentGuid: page.guid,
    position: "a",
    name: "visible",
    x: 0,
    color: { r: 1, g: 0, b: 0, a: 1 },
  });
  const outside = rectNode({
    guid: kiwiGuid(9, 3),
    parentGuid: page.guid,
    position: "b",
    name: "outside",
    x: 200,
    color: { r: 0, g: 0, b: 1, a: 1 },
  });
  return {
    context: createFigDocumentContextFromNodeChanges({
      nodeChanges: [page, visible, outside],
      blobs: [],
      images: new Map(),
      metadata: null,
    }),
    page,
    nodes: [visible, outside],
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

  it("prunes the runtime SceneGraph to the requested viewport before React rendering", () => {
    const { context, page, nodes } = createViewportContext();
    const html = renderToStaticMarkup(createElement(FigFamilyPageRenderer, {
      page,
      nodes,
      canvasWidth: 100,
      canvasHeight: 100,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 100,
      viewportHeight: 100,
      resources: {
        ...figDocumentResources(context),
        styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      },
    }));

    expect(html).toContain("#ff0000");
    expect(html).not.toContain("#0000ff");
  });
});
