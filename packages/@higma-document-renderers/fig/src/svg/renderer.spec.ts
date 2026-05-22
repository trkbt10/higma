/** @file SVG renderer font-loader integration tests. */

import type { FigNode } from "@higma-document-models/fig/types";
import { EMPTY_FIG_STYLE_REGISTRY, indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import type { AbstractFont, FontLoader, FontQuery, FontPath, LoadedFont } from "@higma-document-models/fig/font";
import { createSymbolResolver } from "@higma-document-models/fig/symbols";
import { renderFigToSvg } from "./renderer";
import { PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";

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

const RECT_FONT: AbstractFont = {
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

function createFontLoader(): FontLoader {
  const loaded: LoadedFont = {
    font: RECT_FONT,
    query: { family: "Unit Test Sans", weight: 400, style: "normal" },
  };
  return {
    async loadFont(query: FontQuery) {
      if (query.family !== "Unit Test Sans") {
        return undefined;
      }
      return loaded;
    },
    async isFontAvailable(family: string) {
      return family === "Unit Test Sans";
    },
  };
}

function createTextNode(): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 0, name: "TEXT" },
    name: "Text",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 120, y: 32 },
    fillPaints: [{ type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
    characters: "Hello",
    fontSize: 20,
    fontName: { family: "Unit Test Sans", style: "Regular" },
    lineHeight: { value: 24, units: { value: 0, name: "PIXELS" } },
    textAlignHorizontal: { value: 0, name: "LEFT" },
    textAlignVertical: { value: 0, name: "TOP" },
    derivedTextData: {
      baselines: [{
        position: { x: 0, y: 0 },
        width: 120,
        lineY: 0,
        lineHeight: 24,
        lineAscent: 16,
        firstCharacter: 0,
        endCharacter: 5,
      }],
      fontMetaData: [{
        key: { family: "Unit Test Sans", style: "Regular" },
        fontLineHeight: 1.2,
        fontWeight: 400,
      }],
    },
  };
}

function createEmptyFrameNode(): FigNode {
  return {
    guid: { sessionID: 1, localID: 2 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 1, name: "FRAME" },
    name: "Empty frame",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 120, y: 80 },
    fillPaints: [],
    strokePaints: [],
  };
}

describe("renderFigToSvg fontLoader", () => {
  it("preloads requested text fonts and renders font-backed glyph paths", async () => {
    const result = await renderFigToSvg([createTextNode()], {
      width: 120,
      height: 32,
      viewport: { x: 0, y: 0, width: 120, height: 32 },
      blobs: [],
      images: new Map(),
      childrenOf: () => [],
      symbolResolver: createSymbolResolver({
        document: indexFigKiwiDocument([]),
      }),
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      backgroundColor: "#ffffff",
      fontLoader: createFontLoader(),
    });

    expect(result.svg).toContain("<path");
    expect(result.svg).not.toContain("<text");
  });

  it("does not synthesize purple dashed chrome for plain empty FRAME roots", async () => {
    const result = await renderFigToSvg([createEmptyFrameNode()], {
      width: 120,
      height: 80,
      viewport: { x: 0, y: 0, width: 120, height: 80 },
      blobs: [],
      images: new Map(),
      childrenOf: () => [],
      symbolResolver: createSymbolResolver({
        document: indexFigKiwiDocument([]),
      }),
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      backgroundColor: "#ffffff",
    });

    expect(result.svg).not.toContain("#9747FF");
    expect(result.svg).not.toContain('stroke-dasharray="10 5"');
  });
});
