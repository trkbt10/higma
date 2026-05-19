/** @file Spec for collecting fonts through Kiwi nodes and SymbolResolver. */

import { indexFigKiwiDocument } from "../../domain";
import type { FigGuid, FigNode } from "../../types";
import { createSymbolResolver, type SymbolResolver } from "../../symbols";
import { collectFontQueries } from "./collect-queries";
import { fontQueryKey } from "../query";

const EMPTY_SYMBOL_RESOLVER: SymbolResolver = {
  resolveReferences: () => ({ effectiveSymbol: undefined, allDependencyGuids: [] }),
  resolveInstanceTarget: () => undefined,
  resolveInstance: () => {
    throw new Error("EMPTY_SYMBOL_RESOLVER cannot resolve INSTANCE nodes");
  },
  childrenOfResolvedNode: () => [],
};

function guid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function textNode(g: FigGuid, family: string, style: string): FigNode {
  return {
    guid: g,
    phase: { value: 0, name: "CREATED" },
    type: { value: 5, name: "TEXT" },
    fontName: { family, style },
    characters: "",
    lineHeight: { value: 16, units: { value: 1, name: "PIXELS" } },
    fontSize: 16,
  };
}

function frameNode(g: FigGuid, children: readonly FigNode[]): FigNode {
  return {
    guid: g,
    phase: { value: 0, name: "CREATED" },
    type: { value: 4, name: "FRAME" },
    children,
  };
}

function collect(roots: readonly FigNode[]): readonly string[] {
  return collectFontQueries({
    roots,
    symbolResolver: EMPTY_SYMBOL_RESOLVER,
    childrenOf: () => [],
  }).queries.map((q) => fontQueryKey(q));
}

function resolverFor(nodes: readonly FigNode[]): SymbolResolver {
  for (const node of nodes) {
    if (node.guid === undefined) {
      throw new Error("resolverFor requires every node to carry guid");
    }
  }
  return createSymbolResolver({
    document: indexFigKiwiDocument(nodes),
  });
}

describe("collectFontQueries", () => {
  it("returns empty when no nodes carry fontName", () => {
    const result = collectFontQueries({
      roots: [frameNode(guid(1, 1), [])],
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: () => [],
    });
    expect(result.queries).toEqual([]);
  });

  it("collects base font from a single TEXT node", () => {
    const result = collectFontQueries({
      roots: [textNode(guid(1, 1), "Inter", "Regular")],
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: () => [],
    });
    expect(result.queries).toEqual([{ family: "Inter", weight: 400, style: "normal" }]);
  });

  it("collects base font from structured textData.fontName", () => {
    const result = collectFontQueries({
      roots: [{
        ...textNode(guid(1, 1), "Inter", "Regular"),
        textData: { characters: "", fontName: { family: "Roboto", style: "Bold" } },
      }],
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: () => [],
    });
    expect(result.queries).toEqual([{ family: "Roboto", weight: 700, style: "normal" }]);
  });

  it("dedupes identical family, weight, and style", () => {
    expect(collect([
      textNode(guid(1, 1), "Inter", "Bold"),
      textNode(guid(1, 2), "Inter", "Bold"),
    ])).toHaveLength(1);
  });

  it("keeps distinct weights and italic style as separate queries", () => {
    const keys = collect([
      textNode(guid(1, 1), "Inter", "Regular"),
      textNode(guid(1, 2), "Inter", "Bold"),
      textNode(guid(1, 3), "Inter", "Italic"),
    ]);
    expect(keys.length).toBe(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("collects override fonts from styleOverrideTable", () => {
    const result = collectFontQueries({
      roots: [{
        ...textNode(guid(1, 1), "Inter", "Regular"),
        textData: {
          characters: "",
          fontName: { family: "Inter", style: "Regular" },
          styleOverrideTable: [
            { styleID: 2, fontName: { family: "Roboto", style: "Bold Italic" } },
          ],
        },
      }],
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: () => [],
    });
    const families = result.queries.map((q) => q.family);
    expect(families).toContain("Inter");
    expect(families).toContain("Roboto");
    expect(result.queries.find((q) => q.family === "Roboto")).toMatchObject({ weight: 700, style: "italic" });
  });

  it("recurses through the Kiwi document child index", () => {
    const rootGuid = guid(1, 1);
    const nestedGuid = guid(1, 3);
    const root = frameNode(rootGuid, []);
    const childText = {
      ...textNode(guid(1, 2), "Lato", "Regular"),
      parentIndex: { guid: rootGuid, position: "0" },
    };
    const nested = {
      ...frameNode(nestedGuid, []),
      parentIndex: { guid: rootGuid, position: "1" },
    };
    const nestedText = {
      ...textNode(guid(1, 4), "Merriweather", "Bold"),
      parentIndex: { guid: nestedGuid, position: "0" },
    };
    const document = indexFigKiwiDocument([root, childText, nested, nestedText]);
    const result = collectFontQueries({
      roots: [root],
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: document.childrenOf,
    });
    expect(result.queries.map((q) => q.family)).toEqual(expect.arrayContaining(["Lato", "Merriweather"]));
  });

  it("walks INSTANCE bodies through SymbolResolver", () => {
    const symbolGuid = guid(1, 10);
    const symbolChildren = [
      {
        ...textNode(guid(1, 11), "Source Sans Pro", "Regular"),
        parentIndex: { guid: symbolGuid, position: "0" },
      },
    ];
    const symbol = {
      ...frameNode(symbolGuid, symbolChildren),
      type: { value: 3, name: "SYMBOL" },
      size: { x: 100, y: 100 },
    } satisfies FigNode;
    const instance: FigNode = {
      guid: guid(1, 20),
      phase: { value: 0, name: "CREATED" },
      type: { value: 6, name: "INSTANCE" },
      symbolData: { symbolID: symbol.guid },
      size: { x: 100, y: 100 },
    };
    const result = collectFontQueries({
      roots: [instance],
      symbolResolver: resolverFor([symbol, ...symbolChildren]),
      childrenOf: () => [],
    });
    expect(result.queries.map((q) => q.family)).toContain("Source Sans Pro");
  });

  it("does not revisit a recursive SYMBOL body", () => {
    const symbolGuid = guid(1, 10);
    const childText = {
      ...textNode(guid(1, 11), "Inter", "Bold"),
      parentIndex: { guid: symbolGuid, position: "0" },
    };
    const nestedInstance: FigNode = {
      guid: guid(1, 12),
      phase: { value: 0, name: "CREATED" },
      type: { value: 6, name: "INSTANCE" },
      symbolData: { symbolID: symbolGuid },
      size: { x: 100, y: 100 },
      parentIndex: { guid: symbolGuid, position: "1" },
    };
    const symbol = {
      ...frameNode(symbolGuid, [childText, nestedInstance]),
      type: { value: 3, name: "SYMBOL" },
      size: { x: 100, y: 100 },
    } satisfies FigNode;
    const rootInstance: FigNode = {
      guid: guid(1, 20),
      phase: { value: 0, name: "CREATED" },
      type: { value: 6, name: "INSTANCE" },
      symbolData: { symbolID: symbolGuid },
      size: { x: 100, y: 100 },
    };
    const result = collectFontQueries({
      roots: [rootInstance],
      symbolResolver: resolverFor([symbol, childText, nestedInstance, rootInstance]),
      childrenOf: () => [],
    });
    expect(result.queries).toEqual([{ family: "Inter", weight: 700, style: "normal" }]);
  });

  it("skips empty-family queries", () => {
    const result = collectFontQueries({
      roots: [textNode(guid(1, 1), "", "")],
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: () => [],
    });
    expect(result.queries).toEqual([]);
  });
});
