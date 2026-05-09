/**
 * @file Spec — `collectFontQueries` walks Figma trees and gathers fonts.
 */
import { collectFontQueries } from "./collect-queries";
import { fontQueryKey } from "../query";

describe("collectFontQueries", () => {
  it("returns empty when no nodes carry fontName", () => {
    const result = collectFontQueries({ roots: [{ type: "FRAME", children: [] }] });
    expect(result.queries).toEqual([]);
  });

  it("collects base font from a single TEXT node (top-level fontName)", () => {
    const result = collectFontQueries({
      roots: [{ type: "TEXT", fontName: { family: "Inter", style: "Regular" } }],
    });
    expect(result.queries.length).toBe(1);
    expect(result.queries[0].family).toBe("Inter");
    expect(result.queries[0].weight).toBe(400);
    expect(result.queries[0].style).toBe("normal");
  });

  it("collects base font from a TEXT node with structured textData.fontName", () => {
    const result = collectFontQueries({
      roots: [{ type: "TEXT", textData: { fontName: { family: "Roboto", style: "Bold" } } }],
    });
    expect(result.queries.length).toBe(1);
    expect(result.queries[0]).toEqual({ family: "Roboto", weight: 700, style: "normal" });
  });

  it("dedupes identical (family, weight, style) across multiple nodes", () => {
    const result = collectFontQueries({
      roots: [
        { type: "TEXT", fontName: { family: "Inter", style: "Bold" } },
        { type: "TEXT", fontName: { family: "Inter", style: "Bold" } },
      ],
    });
    expect(result.queries.length).toBe(1);
  });

  it("captures distinct weights and italic style as separate queries", () => {
    const result = collectFontQueries({
      roots: [
        { type: "TEXT", fontName: { family: "Inter", style: "Regular" } },
        { type: "TEXT", fontName: { family: "Inter", style: "Bold" } },
        { type: "TEXT", fontName: { family: "Inter", style: "Italic" } },
      ],
    });
    const keys = result.queries.map((q) => fontQueryKey(q));
    expect(keys.length).toBe(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("collects override fonts from styleOverrideTable", () => {
    const result = collectFontQueries({
      roots: [
        {
          type: "TEXT",
          fontName: { family: "Inter", style: "Regular" },
          textData: {
            fontName: { family: "Inter", style: "Regular" },
            styleOverrideTable: [
              { fontName: { family: "Roboto", style: "Bold Italic" } },
            ],
          },
        },
      ],
    });
    const families = result.queries.map((q) => q.family);
    expect(families).toContain("Inter");
    expect(families).toContain("Roboto");
    const robotoBoldItalic = result.queries.find((q) => q.family === "Roboto");
    expect(robotoBoldItalic?.weight).toBe(700);
    expect(robotoBoldItalic?.style).toBe("italic");
  });

  it("recurses into children", () => {
    const result = collectFontQueries({
      roots: [
        {
          type: "FRAME",
          children: [
            { type: "TEXT", fontName: { family: "Lato", style: "Regular" } },
            {
              type: "FRAME",
              children: [
                { type: "TEXT", fontName: { family: "Merriweather", style: "Bold" } },
              ],
            },
          ],
        },
      ],
    });
    const families = result.queries.map((q) => q.family);
    expect(families).toEqual(expect.arrayContaining(["Lato", "Merriweather"]));
  });

  it("walks INSTANCE bodies via the symbolMap", () => {
    type SymbolNode = {
      type: string;
      fontName?: { family: string; style: string };
      children?: readonly SymbolNode[];
    };
    const symbolMap = new Map<string, SymbolNode>([
      [
        "sym-1",
        {
          type: "FRAME",
          children: [
            { type: "TEXT", fontName: { family: "Source Sans Pro", style: "Regular" } },
          ],
        },
      ],
    ]);
    const result = collectFontQueries({
      roots: [{ type: "INSTANCE", symbolId: "sym-1" }],
      symbolMap,
    });
    expect(result.queries.map((q) => q.family)).toContain("Source Sans Pro");
  });

  it("does not infinite-loop when an INSTANCE references its own symbol body", () => {
    type Recursive = { type: string; symbolId?: string; children?: Recursive[]; fontName?: { family: string; style: string } };
    const symbol: Recursive = {
      type: "FRAME",
      children: [
        { type: "TEXT", fontName: { family: "Inter", style: "Bold" } },
        // simulate a self-referencing INSTANCE inside the symbol body
        { type: "INSTANCE", symbolId: "self" },
      ],
    };
    const symbolMap = new Map<string, Recursive>([["self", symbol]]);
    const result = collectFontQueries({
      roots: [{ type: "INSTANCE", symbolId: "self" }],
      symbolMap,
    });
    expect(result.queries.length).toBe(1);
    expect(result.queries[0].family).toBe("Inter");
  });

  it("skips empty-family queries (placeholder TEXT nodes)", () => {
    const result = collectFontQueries({
      roots: [{ type: "TEXT", fontName: { family: "", style: "" } }],
    });
    expect(result.queries).toEqual([]);
  });
});
