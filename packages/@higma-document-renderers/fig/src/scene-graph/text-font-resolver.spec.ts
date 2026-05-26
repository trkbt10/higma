/** @file Scene graph text font resolver integration tests. */

import { EMPTY_FIG_STYLE_REGISTRY, indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import type { AbstractFont, FontPath } from "@higma-document-models/fig/font";
import type { TextNode } from "@higma-document-renderers/fig/scene-graph";
import { createSymbolResolver } from "@higma-document-models/fig/symbols";
import { buildSceneGraph, type BuildSceneGraphOptions } from "./builder";
import { resolveRenderTree } from "./render-tree";
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";

const RECT_PATH: FontPath = {
  commands: [
    { type: "M", x: 0, y: 0 },
    { type: "L", x: 10, y: 0 },
    { type: "L", x: 10, y: 10 },
    { type: "L", x: 0, y: 10 },
    { type: "Z" },
  ],
  toPathData: () => "M0 0L10 0L10 10L0 10Z",
};

const FONT: AbstractFont = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  charToGlyph: () => ({
    index: 1,
    advanceWidth: 500,
    getPath: () => RECT_PATH,
  }),
  getPath: () => RECT_PATH,
};

const WIDTH_ONLY_FONT: AbstractFont = {
  ...FONT,
  charToGlyph: () => ({
    index: 1,
    advanceWidth: 500,
    getPath: () => ({
      commands: [],
      toPathData: () => "",
    }),
  }),
  getPath: () => ({
    commands: [],
    toPathData: () => "",
  }),
};

function makeTextNode(): FigNode {
  const lineHeight = 24;
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 5, name: "TEXT" },
    name: "Text",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 200, y: 80 },
    fillPaints: [{ type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
    strokePaints: [],
    strokeWeight: 0,
    effects: [],
    characters: "Hello",
    fontSize: 20,
    fontName: { family: "Unit Test Sans", style: "Regular" },
    lineHeight: { value: 24, units: { name: "PIXELS", value: 0 } },
    textAlignHorizontal: { name: "LEFT", value: 0 },
    textAlignVertical: { name: "TOP", value: 0 },
    derivedTextData: {
      baselines: [{
        position: { x: 0, y: 0 },
        width: 200,
        lineY: 0,
        lineHeight,
        lineAscent: 18,
        firstCharacter: 0,
        endCharacter: 5,
      }],
      fontMetaData: [{
        key: { family: "Unit Test Sans", style: "Regular" },
        fontLineHeight: lineHeight / 20,
        fontWeight: 400,
      }],
    },
  };
}

function makeWrappingTextNode(): FigNode {
  const lineHeight = 20;
  return {
    ...makeTextNode(),
    guid: { sessionID: 1, localID: 2 },
    size: { x: 60, y: 120 },
    characters: "Hello World Wide",
    fontSize: 16,
    lineHeight: { value: lineHeight, units: { name: "PIXELS", value: 0 } },
    textAutoResize: { name: "NONE", value: 2 },
    derivedTextData: undefined,
  };
}

function buildOptions(textFontResolver: BuildSceneGraphOptions["textFontResolver"]): BuildSceneGraphOptions {
  const document = indexFigKiwiDocument([]);
  return {
    blobs: [],
    images: new Map(),
    canvasSize: { width: 300, height: 200 },
    viewport: { x: 0, y: 0, width: 300, height: 200 },
    sourceDocumentReference: document,
    sourceRevision: 0,
    symbolResolver: createSymbolResolver({
      document,
    }),
    childrenOf: () => [],
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
    showHiddenNodes: false,
    warnings: [],
    textFontResolver,
  };
}

describe("buildSceneGraph text font resolver", () => {
  it("keeps TEXT node-level blend out of the scene wrapper", () => {
    const sceneGraph = buildSceneGraph([{
      ...makeTextNode(),
      blendMode: { value: BLEND_MODE_VALUES.LINEAR_BURN, name: "LINEAR_BURN" },
    }], buildOptions(() => FONT));
    const text = sceneGraph.root.children[0] as TextNode;

    expect(text.blendMode).toBeUndefined();
    expect(text.fills[0]?.blendMode).toBeUndefined();
  });

  it("promotes explicit cached font outlines into the renderer-neutral text node", () => {
    const sceneGraph = buildSceneGraph([makeTextNode()], buildOptions(() => FONT));
    const text = sceneGraph.root.children[0] as TextNode;
    const renderTree = resolveRenderTree(sceneGraph);
    const renderText = renderTree.children[0];

    expect(text.glyphContours?.length).toBe(5);
    expect(text.textLineLayout?.lines[0]?.text).toBe("Hello");
    expect(renderText?.type).toBe("text");
    if (renderText?.type !== "text") {
      return;
    }
    expect(renderText.content.mode).toBe("glyphs");
  });

  it("keeps wrapped line layout as the shared SceneGraph/RenderTree source for SVG and WebGL", () => {
    const sceneGraph = buildSceneGraph([makeWrappingTextNode()], buildOptions(() => WIDTH_ONLY_FONT));
    const text = sceneGraph.root.children[0] as TextNode;
    const renderTree = resolveRenderTree(sceneGraph);
    const renderText = renderTree.children[0];
    const lineTexts = text.textLineLayout?.lines.map((line) => line.text);

    expect(lineTexts).toEqual(["Hello", "World", "Wide"]);
    expect(renderText?.type).toBe("text");
    if (renderText?.type !== "text") {
      return;
    }
    if (renderText.content.mode !== "lines") {
      throw new Error(`Expected text lines mode, got ${renderText.content.mode}`);
    }
    expect(renderText.content.layout.lines.map((line) => line.text)).toEqual(lineTexts);
    expect(renderText.sourceTextLineLayout?.lines.map((line) => line.text)).toEqual(lineTexts);
  });
});
