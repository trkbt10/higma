/**
 * @file Path-based text rendering tests
 */
import {
  renderTextNodeAsPath,
  getFontMetricsFromFont,
  calculateBaselineOffset,
  type PathRenderContext,
} from "./path-render";
import type { FigNode } from "@higma-document-models/fig/types";
import type { FigBlob } from "@higma-document-models/fig/domain";
import { EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";
import type { AbstractFont, FontLoader, FontLoadOptions, LoadedFont } from "../../../font";

function createFakeFont(supportedChars: string): AbstractFont {
  return {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    charToGlyph(char) {
      const supported = supportedChars.includes(char);
      return {
        index: supported ? char.codePointAt(0) ?? 1 : 0,
        advanceWidth: 500,
        getPath(x, y, fontSize) {
          if (!supported) {
            return { commands: [], toPathData: () => "" };
          }
          return {
            commands: [
              { type: "M", x, y },
              { type: "L", x: x + fontSize / 2, y },
              { type: "L", x: x + fontSize / 2, y: y - fontSize },
              { type: "L", x, y: y - fontSize },
              { type: "Z" },
            ],
            toPathData: () => "",
          };
        },
      };
    },
    getPath(...args: Parameters<AbstractFont["getPath"]>) {
      const [text, x, y, fontSize, options] = args;
      const commands = Array.from(text).flatMap((char, index) =>
        this.charToGlyph(char).getPath(x + index * (fontSize / 2 + (options?.letterSpacing ?? 0)), y, fontSize).commands,
      );
      return { commands, toPathData: () => "" };
    },
  };
}

function loadedFont(font: AbstractFont, family: string): LoadedFont {
  return { font, query: { family, weight: 400, style: "normal" } };
}

function createFakeFontLoader(params: {
  readonly primary?: LoadedFont;
}): FontLoader {
  return {
    loadFont(_query: FontLoadOptions) {
      return Promise.resolve(params.primary);
    },
    isFontAvailable() {
      return Promise.resolve(params.primary !== undefined);
    },
  };
}

function createTextNode(characters: string): FigNode {
  return {
    type: { value: 8, name: "TEXT" },
    name: "test",
    characters,
    fontSize: 16,
    lineHeight: { value: 20, units: { value: 0, name: "PIXELS" } },
    fontName: { family: "MissingPrimary", style: "Regular" },
    size: { x: 100, y: 30 },
    textAlignHorizontal: { value: 0, name: "LEFT" },
    textAlignVertical: { value: 0, name: "TOP" },
    fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
    guid: { sessionID: 0, localID: 0 },
    phase: { value: 1, name: "CREATED" },
  };
}

function createPathRenderContext(fontLoader: FontLoader): PathRenderContext {
  return {
    canvasSize: { width: 100, height: 30 },
    blobs: [] as FigBlob[],
    images: new Map(),
    showHiddenNodes: false,
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
    fontLoader,
  };
}

describe("path-render", () => {
  describe("renderTextNodeAsPath", () => {
    it("renders simple text as path", async () => {
      const node = createTextNode("Hello");
      const primary = loadedFont(createFakeFont("Helo"), "Primary");
      const ctx = createPathRenderContext(createFakeFontLoader({ primary }));

      const result = await renderTextNodeAsPath(node, ctx);

      expect(result).toContain("<path");
      expect(result).toContain("d=");
    });

    it("returns empty for empty characters", async () => {
      const node: FigNode = {
        type: { value: 8, name: "TEXT" },
        name: "test",
        characters: "",
        fontSize: 16,
        guid: { sessionID: 0, localID: 0 },
        phase: { value: 1, name: "CREATED" },
      };

      const ctx: PathRenderContext = {
        canvasSize: { width: 100, height: 30 },
        blobs: [] as FigBlob[],
        images: new Map(),
        showHiddenNodes: false,
        styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
        fontLoader: createFakeFontLoader({}),
      };

      const result = await renderTextNodeAsPath(node, ctx);
      expect(result).toBe("");
    });

    it("throws when the primary font cannot cover visible text", async () => {
      const primary = loadedFont(createFakeFont("A"), "LatinOnly");
      const ctx = createPathRenderContext(createFakeFontLoader({ primary }));

      await expect(renderTextNodeAsPath(createTextNode("漢"), ctx))
        .rejects.toThrow("cannot cover text node");
    });
  });

  describe("getFontMetricsFromFont", () => {
    it("extracts metrics from loaded font", () => {
      const metrics = getFontMetricsFromFont(createFakeFont("A"));

      expect(metrics.unitsPerEm).toBeGreaterThan(0);
      expect(metrics.ascender).toBeGreaterThan(0);
      expect(metrics.descender).toBeLessThan(0);
      expect(typeof metrics.lineGap).toBe("number");
    });
  });

  describe("calculateBaselineOffset", () => {
    it("calculates offset for TOP alignment", () => {
      const offset = calculateBaselineOffset(createFakeFont("A"), 16, "TOP");
      // Offset should be positive (baseline below top)
      expect(offset).toBeGreaterThan(0);
      // Should be roughly around ascender height
      expect(offset).toBeLessThan(20);
    });

    it("calculates finite offsets for every alignment", () => {
      const font = createFakeFont("A");
      const offsets = [
        calculateBaselineOffset(font, 16, "TOP"),
        calculateBaselineOffset(font, 16, "CENTER"),
        calculateBaselineOffset(font, 16, "BOTTOM"),
      ];

      expect(offsets.every((offset) => Number.isFinite(offset))).toBe(true);
    });
  });
});
