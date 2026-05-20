/**
 * @file Tests for text-rendering glyph outline resolution.
 */

import type { AbstractFont, FontPath } from "@higma-document-models/fig/font";
import { resolveTextLayout, resolveTextRendering } from "./resolve";
import type { TextFontResolver } from "./types";
import { PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";

const RECT_FONT_PATH: FontPath = {
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
    getPath: () => RECT_FONT_PATH,
  }),
  getPath: () => RECT_FONT_PATH,
};

const RECT_FONT_RESOLVER: TextFontResolver = () => RECT_FONT;

const BASE_TEXT_NODE = {
  size: { x: 200, y: 80 },
  opacity: 1,
  textData: {
    characters: "Hello",
    fontSize: 20,
    lineHeight: { value: 24, units: { value: 0, name: "PIXELS" } },
    fontName: { family: "Unit Test Sans", style: "Regular" },
    textAlignHorizontal: { value: 0, name: "LEFT" },
    textAlignVertical: { value: 0, name: "TOP" },
    textAutoResize: { value: 0, name: "WIDTH_AND_HEIGHT" },
    textDecoration: { value: 0, name: "NONE" },
  },
  fills: [
    {
      type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
    },
  ],
} as const;

describe("resolveTextRendering font outlines", () => {
  it("throws when non-empty text has no explicit font metrics source", () => {
    expect(() => resolveTextRendering(BASE_TEXT_NODE, { blobs: [] }))
      .toThrow('Text layout requires ascender metrics for font "Unit Test Sans"');
  });

  it("uses an explicit font resolver to produce shared glyph contours", () => {
    const rendering = resolveTextRendering(BASE_TEXT_NODE, {
      blobs: [],
      fontResolver: RECT_FONT_RESOLVER,
    });

    expect(rendering.kind).toBe("glyphs");
    if (rendering.kind !== "glyphs") {
      return;
    }
    expect(rendering.glyphContours).toHaveLength(5);
    expect(rendering.glyphContours.map((contour) => contour.firstCharacter)).toEqual([0, 1, 2, 3, 4]);
    expect(rendering.props.font.family).toBe("Unit Test Sans");
    expect(rendering.layout.lines[0]?.text).toBe("Hello");
  });

  it("ignores derivedLines when none of the lines carry characters", () => {
    const rendering = resolveTextRendering({
      ...BASE_TEXT_NODE,
      derivedTextData: {
        derivedLines: [{ width: 40 }],
      },
    }, {
      blobs: [],
      fontResolver: RECT_FONT_RESOLVER,
    });

    expect(rendering.kind).toBe("glyphs");
    if (rendering.kind !== "glyphs") {
      return;
    }
    expect(rendering.layout.lines[0]?.text).toBe("Hello");
  });

  it("throws when derivedLines mix present and missing characters", () => {
    expect(() => resolveTextRendering({
      ...BASE_TEXT_NODE,
      textData: {
        ...BASE_TEXT_NODE.textData,
        characters: "Hello\nWorld",
      },
      derivedTextData: {
        derivedLines: [
          { characters: "Hello" },
          { width: 40 },
        ],
      },
    }, {
      blobs: [],
      fontResolver: RECT_FONT_RESOLVER,
    })).toThrow("text-resolve:derived-lines:partial-set-invalidated");
  });

  it("does not render synthetic derived-glyph placeholders as line text", () => {
    const rendering = resolveTextRendering({
      ...BASE_TEXT_NODE,
      textData: {
        ...BASE_TEXT_NODE.textData,
        characters: "\uFFFC",
      },
      derivedTextData: {
        glyphs: [{
          commandsBlob: 0,
          position: { x: 0, y: 10 },
          fontSize: 20,
          firstCharacter: 0,
          advance: 0,
        }],
        baselines: [{
          position: { x: 0, y: 10 },
          width: 0,
          lineY: 0,
          lineHeight: 24,
          lineAscent: 19.2,
          firstCharacter: 0,
          endCharacter: 1,
        }],
        fontMetaData: [{
          key: { family: "Unit Test Sans", style: "Regular" },
          fontLineHeight: 1.2,
        }],
      },
    }, {
      blobs: [{ bytes: [] }],
      fontResolver: undefined,
    });

    expect(rendering.kind).toBe("empty");
  });

  it("uses Kiwi glyph positions for placeholder text line metrics before font measurement", () => {
    const minimalBlob = {
      bytes: [0x01, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const rendering = resolveTextRendering({
      ...BASE_TEXT_NODE,
      textData: {
        ...BASE_TEXT_NODE.textData,
        characters: "\uFFFC\uFFFC",
      },
      derivedTextData: {
        glyphs: [{
          commandsBlob: 0,
          position: { x: 3, y: 10 },
          fontSize: 20,
          firstCharacter: 0,
          advance: 0,
        }, {
          commandsBlob: 0,
          position: { x: 11, y: 10 },
          fontSize: 20,
          firstCharacter: 1,
          advance: 0,
        }],
        baselines: [{
          position: { x: 3, y: 10 },
          width: 15,
          lineY: 0,
          lineHeight: 24,
          lineAscent: 19.2,
          firstCharacter: 0,
          endCharacter: 2,
        }],
        fontMetaData: [{
          key: { family: "Unit Test Sans", style: "Regular" },
          fontLineHeight: 1.2,
        }],
      },
    }, {
      blobs: [minimalBlob],
      fontResolver: () => ({
        ...RECT_FONT,
        charToGlyph: () => ({
          index: 1,
          advanceWidth: Number.NaN,
          getPath: () => RECT_FONT_PATH,
        }),
      }),
    });

    expect(rendering.kind).toBe("glyphs");
    if (rendering.kind !== "glyphs") {
      return;
    }
    expect(rendering.layout.lines[0]?.charWidths).toEqual([8, 7]);
  });

  it("uses Kiwi font metrics for baseline layout and explicit font resolver for character widths", () => {
    const node = {
      ...BASE_TEXT_NODE,
      textData: {
        ...BASE_TEXT_NODE.textData,
        characters: "Edited",
        fontName: { family: "Poppins", style: "Regular" },
      },
      derivedTextData: {
        baselines: [{
          position: { x: 0, y: 19 },
          width: 60,
          lineY: 0,
          lineHeight: 24,
          lineAscent: 18,
          firstCharacter: 0,
          endCharacter: 6,
        }],
        fontMetaData: [{
          key: { family: "Poppins", style: "Regular" },
          fontLineHeight: 1.2,
        }],
      },
    };
    const layout = resolveTextLayout(node, { blobs: [], fontResolver: RECT_FONT_RESOLVER });
    const rendering = resolveTextRendering(node, { blobs: [], fontResolver: RECT_FONT_RESOLVER });

    expect(layout.layout.ascenderRatio).toBeCloseTo(0.9, 5);
    expect(layout.layout.lines[0]?.text).toBe("Edited");
    expect(rendering.kind).toBe("glyphs");
  });

  it("does not estimate character widths when only Kiwi line metrics remain", () => {
    const node = {
      ...BASE_TEXT_NODE,
      textData: {
        ...BASE_TEXT_NODE.textData,
        characters: "Edited",
        fontName: { family: "Poppins", style: "Regular" },
      },
      derivedTextData: {
        baselines: [{
          position: { x: 0, y: 19 },
          width: 60,
          lineY: 0,
          lineHeight: 24,
          lineAscent: 18,
          firstCharacter: 0,
          endCharacter: 6,
        }],
        fontMetaData: [{
          key: { family: "Poppins", style: "Regular" },
          fontLineHeight: 1.2,
        }],
      },
    };

    expect(() => resolveTextLayout(node, { blobs: [] }))
      .toThrow("text-resolve:derived-line-metrics:requires-font-or-glyph-advances");
  });

  it("threads resolved character widths into cursor-facing layout", () => {
    const rendering = resolveTextRendering({
      ...BASE_TEXT_NODE,
      textData: {
        ...BASE_TEXT_NODE.textData,
        characters: "ABC",
      },
    }, {
      blobs: [],
      fontResolver: () => ({
        ...RECT_FONT,
        charToGlyph: (char) => ({
          index: char.codePointAt(0) ?? 0,
          advanceWidth: char === "A" ? 100 : 200,
          getPath: () => RECT_FONT_PATH,
        }),
      }),
    });

    expect(rendering.kind).toBe("glyphs");
    if (rendering.kind !== "glyphs") {
      return;
    }
    expect(rendering.layout.lines[0]?.charWidths).toEqual([2, 4, 4]);
    expect(rendering.layout.lines[0]?.width).toBe(10);
  });
});
