/**
 * @file Unit tests for symbol resolver
 */

import { FIG_NODE_TYPE, type FigGuid, type FigNode, type FigNodeType } from "@higma-document-models/fig/types";
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { cloneSymbolChildren, createSymbolResolver } from "./symbol-resolver";

type TestFigNodeInput = Omit<Partial<FigNode>, "children" | "type" | "guid" | "phase"> & {
  readonly type?: string | FigNode["type"];
  readonly guid?: FigGuid;
  readonly phase?: FigNode["phase"];
  readonly children?: readonly (TestFigNodeInput | FigNode | null | undefined)[];
};

const FIG_NODE_TYPE_VALUES: ReadonlySet<string> = new Set(Object.values(FIG_NODE_TYPE));

function isFigNodeType(value: string): value is FigNodeType {
  return FIG_NODE_TYPE_VALUES.has(value);
}

function kiwiType(type: TestFigNodeInput["type"]): FigNode["type"] {
  if (typeof type !== "string") {
    return type ?? { value: -1, name: "VECTOR" };
  }
  if (!isFigNodeType(type)) {
    throw new Error(`Unknown FigNodeType in symbol-resolver spec fixture: ${type}`);
  }
  return { value: -1, name: type };
}

function kiwiChildren(
  children: readonly (TestFigNodeInput | FigNode | null | undefined)[] | undefined,
): readonly FigNode[] | undefined {
  return children
    ?.filter((child): child is TestFigNodeInput | FigNode => child !== null && child !== undefined)
    .map((child) => createTestNode(child));
}

/** Create a FigNode from partial data for testing */
function createTestNode(data: TestFigNodeInput | FigNode): FigNode {
  return {
    ...data,
    guid: data.guid ?? { sessionID: 0, localID: 0 },
    phase: data.phase ?? { value: 1, name: "CREATED" },
    type: kiwiType(data.type),
    children: kiwiChildren(data.children),
  };
}

function childrenOfFixtureNode(node: FigNode): readonly FigNode[] {
  return node.children?.filter((child): child is FigNode => child !== null && child !== undefined) ?? [];
}

describe("cloneSymbolChildren", () => {
  it("returns empty array for SYMBOL with no children", () => {
    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "EmptySymbol",
    });

    const result = cloneSymbolChildren(symbolNode, { childrenOf: childrenOfFixtureNode });
    expect(result).toEqual([]);
  });

  it("deep clones children", () => {
    const child1 = {
      type: "RECTANGLE",
      name: "Rect1",
      guid: { sessionID: 1, localID: 1 },
    };

    const child2 = {
      type: "RECTANGLE",
      name: "Rect2",
      guid: { sessionID: 1, localID: 2 },
    };

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [child1, child2],
    });

    const result = cloneSymbolChildren(symbolNode, { childrenOf: childrenOfFixtureNode });

    expect(result).toHaveLength(2);
    expect(result[0]!).not.toBe(child1);
    expect(result[1]!).not.toBe(child2);
    expect(result[0]!.name).toBe("Rect1");
    expect(result[1]!.name).toBe("Rect2");
  });

  it("deep clones nested children", () => {
    const grandchild = {
      type: "ELLIPSE",
      name: "Circle",
      guid: { sessionID: 1, localID: 3 },
    };

    const child = createTestNode({
      type: "FRAME",
      name: "Frame",
      guid: { sessionID: 1, localID: 2 },
      children: [grandchild],
    });

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [child],
    });

    const result = cloneSymbolChildren(symbolNode, { childrenOf: childrenOfFixtureNode });

    expect(result).toHaveLength(1);
    expect(result[0]!.children).toHaveLength(1);
    expect(result[0]!.children![0]!.name).toBe("Circle");
    expect(result[0]!.children![0]).not.toBe(grandchild);
  });

  it("applies symbolOverrides to matching children", () => {
    const child = {
      type: "RECTANGLE",
      name: "OriginalName",
      guid: { sessionID: 1, localID: 10 },
    };

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [child],
    });

    const result = cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      symbolOverrides: [
        {
          guidPath: { guids: [{ sessionID: 1, localID: 10 }] },
          name: "OverriddenName",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("OverriddenName");
  });

  it("applies componentPropAssignments to TEXT children", () => {
    const textChild = {
      type: "TEXT",
      name: "Label",
      guid: { sessionID: 1, localID: 20 },
      componentPropRefs: [
        {
          defID: { sessionID: 1, localID: 100 },
          componentPropNodeField: { value: 0, name: "TEXT_DATA" },
        },
      ],
      textData: { characters: "Original" },
      characters: "Original",
    };

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [textChild],
    });

    const result = cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      componentPropAssignments: [
        {
          defID: { sessionID: 1, localID: 100 },
          value: { textValue: { characters: "Overridden" } },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect((result[0]! as Record<string, unknown>).characters).toBe("Overridden");
  });

  it("propagates depth-N symbolOverrides to nested INSTANCE children", () => {
    const nestedChild = {
      type: "TEXT",
      name: "NestedText",
      guid: { sessionID: 1, localID: 30 },
    };

    const instanceChild = createTestNode({
      type: "INSTANCE",
      name: "InstanceChild",
      guid: { sessionID: 1, localID: 20 },
      children: [nestedChild],
    });

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [instanceChild],
    });

    const result = cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      symbolOverrides: [
        {
          guidPath: { guids: [{ sessionID: 1, localID: 20 }, { sessionID: 1, localID: 30 }] },
          name: "DeepOverride",
        },
      ],
    });

    expect(result).toHaveLength(1);
    // depth-2 overrides targeting children WITHIN a nested INSTANCE are stored
    // as derivedSymbolData on the INSTANCE node (not symbolOverrides).
    // When the INSTANCE is later resolved during rendering, resolveInstance()
    // picks up derivedSymbolData and applies the overrides to the INSTANCE's children.
    const instanceResult = result[0]! as Record<string, unknown>;
    const propagated = instanceResult.derivedSymbolData as Array<Record<string, unknown>>;
    expect(propagated).toBeDefined();
    expect(propagated.length).toBeGreaterThan(0);
    // The shortened override should target localID 30 (the nested TEXT child)
    const firstEntry = propagated[0]! as { guidPath: { guids: Array<{ localID: number }> }; name: string };
    expect(firstEntry.guidPath.guids).toHaveLength(1);
    expect(firstEntry.guidPath.guids[0]!.localID).toBe(30);
    expect(firstEntry.name).toBe("DeepOverride");
  });

  it("applies componentPropAssignments VISIBLE toggle", () => {
    const child = {
      type: "RECTANGLE",
      name: "Toggleable",
      guid: { sessionID: 1, localID: 40 },
      visible: true,
      componentPropRefs: [
        {
          defID: { sessionID: 1, localID: 100 },
          componentPropNodeField: { value: 0, name: "VISIBLE" },
        },
      ],
    };

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [child],
    });

    const result = cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      componentPropAssignments: [
        {
          defID: { sessionID: 1, localID: 100 },
          value: { boolValue: false },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.visible).toBe(false);
  });

  it("applies componentPropAssignments OVERRIDDEN_SYMBOL_ID", () => {
    const instanceChild = {
      type: "INSTANCE",
      name: "SwappableInstance",
      guid: { sessionID: 1, localID: 50 },
      componentPropRefs: [
        {
          defID: { sessionID: 1, localID: 200 },
          componentPropNodeField: { value: 0, name: "OVERRIDDEN_SYMBOL_ID" },
        },
      ],
    };

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [instanceChild],
    });

    const newSymbolGuid = { sessionID: 2, localID: 10 };
    const result = cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      componentPropAssignments: [
        {
          defID: { sessionID: 1, localID: 200 },
          value: { guidValue: newSymbolGuid },
        },
      ],
    });

    expect(result).toHaveLength(1);
    const resultNode = result[0]! as Record<string, unknown>;
    expect(resultNode.overriddenSymbolID).toEqual(newSymbolGuid);
  });

  it("applies componentPropAssignments TEXT_DATA with proper field format", () => {
    const textChild = {
      type: "TEXT",
      name: "Label",
      guid: { sessionID: 1, localID: 60 },
      componentPropRefs: [
        {
          defID: { sessionID: 1, localID: 300 },
          componentPropNodeField: { value: 0, name: "TEXT_DATA" },
        },
      ],
      textData: { characters: "Original", lines: [{ lineType: 0 }] },
      characters: "Original",
    };

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [textChild],
    });

    const result = cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      componentPropAssignments: [
        {
          defID: { sessionID: 1, localID: 300 },
          value: {
            textValue: { characters: "Overridden Text" },
          },
        },
      ],
    });

    expect(result).toHaveLength(1);
    const resultNode = result[0]! as Record<string, unknown>;
    expect(resultNode.characters).toBe("Overridden Text");
    const textData = resultNode.textData as Record<string, unknown>;
    expect(textData.characters).toBe("Overridden Text");
    // derivedTextData should be deleted (stale glyph paths)
    expect(resultNode.derivedTextData).toBeUndefined();
  });

  it("preserves TEXT_DATA style ids that use Figma logical character length", () => {
    const characters = "A\u{100bfb}B";
    const textChild = {
      type: "TEXT",
      name: "LogicalStyleLabel",
      guid: { sessionID: 1, localID: 61 },
      componentPropRefs: [
        {
          defID: { sessionID: 1, localID: 301 },
          componentPropNodeField: { value: 0, name: "TEXT_DATA" },
        },
      ],
      textData: {
        characters,
        characterStyleIDs: [0, 1, 1],
        styleOverrideTable: [{ styleID: 1, fontSize: 18 }],
      },
      characters,
    };

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [textChild],
    });

    const result = cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      componentPropAssignments: [
        {
          defID: { sessionID: 1, localID: 301 },
          value: {
            textValue: { characters },
          },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.textData?.characterStyleIDs).toEqual([0, 1, 1]);
    expect(result[0]!.textData?.styleOverrideTable).toEqual([{ styleID: 1, fontSize: 18 }]);
  });
});

describe("createSymbolResolver", () => {
  it("keeps document-external INSTANCE nodes renderable when Kiwi carries derivedSymbolData", () => {
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External library instance",
      guid: { sessionID: 1, localID: 1 },
      symbolData: { symbolID: { sessionID: 99, localID: 100 } },
      derivedSymbolData: [
        {
          guidPath: { guids: [{ sessionID: 99, localID: 101 }] },
          size: { x: 100, y: 80 },
        },
      ],
    });
    const document = indexFigKiwiDocument([instance]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);

    expect(resolved.node).toBe(instance);
    expect(resolved.children).toEqual([]);
  });

  it("still fails fast when an INSTANCE has neither a local SYMBOL nor derivedSymbolData", () => {
    const instance = createTestNode({
      type: "INSTANCE",
      name: "Broken instance",
      guid: { sessionID: 1, localID: 2 },
      symbolData: { symbolID: { sessionID: 99, localID: 200 } },
    });
    const document = indexFigKiwiDocument([instance]);
    const resolver = createSymbolResolver({ document });

    expect(() => resolver.resolveInstance(instance)).toThrow(/does not resolve to a SYMBOL/);
  });
});
