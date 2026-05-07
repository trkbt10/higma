/**
 * @file Tests for raw FigNode to FigDesignNode conversion.
 */

import { convertFigNode } from "./fig-node-conversion";
import type { FigGuid, FigNode, FigNodeType, FigPaint, KiwiEnumValue } from "@higma-document-models/fig/types";

const RED_PAINT: FigPaint = {
  type: "SOLID",
  color: { r: 1, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
};

function guid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function nodeType(value: number, name: FigNodeType): KiwiEnumValue<FigNodeType> {
  return { value, name };
}

function createNode(fields: Partial<FigNode>): FigNode {
  return {
    guid: guid(1, 1),
    phase: { value: 1, name: "CREATED" },
    type: nodeType(3, "FRAME"),
    name: "Node",
    ...fields,
  };
}

function collectNodeMap(nodes: readonly FigNode[]): ReadonlyMap<string, FigNode> {
  return new Map(nodes.map((node) => [`${node.guid.sessionID}:${node.guid.localID}`, node]));
}

describe("convertFigNode override path resolution", () => {
  it("accepts identity translations for descendants that are already in the symbol namespace", () => {
    const target = createNode({
      guid: guid(4, 2331),
      type: nodeType(4, "RECTANGLE"),
      name: "Target",
      overrideKey: guid(4, 2331),
    });
    const symbol = createNode({
      guid: guid(1, 100),
      type: nodeType(23, "SYMBOL"),
      name: "Symbol",
      children: [target],
    });
    const unrelated = createNode({
      guid: guid(7, 1),
      name: "Unrelated",
    });
    const instance = createNode({
      guid: guid(9, 1),
      type: nodeType(19, "INSTANCE"),
      name: "Instance",
      symbolID: symbol.guid,
      symbolOverrides: [
        { guidPath: { guids: [target.guid] }, fillPaints: [RED_PAINT] },
        { guidPath: { guids: [unrelated.guid] }, fillPaints: [RED_PAINT] },
      ],
    });

    const converted = convertFigNode(instance, new Map(), undefined, collectNodeMap([symbol, target, unrelated, instance]));

    expect(converted.overrides?.map((entry) => entry.guidPath.guids[0])).toEqual([target.guid]);
  });

  it("accepts derived symbol data addressed by a descendant overrideKey", () => {
    const target = createNode({
      guid: guid(4, 2331),
      type: nodeType(4, "RECTANGLE"),
      name: "Target",
      overrideKey: guid(87, 346),
    });
    const symbol = createNode({
      guid: guid(1, 100),
      type: nodeType(23, "SYMBOL"),
      name: "Symbol",
      children: [target],
    });
    const instance = createNode({
      guid: guid(9, 1),
      type: nodeType(19, "INSTANCE"),
      name: "Instance",
      symbolID: symbol.guid,
      derivedSymbolData: [
        {
          guidPath: { guids: [guid(87, 346)] },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 226 },
        },
      ],
    });

    const converted = convertFigNode(instance, new Map(), undefined, collectNodeMap([symbol, target, instance]));

    expect(converted.derivedSymbolData?.map((entry) => entry.guidPath.guids[0])).toEqual([target.guid]);
  });
});

describe("convertFigNode TEXT characterStyleIDs normalisation", () => {
  // Figma's `.fig` exporter omits trailing characterStyleIDs entries when
  // every remaining character uses the base style (styleID 0). The Kiwi
  // length-prefixed array therefore reports `length < characters.length`
  // for those tails. We pad here so downstream consumers see a single
  // canonical shape (`length === characters.length`) and never need to
  // model the trailing-omit compression themselves.

  function textNode(characters: string, characterStyleIDs: readonly number[] | undefined): FigNode {
    return createNode({
      guid: guid(2, 200),
      type: nodeType(5, "TEXT"),
      name: "Text",
      characters,
      textData: {
        characters,
        characterStyleIDs,
      },
    } as Partial<FigNode>);
  }

  it("pads trailing zeros when the Kiwi array is shorter than characters.length", () => {
    // 5-char source, 2 characterStyleIDs → expand to length 5 with [0, 0, 0]
    // appended. The leading override is preserved verbatim.
    const node = textNode("abcde", [3, 3]);
    const converted = convertFigNode(node, new Map(), undefined, collectNodeMap([node]));
    expect(converted.textData?.characterStyleIDs).toEqual([3, 3, 0, 0, 0]);
  });

  it("leaves a length-equal array untouched", () => {
    const ids = [1, 2, 3] as const;
    const node = textNode("abc", ids);
    const converted = convertFigNode(node, new Map(), undefined, collectNodeMap([node]));
    expect(converted.textData?.characterStyleIDs).toEqual([1, 2, 3]);
  });

  it("normalises an empty array to undefined (the no-overrides shape)", () => {
    const node = textNode("abc", []);
    const converted = convertFigNode(node, new Map(), undefined, collectNodeMap([node]));
    expect(converted.textData?.characterStyleIDs).toBeUndefined();
  });

  it("throws when characterStyleIDs overflows characters.length (file is corrupt)", () => {
    // Figma never emits this shape; surfacing it as a hard error
    // catches genuine corruption without masking it.
    const node = textNode("ab", [1, 2, 3]);
    expect(() => convertFigNode(node, new Map(), undefined, collectNodeMap([node])))
      .toThrow(/more characterStyleIDs \(3\) than characters \(2\)/);
  });
});
