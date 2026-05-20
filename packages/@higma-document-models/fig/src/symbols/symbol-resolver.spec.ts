/**
 * @file Unit tests for symbol resolver
 */

import {
  FIG_NODE_TYPE,
  type FigGuid,
  type FigKiwiVariableData,
  type FigKiwiVariableDataMap,
  type FigNode,
  type FigNodeType,
  type FigPaint,
} from "@higma-document-models/fig/types";
import { indexFigKiwiDocument, type FigBlob } from "@higma-document-models/fig/domain";
import { resolveAutoLayoutFrame } from "./autolayout-solver";
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

function solidPaint(r: number, g: number, b: number): FigPaint {
  return {
    type: { value: 0, name: "SOLID" },
    color: { r, g, b, a: 1 },
  };
}

function derivedTextData(width: number, height: number, glyphCount: number): NonNullable<FigNode["derivedTextData"]> {
  return {
    layoutSize: { x: width, y: height },
    glyphs: Array.from({ length: glyphCount }, (_, index) => ({
      commandsBlob: index,
      position: { x: index * 8, y: height },
      fontSize: 17,
      firstCharacter: index,
      advance: 8,
      rotation: 0,
    })),
    fontMetaData: [
      {
        key: { family: "SF Pro", style: "Regular", postscript: "" },
        fontLineHeight: 1.2,
        fontWeight: 400,
      },
    ],
  };
}

function float32Bytes(value: number): readonly number[] {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  return Array.from(new Uint8Array(buffer));
}

function rectPathBlob(width: number, height: number): FigBlob {
  return {
    bytes: [
      0x01, ...float32Bytes(0), ...float32Bytes(0),
      0x02, ...float32Bytes(width), ...float32Bytes(0),
      0x02, ...float32Bytes(width), ...float32Bytes(height),
      0x02, ...float32Bytes(0), ...float32Bytes(height),
      0x06,
    ],
  };
}

function variantVariableConsumptionMap(propName: string, variableKey: string): FigKiwiVariableDataMap {
  return {
    entries: [
      {
        variableData: {
          value: {
            expressionValue: {
              expressionFunction: { value: 2, name: "RESOLVE_VARIANT" },
              expressionArguments: [
                {
                  value: {
                    mapValue: {
                      values: [
                        {
                          key: propName,
                          value: {
                            value: {
                              alias: {
                                assetRef: { key: variableKey },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                } as FigKiwiVariableData,
              ],
            },
          },
        },
      },
    ],
  };
}

function variableModeBySetMap(setKey: string, modeID: FigGuid): NonNullable<FigNode["variableModeBySetMap"]> {
  return {
    entries: [
      {
        variableSetID: { assetRef: { key: setKey } },
        variableModeID: modeID,
      },
    ],
  };
}

function figGuidEquals(left: FigGuid, right: FigGuid): boolean {
  return left.sessionID === right.sessionID && left.localID === right.localID;
}

function findResolvedDescendant(nodes: readonly FigNode[], guid: FigGuid): FigNode | undefined {
  for (const node of nodes) {
    if (figGuidEquals(node.guid, guid)) {
      return node;
    }
    const found = findResolvedDescendant(childrenOfFixtureNode(node), guid);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
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

  it("rejects overriddenSymbolID symbolOverrides targeting non-INSTANCE nodes", () => {
    const child = {
      type: "RECTANGLE",
      name: "Not swappable",
      guid: { sessionID: 1, localID: 10 },
    };

    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [child],
    });

    expect(() => cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      symbolOverrides: [
        {
          guidPath: { guids: [{ sessionID: 1, localID: 10 }] },
          overriddenSymbolID: { sessionID: 2, localID: 1 },
        },
      ],
    })).toThrow(/overriddenSymbolID override targets RECTANGLE node 1:10/);
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

  it("rejects derivedSymbolData whose local target is neither present nor materialized", () => {
    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "TestSymbol",
      children: [
        {
          type: "FRAME",
          name: "Existing slot",
          guid: { sessionID: 1, localID: 20 },
        },
      ],
    });

    expect(() => cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      derivedSymbolData: [
        {
          guidPath: { guids: [{ sessionID: 1, localID: 99 }] },
          size: { x: 20, y: 10 },
        },
      ],
    })).toThrow(/override target 1:99 is not present/);
  });

  it("keeps unresolved stale derivedSymbolData from replacing a materialized SYMBOL subtree", () => {
    const oldSearchFieldGuid = { sessionID: 1, localID: 99 };
    const symbolNode = createTestNode({
      type: "SYMBOL",
      name: "Toolbar",
      children: [
        {
          type: "FRAME",
          name: "Search Field",
          guid: { sessionID: 2, localID: 20 },
          children: [
            {
              type: "TEXT",
              name: "Icon",
              guid: { sessionID: 2, localID: 21 },
            },
          ],
        },
      ],
    });

    const result = cloneSymbolChildren(symbolNode, {
      childrenOf: childrenOfFixtureNode,
      symbolOverrides: [
        {
          guidPath: { guids: [oldSearchFieldGuid] },
          name: "Search Field",
        },
      ],
      derivedSymbolData: [
        {
          guidPath: { guids: [oldSearchFieldGuid, { sessionID: 3, localID: 1 }] },
          size: { x: 21, y: 20 },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.guid).toEqual({ sessionID: 2, localID: 20 });
    expect(result[0]!.children?.[0]?.guid).toEqual({ sessionID: 2, localID: 21 });
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
  it("uses inherited variable modes and INSTANCE self VCM overrides for variant target selection", () => {
    const variantFrameGuid = { sessionID: 1, localID: 1 };
    const propDefGuid = { sessionID: 1, localID: 2 };
    const lightSymbolGuid = { sessionID: 1, localID: 10 };
    const darkSymbolGuid = { sessionID: 1, localID: 11 };
    const lightChildGuid = { sessionID: 1, localID: 20 };
    const darkChildGuid = { sessionID: 1, localID: 21 };
    const instanceGuid = { sessionID: 2, localID: 1 };
    const ghostSelfGuid = { sessionID: 9, localID: 9 };
    const lightMode = { sessionID: 404, localID: 0 };
    const darkMode = { sessionID: 404, localID: 1 };
    const variableSetKey = "colors-set";
    const variableKey = "mode-variable";
    const variantFrame = createTestNode({
      type: "FRAME",
      guid: variantFrameGuid,
      isStateGroup: true,
      componentPropDefs: [
        {
          id: propDefGuid,
          name: "Mode",
          type: { value: 4, name: "VARIANT" },
        },
      ],
    });
    const lightChild = createTestNode({
      type: "RECTANGLE",
      guid: lightChildGuid,
      name: "Light child",
      parentIndex: { guid: lightSymbolGuid, position: "!" },
    });
    const darkChild = createTestNode({
      type: "RECTANGLE",
      guid: darkChildGuid,
      name: "Dark child",
      parentIndex: { guid: darkSymbolGuid, position: "!" },
    });
    const lightSymbol = createTestNode({
      type: "SYMBOL",
      guid: lightSymbolGuid,
      parentIndex: { guid: variantFrameGuid, position: "!" },
      variantPropSpecs: [{ propDefId: propDefGuid, value: "Light" }],
      children: [lightChild],
    });
    const darkSymbol = createTestNode({
      type: "SYMBOL",
      guid: darkSymbolGuid,
      parentIndex: { guid: variantFrameGuid, position: "\"" },
      variantPropSpecs: [{ propDefId: propDefGuid, value: "Dark" }],
      children: [darkChild],
    });
    const variableSet = createTestNode({
      type: "VARIABLE_SET",
      guid: { sessionID: 3, localID: 1 },
      key: variableSetKey,
      variableSetModes: [
        { id: lightMode, name: "Light" },
        { id: darkMode, name: "Dark" },
      ],
    });
    const modeVariable = createTestNode({
      type: "VARIABLE",
      guid: { sessionID: 3, localID: 2 },
      key: variableKey,
      variableSetID: { assetRef: { key: variableSetKey } },
      variableDataValues: {
        entries: [
          { modeID: lightMode, variableData: { value: { textValue: "Light" } } },
          { modeID: darkMode, variableData: { value: { textValue: "Dark" } } },
        ],
      },
    });
    const instance = createTestNode({
      type: "INSTANCE",
      guid: instanceGuid,
      symbolData: {
        symbolID: lightSymbolGuid,
        symbolOverrides: [
          {
            guidPath: { guids: [ghostSelfGuid] },
            variableConsumptionMap: variantVariableConsumptionMap("Mode", variableKey),
          },
        ],
      },
    });
    const document = indexFigKiwiDocument([
      variantFrame,
      lightSymbol,
      lightChild,
      darkSymbol,
      darkChild,
      variableSet,
      modeVariable,
      instance,
    ]);
    const resolver = createSymbolResolver({ document });
    const scope = { variableModeBySetMap: variableModeBySetMap(variableSetKey, darkMode) };

    const references = resolver.resolveReferences(instance, scope);
    const resolved = resolver.resolveInstance(instance, scope);

    expect(references.effectiveSymbol?.guid).toEqual(darkSymbolGuid);
    expect(resolved.children[0]!.guid).toEqual(darkChildGuid);
    expect(resolved.node.variableModeBySetMap).toEqual(scope.variableModeBySetMap);
  });

  it("drops overrides addressed to inactive sibling variants in the same Variant Set", () => {
    const variantFrameGuid = { sessionID: 10, localID: 1 };
    const modeDefGuid = { sessionID: 10, localID: 2 };
    const selectedDefGuid = { sessionID: 10, localID: 3 };
    const lightSelectedGuid = { sessionID: 10, localID: 10 };
    const darkSelectedGuid = { sessionID: 10, localID: 11 };
    const darkUnselectedGuid = { sessionID: 10, localID: 12 };
    const darkSelectedChildGuid = { sessionID: 10, localID: 21 };
    const darkUnselectedChildGuid = { sessionID: 10, localID: 22 };
    const inactiveOverrideKey = { sessionID: 5568, localID: 3935 };
    const lightMode = { sessionID: 404, localID: 0 };
    const darkMode = { sessionID: 404, localID: 1 };
    const variableSetKey = "colors-set";
    const variableKey = "mode-variable";
    const variantFrame = createTestNode({
      type: "FRAME",
      guid: variantFrameGuid,
      isStateGroup: true,
      componentPropDefs: [
        { id: modeDefGuid, name: "Mode", type: { value: 4, name: "VARIANT" } },
        { id: selectedDefGuid, name: "Selected", type: { value: 4, name: "VARIANT" } },
      ],
    });
    const lightSelected = createTestNode({
      type: "SYMBOL",
      guid: lightSelectedGuid,
      parentIndex: { guid: variantFrameGuid, position: "!" },
      variantPropSpecs: [
        { propDefId: modeDefGuid, value: "Light" },
        { propDefId: selectedDefGuid, value: "True" },
      ],
    });
    const darkSelectedChild = createTestNode({
      type: "TEXT",
      guid: darkSelectedChildGuid,
      parentIndex: { guid: darkSelectedGuid, position: "!" },
      overrideKey: { sessionID: 5568, localID: 3932 },
      characters: "selected",
    });
    const darkSelected = createTestNode({
      type: "SYMBOL",
      guid: darkSelectedGuid,
      parentIndex: { guid: variantFrameGuid, position: "\"" },
      variantPropSpecs: [
        { propDefId: modeDefGuid, value: "Dark" },
        { propDefId: selectedDefGuid, value: "True" },
      ],
      children: [darkSelectedChild],
    });
    const darkUnselectedChild = createTestNode({
      type: "TEXT",
      guid: darkUnselectedChildGuid,
      parentIndex: { guid: darkUnselectedGuid, position: "!" },
      overrideKey: inactiveOverrideKey,
      characters: "inactive",
    });
    const darkUnselected = createTestNode({
      type: "SYMBOL",
      guid: darkUnselectedGuid,
      parentIndex: { guid: variantFrameGuid, position: "#" },
      variantPropSpecs: [
        { propDefId: modeDefGuid, value: "Dark" },
        { propDefId: selectedDefGuid, value: "False" },
      ],
      children: [darkUnselectedChild],
    });
    const variableSet = createTestNode({
      type: "VARIABLE_SET",
      guid: { sessionID: 11, localID: 1 },
      key: variableSetKey,
      variableSetModes: [
        { id: lightMode, name: "Light" },
        { id: darkMode, name: "Dark" },
      ],
    });
    const modeVariable = createTestNode({
      type: "VARIABLE",
      guid: { sessionID: 11, localID: 2 },
      key: variableKey,
      variableSetID: { assetRef: { key: variableSetKey } },
      variableDataValues: {
        entries: [
          { modeID: lightMode, variableData: { value: { textValue: "Light" } } },
          { modeID: darkMode, variableData: { value: { textValue: "Dark" } } },
        ],
      },
    });
    const instance = createTestNode({
      type: "INSTANCE",
      guid: { sessionID: 12, localID: 1 },
      symbolData: {
        symbolID: lightSelectedGuid,
        symbolOverrides: [
          {
            guidPath: { guids: [{ sessionID: 12, localID: 99 }] },
            variableConsumptionMap: variantVariableConsumptionMap("Mode", variableKey),
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [inactiveOverrideKey] },
          size: { x: 10, y: 10 },
        },
      ],
    });
    const document = indexFigKiwiDocument([
      variantFrame,
      lightSelected,
      darkSelected,
      darkSelectedChild,
      darkUnselected,
      darkUnselectedChild,
      variableSet,
      modeVariable,
      instance,
    ]);
    const resolver = createSymbolResolver({ document });

    const resolved = resolver.resolveInstance(instance, {
      variableModeBySetMap: variableModeBySetMap(variableSetKey, darkMode),
    });

    expect(resolved.children[0]!.guid).toEqual(darkSelectedChildGuid);
    expect(resolved.children[0]!.size).toBeUndefined();
  });

  it("scales derived text payload when derivedSymbolData uniformly resizes a TEXT slot", () => {
    const symbolGuid = { sessionID: 1, localID: 1 };
    const textGuid = { sessionID: 1, localID: 2 };
    const instanceGuid = { sessionID: 1, localID: 3 };
    const textNode = createTestNode({
      type: "TEXT",
      guid: textGuid,
      parentIndex: { guid: symbolGuid, position: "a" },
      size: { x: 100, y: 200 },
      textData: {
        characters: "1",
        fontSize: 100,
        lineHeight: { value: 120, units: { value: 1, name: "PIXELS" } },
      },
      derivedTextData: {
        layoutSize: { x: 100, y: 200 },
        baselines: [{
          position: { x: 0, y: 80 },
          width: 90,
          lineY: 80,
          lineHeight: 120,
          lineAscent: 90,
          firstCharacter: 0,
          endCharacter: 1,
        }],
        glyphs: [{
          commandsBlob: 0,
          position: { x: 10, y: 80 },
          fontSize: 100,
          advance: 40,
          firstCharacter: 0,
        }],
        derivedLines: [{
          characters: "1",
          baselinePosition: { x: 0, y: 80 },
          width: 90,
        }],
        truncatedHeight: 200,
      },
    });
    const symbol = createTestNode({
      type: "SYMBOL",
      guid: symbolGuid,
      size: { x: 100, y: 200 },
      children: [textNode],
    });
    const instance = createTestNode({
      type: "INSTANCE",
      guid: instanceGuid,
      size: { x: 50, y: 100 },
      symbolData: { symbolID: symbolGuid },
      derivedSymbolData: [{
        guidPath: { guids: [textGuid] },
        size: { x: 50, y: 100 },
      }],
    });
    const documentRoot = createTestNode({
      type: "DOCUMENT",
      guid: { sessionID: 1, localID: 0 },
      children: [symbol, instance],
    });
    const document = indexFigKiwiDocument([documentRoot, symbol, textNode, instance]);
    const resolver = createSymbolResolver({ document });

    const resolved = resolver.resolveInstance(instance);
    const resolvedText = resolved.children[0]!;

    expect(resolvedText.size).toEqual({ x: 50, y: 100 });
    expect(resolvedText.textData?.fontSize).toBe(50);
    expect(resolvedText.textData?.lineHeight).toEqual({ value: 60, units: { value: 1, name: "PIXELS" } });
    expect(resolvedText.derivedTextData?.layoutSize).toEqual({ x: 50, y: 100 });
    expect(resolvedText.derivedTextData?.glyphs?.[0]).toMatchObject({
      position: { x: 5, y: 40 },
      fontSize: 50,
      advance: 20,
    });
    expect(resolvedText.derivedTextData?.baselines?.[0]).toMatchObject({
      position: { x: 0, y: 40 },
      width: 45,
      lineY: 40,
      lineHeight: 60,
      lineAscent: 45,
    });
    expect(resolvedText.derivedTextData?.derivedLines?.[0]).toMatchObject({
      baselinePosition: { x: 0, y: 40 },
      width: 45,
    });
    expect(resolvedText.derivedTextData?.truncatedHeight).toBe(100);
  });

  it("resolves derivedSymbolData against a symbolOverride INSTANCE swap target", () => {
    const acrylicSymbolGuid = { sessionID: 42, localID: 338 };
    const arrowSymbolGuid = { sessionID: 42, localID: 343 };
    const checkSymbolGuid = { sessionID: 42, localID: 346 };
    const nestedInstanceGuid = { sessionID: 42, localID: 340 };
    const checkVectorGuid = { sessionID: 42, localID: 347 };
    const nestedOverrideKey = { sessionID: 19, localID: 170 };
    const arrowVectorOverrideKey = { sessionID: 66, localID: 7000 };
    const checkVectorOverrideKey = { sessionID: 66, localID: 7468 };
    const acrylicSymbol = createTestNode({
      type: "SYMBOL",
      name: "Icon Acrylic",
      guid: acrylicSymbolGuid,
      size: { x: 32, y: 32 },
    });
    const nestedInstance = createTestNode({
      type: "INSTANCE",
      name: "icon-arrow right",
      guid: nestedInstanceGuid,
      parentIndex: { guid: acrylicSymbolGuid, position: "a" },
      overrideKey: nestedOverrideKey,
      symbolData: {
        symbolID: arrowSymbolGuid,
        symbolOverrides: [
          {
            guidPath: { guids: [arrowVectorOverrideKey] },
            visible: false,
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [arrowVectorOverrideKey] },
          size: { x: 99, y: 99 },
          transform: { m00: 1, m01: 0, m02: 99, m10: 0, m11: 1, m12: 99 },
        },
      ],
      size: { x: 32, y: 32 },
    });
    const arrowSymbol = createTestNode({
      type: "SYMBOL",
      name: "icon-arrow right",
      guid: arrowSymbolGuid,
      size: { x: 32, y: 32 },
    });
    const arrowVector = createTestNode({
      type: "VECTOR",
      name: "Arrow vector",
      guid: { sessionID: 42, localID: 344 },
      parentIndex: { guid: arrowSymbolGuid, position: "a" },
      overrideKey: arrowVectorOverrideKey,
      size: { x: 10, y: 10 },
    });
    const checkSymbol = createTestNode({
      type: "SYMBOL",
      name: "icon-check",
      guid: checkSymbolGuid,
      size: { x: 22.4, y: 22.4 },
    });
    const checkVector = createTestNode({
      type: "VECTOR",
      name: "Vector",
      guid: checkVectorGuid,
      parentIndex: { guid: checkSymbolGuid, position: "a" },
      overrideKey: checkVectorOverrideKey,
      size: { x: 1, y: 1 },
    });
    const outerInstance = createTestNode({
      type: "INSTANCE",
      name: "Icon Acrylic",
      guid: { sessionID: 42, localID: 327 },
      symbolData: {
        symbolID: acrylicSymbolGuid,
        symbolOverrides: [
          {
            guidPath: { guids: [nestedOverrideKey] },
            overriddenSymbolID: checkSymbolGuid,
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [nestedOverrideKey, checkVectorOverrideKey] },
          size: { x: 8.96, y: 6.16 },
        },
      ],
    });
    const document = indexFigKiwiDocument([
      acrylicSymbol,
      nestedInstance,
      arrowSymbol,
      arrowVector,
      checkSymbol,
      checkVector,
      outerInstance,
    ]);
    const resolver = createSymbolResolver({ document });
    const resolvedOuter = resolver.resolveInstance(outerInstance);
    const resolvedNestedSlot = resolvedOuter.children[0]!;
    const resolvedNested = resolver.resolveInstance(resolvedNestedSlot);

    expect(resolvedNestedSlot.overriddenSymbolID).toEqual(checkSymbolGuid);
    expect(resolvedNested.node.visible).not.toBe(false);
    expect(resolvedNested.children).toHaveLength(1);
    expect(resolvedNested.children[0]!.guid).toEqual(checkVectorGuid);
    expect(resolvedNested.children[0]!.size).toEqual({ x: 8.96, y: 6.16 });
  });

  it("binds derivedSymbolData addressed through SYMBOL overrideKey values", () => {
    const symbol = createTestNode({
      type: "SYMBOL",
      name: "Cards/Book",
      guid: { sessionID: 8, localID: 964 },
      overrideKey: { sessionID: 0, localID: 1641 },
      size: { x: 48, y: 48 },
    });
    const cover = createTestNode({
      type: "ROUNDED_RECTANGLE",
      name: "Rectangle",
      guid: { sessionID: 8, localID: 965 },
      parentIndex: { guid: { sessionID: 8, localID: 964 }, position: "a" },
      overrideKey: { sessionID: 0, localID: 1642 },
      size: { x: 48, y: 48 },
    });
    const inset = createTestNode({
      type: "ROUNDED_RECTANGLE",
      name: "Rectangle",
      guid: { sessionID: 8, localID: 966 },
      parentIndex: { guid: { sessionID: 8, localID: 964 }, position: "b" },
      overrideKey: { sessionID: 0, localID: 1643 },
      size: { x: 24, y: 24 },
    });
    const instance = createTestNode({
      type: "INSTANCE",
      name: "Cards/Book",
      guid: { sessionID: 10, localID: 1466 },
      symbolData: { symbolID: { sessionID: 8, localID: 964 } },
      size: { x: 104, y: 418 },
      derivedSymbolData: [
        {
          guidPath: { guids: [{ sessionID: 0, localID: 1641 }] },
          size: { x: 104, y: 418 },
        },
        {
          guidPath: { guids: [{ sessionID: 0, localID: 1642 }] },
          size: { x: 104, y: 418 },
        },
        {
          guidPath: { guids: [{ sessionID: 0, localID: 1643 }] },
          size: { x: 80, y: 382 },
          transform: { m00: 1, m01: 0, m02: 11, m10: 0, m11: 1, m12: 18 },
        },
      ],
    });
    const document = indexFigKiwiDocument([symbol, cover, inset, instance]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);

    expect(resolved.node.size).toEqual({ x: 104, y: 418 });
    expect(resolved.children[0]!.size).toEqual({ x: 104, y: 418 });
    expect(resolved.children[1]!.size).toEqual({ x: 80, y: 382 });
    expect(resolved.children[1]!.transform?.m02).toBe(11);
  });

  it("materializes document-external INSTANCE children from Kiwi derivedSymbolData", () => {
    const textSlot = { sessionID: 99, localID: 101 };
    const glyphSlot = { sessionID: 99, localID: 102 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External library instance",
      guid: { sessionID: 1, localID: 1 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 100 },
        symbolOverrides: [
          {
            guidPath: { guids: [textSlot] },
            componentPropAssignments: [
              {
                defID: { sessionID: 99, localID: 1 },
                value: { textValue: { characters: "\u{100184} " } },
              },
            ],
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [textSlot] },
          size: { x: 36, y: 36 },
          transform: { m00: 1, m01: 0, m02: 6, m10: 0, m11: 1, m12: 6 },
        },
        {
          guidPath: { guids: [textSlot, glyphSlot] },
          derivedTextData: {
            layoutSize: { x: 36, y: 36 },
            glyphs: [
              {
                commandsBlob: 0,
                position: { x: 6, y: 24 },
                fontSize: 17,
                firstCharacter: 0,
                advance: 1,
                rotation: 0,
              },
            ],
            fontMetaData: [
              {
                key: { family: "SF Pro", style: "Medium", postscript: "" },
                fontLineHeight: 1.2,
                fontWeight: 510,
              },
            ],
          },
        },
      ],
    });
    const document = indexFigKiwiDocument([instance]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);

    expect(resolved.node.guid).toEqual(instance.guid);
    expect(resolved.children).toHaveLength(1);
    expect(resolved.children[0]!.guid).toEqual(textSlot);
    expect(resolved.children[0]!.type.name).toBe("TEXT");
    expect(resolved.children[0]!.textData?.characters).toBe("\u{100184} ");
    expect(resolved.children[0]!.derivedTextData?.glyphs).toHaveLength(1);
  });

  it("keeps document-external derivedSymbolData layer order when symbolOverrides target an existing slot", () => {
    const maskSlot = { sessionID: 99, localID: 90 };
    const textSlot = { sessionID: 99, localID: 101 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External library instance",
      guid: { sessionID: 1, localID: 11 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 100 },
        symbolOverrides: [
          {
            guidPath: { guids: [textSlot] },
            componentPropAssignments: [
              {
                defID: { sessionID: 99, localID: 1 },
                value: { textValue: { characters: "Search" } },
              },
            ],
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [maskSlot] },
          fillGeometry: [{ commandsBlob: 1, styleID: 0 }],
        },
        {
          guidPath: { guids: [textSlot] },
          size: { x: 36, y: 36 },
          transform: { m00: 1, m01: 0, m02: 6, m10: 0, m11: 1, m12: 6 },
          derivedTextData: derivedTextData(36, 36, 1),
        },
      ],
    });
    const document = indexFigKiwiDocument([instance]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);

    expect(resolved.children.map((child) => child.guid)).toEqual([maskSlot, textSlot]);
    expect(resolved.children[1]!.textData?.characters).toBe("Search");
  });

  it("positions document-external root-mask coordinate space inside the INSTANCE bounds", () => {
    const rootMaskSlot = { sessionID: 99, localID: 90 };
    const screenSlot = { sessionID: 99, localID: 101 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External masked screen",
      guid: { sessionID: 1, localID: 12 },
      size: { x: 120, y: 80 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 100 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [rootMaskSlot] },
          fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
          strokeGeometry: [{ commandsBlob: 0, styleID: 0 }],
        },
        {
          guidPath: { guids: [screenSlot] },
          fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
        },
      ],
    });
    const document = indexFigKiwiDocument([instance]);
    const resolver = createSymbolResolver({ document, blobs: [rectPathBlob(100, 40)] });
    const resolved = resolver.resolveInstance(instance);

    expect(resolved.children.map((child) => child.guid)).toEqual([rootMaskSlot, screenSlot]);
    expect(resolved.children[0]!.mask).toBe(true);
    expect(resolved.children[0]!.transform?.m02).toBe(10);
    expect(resolved.children[0]!.transform?.m12).toBe(20);
    expect(resolved.children[1]!.transform?.m02).toBe(10);
    expect(resolved.children[1]!.transform?.m12).toBe(20);
  });

  it("lets outer document-external derived text payload supersede local instance payload", () => {
    const outerSymbolGuid = { sessionID: 1, localID: 100 };
    const innerInstanceGuid = { sessionID: 1, localID: 101 };
    const missingExternalSymbolGuid = { sessionID: 200, localID: 100 };
    const containerSlot = { sessionID: 99, localID: 201 };
    const textSlot = { sessionID: 99, localID: 202 };
    const innerLocalDerivedTextData = {
      layoutSize: { x: 180, y: 460 },
      glyphs: [{
        commandsBlob: 0,
        position: { x: 0, y: 368 },
        fontSize: 380,
        firstCharacter: 0,
        advance: 1,
        rotation: 0,
      }],
      fontMetaData: [{
        key: { family: "SF Pro Rounded", style: "Semibold", postscript: "" },
        fontLineHeight: 1.2,
        fontWeight: 600,
      }],
    };
    const outerScaledDerivedTextData = {
      layoutSize: { x: 47, y: 120 },
      glyphs: [{
        commandsBlob: 0,
        position: { x: 0, y: 96 },
        fontSize: 100,
        firstCharacter: 0,
        advance: 1,
        rotation: 0,
      }],
      fontMetaData: [{
        key: { family: "SF Pro Rounded", style: "Semibold", postscript: "" },
        fontLineHeight: 1.2,
        fontWeight: 600,
      }],
    };
    const nestedInstance = createTestNode({
      type: "INSTANCE",
      guid: innerInstanceGuid,
      parentIndex: { guid: outerSymbolGuid, position: "a" },
      symbolData: { symbolID: missingExternalSymbolGuid },
      derivedSymbolData: [
        {
          guidPath: { guids: [containerSlot] },
          size: { x: 180, y: 460 },
        },
        {
          guidPath: { guids: [containerSlot, textSlot] },
          size: { x: 180, y: 460 },
          derivedTextData: innerLocalDerivedTextData,
        },
      ],
    });
    const outerSymbol = createTestNode({
      type: "SYMBOL",
      guid: outerSymbolGuid,
      children: [nestedInstance],
    });
    const outerInstance = createTestNode({
      type: "INSTANCE",
      guid: { sessionID: 1, localID: 102 },
      symbolData: { symbolID: outerSymbolGuid },
      derivedSymbolData: [
        {
          guidPath: { guids: [innerInstanceGuid, containerSlot, textSlot] },
          size: { x: 47, y: 120 },
          derivedTextData: outerScaledDerivedTextData,
        },
      ],
    });
    const document = indexFigKiwiDocument([outerSymbol, nestedInstance, outerInstance]);
    const resolver = createSymbolResolver({ document });
    const resolvedOuter = resolver.resolveInstance(outerInstance);
    const resolvedInner = resolver.resolveInstance(resolvedOuter.children[0]!);
    const resolvedText = resolvedInner.children[0]!.children![0]!;

    expect(resolvedText.size).toEqual({ x: 47, y: 120 });
    expect(resolvedText.derivedTextData?.layoutSize).toEqual({ x: 47, y: 120 });
    expect(resolvedText.derivedTextData?.glyphs?.[0]?.fontSize).toBe(100);
    expect(resolvedText.textData?.fontSize).toBe(100);
  });

  it("applies explicit document-external visual context to derived text slots", () => {
    const containerSlot = { sessionID: 99, localID: 110 };
    const textSlot = { sessionID: 99, localID: 111 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External icon button",
      guid: { sessionID: 1, localID: 8 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
        symbolOverrides: [
          {
            guidPath: { guids: [containerSlot] },
            fillPaints: [solidPaint(0, 0, 0)],
          },
          {
            guidPath: { guids: [containerSlot, textSlot] },
            componentPropAssignments: [
              {
                defID: { sessionID: 99, localID: 1 },
                value: { textValue: { characters: "\u{100184} " } },
              },
            ],
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [containerSlot] },
          size: { x: 48, y: 48 },
        },
        {
          guidPath: { guids: [containerSlot, textSlot] },
          size: { x: 36, y: 36 },
          derivedTextData: {
            layoutSize: { x: 36, y: 36 },
            glyphs: [
              {
                commandsBlob: 0,
                position: { x: 6, y: 24 },
                fontSize: 17,
                firstCharacter: 0,
                advance: 1,
                rotation: 0,
              },
            ],
            fontMetaData: [
              {
                key: { family: "SF Pro", style: "Medium", postscript: "" },
                fontLineHeight: 1.2,
                fontWeight: 510,
              },
            ],
          },
        },
      ],
    });
    const document = indexFigKiwiDocument([instance]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const text = resolved.children[0]!.children![0]!;

    expect(text.type.name).toBe("TEXT");
    expect(text.fillPaints).toEqual([solidPaint(0, 0, 0)]);
    expect(text.derivedTextData?.glyphs).toHaveLength(1);
  });

  it("keeps document-external derived positions instead of replaying INSTANCE stack layout", () => {
    const rootSlot = { sessionID: 99, localID: 100 };
    const iconSlot = { sessionID: 99, localID: 101 };
    const textSlot = { sessionID: 99, localID: 102 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External button",
      guid: { sessionID: 1, localID: 3 },
      size: { x: 48, y: 48 },
      stackMode: { value: 1, name: "HORIZONTAL" },
      stackSpacing: 12,
      stackPrimaryAlignItems: { value: 1, name: "CENTER" },
      stackCounterAlignItems: { value: 1, name: "CENTER" },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
        symbolOverrides: [
          {
            guidPath: { guids: [rootSlot] },
            name: "External button",
            size: { x: 48, y: 48 },
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [rootSlot] },
          size: { x: 48, y: 48 },
        },
        {
          guidPath: { guids: [iconSlot] },
          size: { x: 48, y: 48 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillGeometry: [{ commandsBlob: 1, styleID: 0 }],
          fillPaints: [solidPaint(0, 0, 0)],
        },
        {
          guidPath: { guids: [textSlot] },
          size: { x: 36, y: 36 },
          transform: { m00: 1, m01: 0, m02: 6, m10: 0, m11: 1, m12: 6 },
          derivedTextData: {
            layoutSize: { x: 36, y: 36 },
            glyphs: [
              {
                commandsBlob: 0,
                position: { x: 6, y: 24 },
                fontSize: 17,
                firstCharacter: 0,
                advance: 1,
                rotation: 0,
              },
            ],
            fontMetaData: [
              {
                key: { family: "SF Pro", style: "Medium", postscript: "" },
                fontLineHeight: 1.2,
                fontWeight: 510,
              },
            ],
          },
        },
      ],
    });
    const document = indexFigKiwiDocument([instance]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const layoutResolved = resolveAutoLayoutFrame(resolved.node, resolved.children);

    expect(resolved.node.stackMode).toBeUndefined();
    expect(resolved.children.map((child) => child.guid)).toEqual([iconSlot, textSlot]);
    expect(layoutResolved.children[0]!.transform?.m02).toBe(0);
    expect(layoutResolved.children[1]!.transform?.m02).toBe(6);
  });

  it("materializes document-external geometry without inventing paint when Kiwi carries none", () => {
    const iconSlot = { sessionID: 99, localID: 101 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External icon without paint",
      guid: { sessionID: 1, localID: 4 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [iconSlot] },
          size: { x: 48, y: 48 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillGeometry: [{ commandsBlob: 1, styleID: 0 }],
        },
      ],
    });
    const document = indexFigKiwiDocument([instance]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);

    expect(resolved.children).toHaveLength(1);
    expect(resolved.children[0]!.fillGeometry).toEqual([{ commandsBlob: 1, styleID: 0 }]);
    expect(resolved.children[0]!.fillPaints).toBeUndefined();
    expect(resolved.children[0]!.styleIdForFill).toBeUndefined();
  });

  it("uses the selected local SYMBOL root as the visual source for a document-external instance-swap slot", () => {
    const externalScreenSlot = { sessionID: 99, localID: 201 };
    const selectedScreenSymbolGuid = { sessionID: 1, localID: 201 };
    const selectedScreenChildGuid = { sessionID: 1, localID: 202 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External device",
      guid: { sessionID: 1, localID: 200 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
      },
      componentPropAssignments: [
        {
          defID: { sessionID: 99, localID: 1 },
          value: { guidValue: selectedScreenSymbolGuid },
        },
      ],
      derivedSymbolData: [
        {
          guidPath: { guids: [externalScreenSlot, selectedScreenChildGuid] },
          fillGeometry: [{ commandsBlob: 1, styleID: 0 }],
        },
      ],
    });
    const selectedScreen = createTestNode({
      type: "SYMBOL",
      name: "Selected screen",
      guid: selectedScreenSymbolGuid,
      size: { x: 402, y: 874 },
      fillPaints: [solidPaint(1, 0, 0)],
    });
    const selectedScreenChild = createTestNode({
      type: "VECTOR",
      name: "Selected screen child",
      guid: selectedScreenChildGuid,
      parentIndex: { guid: selectedScreenSymbolGuid, position: "a" },
    });
    const document = indexFigKiwiDocument([instance, selectedScreen, selectedScreenChild]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const screen = resolved.children[0]!;
    const child = screen.children![0]!;

    expect(screen.guid).toEqual(externalScreenSlot);
    expect(screen.type.name).toBe("FRAME");
    expect(screen.size).toEqual({ x: 402, y: 874 });
    expect(screen.fillPaints).toEqual([solidPaint(1, 0, 0)]);
    expect(child.guid).toEqual(selectedScreenChildGuid);
    expect(child.fillGeometry).toEqual([{ commandsBlob: 1, styleID: 0 }]);
    expect(child.fillPaints).toBeUndefined();
  });

  it("rejects a selected local SYMBOL when document-external derivedSymbolData does not identify its slot", () => {
    const externalOtherSlot = { sessionID: 99, localID: 211 };
    const selectedScreenSymbolGuid = { sessionID: 1, localID: 211 };
    const selectedScreenChildGuid = { sessionID: 1, localID: 212 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External device with stale swap",
      guid: { sessionID: 1, localID: 210 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 210 },
      },
      componentPropAssignments: [
        {
          defID: { sessionID: 99, localID: 1 },
          value: { guidValue: selectedScreenSymbolGuid },
        },
      ],
      derivedSymbolData: [
        {
          guidPath: { guids: [externalOtherSlot] },
          size: { x: 402, y: 874 },
        },
      ],
    });
    const selectedScreen = createTestNode({
      type: "SYMBOL",
      name: "Selected screen",
      guid: selectedScreenSymbolGuid,
    });
    const selectedScreenChild = createTestNode({
      type: "VECTOR",
      name: "Selected screen child",
      guid: selectedScreenChildGuid,
      parentIndex: { guid: selectedScreenSymbolGuid, position: "a" },
    });
    const document = indexFigKiwiDocument([instance, selectedScreen, selectedScreenChild]);
    const resolver = createSymbolResolver({ document });

    expect(() => resolver.resolveInstance(instance)).toThrow(/selects local SYMBOL 1:211 but derivedSymbolData carries no matching external slot/);
  });

  it("uses the matching local Kiwi node as the visual source for a document-external slot", () => {
    const iconSlot = { sessionID: 99, localID: 101 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External icon context",
      guid: { sessionID: 1, localID: 5 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [iconSlot] },
          size: { x: 48, y: 48 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillGeometry: [{ commandsBlob: 1, styleID: 0 }],
        },
      ],
    });
    const localIcon = createTestNode({
      type: "VECTOR",
      name: "Local icon style",
      guid: iconSlot,
      fillPaints: [solidPaint(1, 0, 0)],
    });
    const document = indexFigKiwiDocument([instance, localIcon]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);

    expect(resolved.children[0]!.name).toBe("Local icon style");
    expect(resolved.children[0]!.fillPaints).toEqual([solidPaint(1, 0, 0)]);
    expect(resolved.children[0]!.fillGeometry).toEqual([{ commandsBlob: 1, styleID: 0 }]);
  });

  it("threads a local INSTANCE's Kiwi derived data into the document-external slot tree", () => {
    const buttonSlot = { sessionID: 99, localID: 110 };
    const glyphSlot = { sessionID: 99, localID: 111 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External screen",
      guid: { sessionID: 1, localID: 6 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [buttonSlot] },
          size: { x: 48, y: 48 },
        },
      ],
    });
    const localButton = createTestNode({
      type: "INSTANCE",
      name: "Local button",
      guid: buttonSlot,
      fillPaints: [solidPaint(0, 0, 0)],
      derivedSymbolData: [
        {
          guidPath: { guids: [glyphSlot] },
          fillGeometry: [{ commandsBlob: 2, styleID: 0 }],
        },
      ],
      symbolData: {
        symbolID: { sessionID: 99, localID: 300 },
        symbolOverrides: [
          {
            guidPath: { guids: [glyphSlot] },
            fillPaints: [solidPaint(0, 1, 0)],
          },
        ],
      },
    });
    const document = indexFigKiwiDocument([instance, localButton]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const button = resolved.children[0]!;
    const glyph = button.children![0]!;

    expect(button.type.name).toBe("FRAME");
    expect(button.name).toBe("Local button");
    expect(button.fillPaints).toEqual([solidPaint(0, 0, 0)]);
    expect(glyph.guid).toEqual(glyphSlot);
    expect(glyph.fillGeometry).toEqual([{ commandsBlob: 2, styleID: 0 }]);
    expect(glyph.fillPaints).toEqual([solidPaint(0, 1, 0)]);
  });

  it("keeps local document-external child slot order when outer prefixed payloads augment existing children", () => {
    const statusSlot = { sessionID: 99, localID: 120 };
    const timeSlot = { sessionID: 99, localID: 121 };
    const wifiSlot = { sessionID: 99, localID: 122 };
    const batterySlot = { sessionID: 99, localID: 123 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External screen",
      guid: { sessionID: 1, localID: 7 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [statusSlot] },
          size: { x: 402, y: 62 },
        },
        {
          guidPath: { guids: [statusSlot, wifiSlot] },
          fillGeometry: [{ commandsBlob: 10, styleID: 0 }],
        },
        {
          guidPath: { guids: [statusSlot, batterySlot] },
          strokeGeometry: [{ commandsBlob: 11, styleID: 0 }],
        },
      ],
    });
    const localStatusBar = createTestNode({
      type: "INSTANCE",
      name: "Status bar - iPhone",
      guid: statusSlot,
      size: { x: 402, y: 62 },
      stackMode: { value: 1, name: "HORIZONTAL" },
      stackSpacing: 154,
      symbolData: {
        symbolID: { sessionID: 99, localID: 300 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [timeSlot] },
          derivedTextData: derivedTextData(37, 22, 4),
        },
        {
          guidPath: { guids: [wifiSlot] },
          fillGeometry: [{ commandsBlob: 12, styleID: 0 }],
        },
        {
          guidPath: { guids: [batterySlot] },
          fillGeometry: [{ commandsBlob: 13, styleID: 0 }],
        },
      ],
    });
    const document = indexFigKiwiDocument([instance, localStatusBar]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const statusBar = resolved.children[0]!;

    expect(childrenOfFixtureNode(statusBar).map((child) => child.guid)).toEqual([timeSlot, wifiSlot, batterySlot]);
    expect(statusBar.children?.[1]?.fillGeometry).toEqual([{ commandsBlob: 10, styleID: 0 }]);
    expect(statusBar.children?.[2]?.fillGeometry).toEqual([{ commandsBlob: 13, styleID: 0 }]);
    expect(statusBar.children?.[2]?.strokeGeometry).toEqual([{ commandsBlob: 11, styleID: 0 }]);
  });

  it("does not replay stack layout from an unresolved local external INSTANCE", () => {
    const statusSlot = { sessionID: 99, localID: 124 };
    const timeSlot = { sessionID: 99, localID: 125 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External screen",
      guid: { sessionID: 1, localID: 8 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [statusSlot] },
          size: { x: 402, y: 62 },
        },
      ],
    });
    const localStatusBar = createTestNode({
      type: "INSTANCE",
      name: "Status bar - iPhone",
      guid: statusSlot,
      size: { x: 402, y: 62 },
      stackMode: { value: 1, name: "HORIZONTAL" },
      stackSpacing: 154,
      stackPrimaryAlignItems: { value: 1, name: "CENTER" },
      stackCounterAlignItems: { value: 1, name: "CENTER" },
      symbolData: {
        symbolID: { sessionID: 99, localID: 300 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [timeSlot] },
          derivedTextData: derivedTextData(37, 22, 4),
        },
      ],
    });
    const document = indexFigKiwiDocument([instance, localStatusBar]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const statusBar = resolved.children[0]!;
    const layoutResolved = resolveAutoLayoutFrame(statusBar, childrenOfFixtureNode(statusBar));

    expect(statusBar.stackMode).toBeUndefined();
    expect(layoutResolved.children[0]!.transform).toBeUndefined();
  });

  it("keeps local document-external INSTANCE container surfaces renderable", () => {
    const containerSlot = { sessionID: 99, localID: 130 };
    const childSlot = { sessionID: 99, localID: 131 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External screen",
      guid: { sessionID: 1, localID: 9 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [containerSlot] },
          fillGeometry: [{ commandsBlob: 4, styleID: 0 }],
        },
        {
          guidPath: { guids: [containerSlot, childSlot] },
          fillGeometry: [{ commandsBlob: 5, styleID: 0 }],
        },
      ],
    });
    const localContainer = createTestNode({
      type: "INSTANCE",
      name: "Local decorated container",
      guid: containerSlot,
      size: { x: 402, y: 388 },
      stackMode: { value: 1, name: "HORIZONTAL" },
      stackHorizontalPadding: 10,
      fillPaints: [solidPaint(1, 1, 1)],
    });
    const document = indexFigKiwiDocument([instance, localContainer]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const container = resolved.children[0]!;

    expect(container.type.name).toBe("FRAME");
    expect(container.name).toBe("Local decorated container");
    expect(container.size).toEqual({ x: 402, y: 388 });
    expect(container.stackMode?.name).toBe("HORIZONTAL");
    expect(container.stackHorizontalPadding).toBe(10);
    expect(container.fillPaints).toEqual([solidPaint(1, 1, 1)]);
    expect(container.fillGeometry).toEqual([{ commandsBlob: 4, styleID: 0 }]);
    expect(container.children![0]!.guid).toEqual(childSlot);
  });

  it("resolves a local document-external INSTANCE through its local SYMBOL tree", () => {
    const containerSlot = { sessionID: 99, localID: 140 };
    const symbolGuid = { sessionID: 99, localID: 141 };
    const wrapperGuid = { sessionID: 99, localID: 142 };
    const leafGuid = { sessionID: 99, localID: 143 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External local instance",
      guid: { sessionID: 1, localID: 10 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
        symbolOverrides: [
          {
            guidPath: { guids: [containerSlot, leafGuid] },
            fillPaints: [solidPaint(1, 0, 0)],
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [containerSlot] },
          fillGeometry: [{ commandsBlob: 6, styleID: 0 }],
        },
        {
          guidPath: { guids: [containerSlot, leafGuid] },
          size: { x: 44, y: 45 },
          transform: { m00: 1, m01: 0, m02: 3, m10: 0, m11: 1, m12: 5 },
        },
      ],
    });
    const localInstance = createTestNode({
      type: "INSTANCE",
      name: "Local instance",
      guid: containerSlot,
      size: { x: 120, y: 80 },
      fillPaints: [solidPaint(1, 1, 1)],
      symbolData: {
        symbolID: symbolGuid,
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [leafGuid] },
          fillGeometry: [{ commandsBlob: 7, styleID: 0 }],
        },
      ],
    });
    const symbol = createTestNode({
      type: "SYMBOL",
      name: "Local symbol",
      guid: symbolGuid,
      size: { x: 120, y: 80 },
    });
    const wrapper = createTestNode({
      type: "FRAME",
      name: "Wrapper",
      guid: wrapperGuid,
      parentIndex: { guid: symbolGuid, position: "!" },
      size: { x: 100, y: 60 },
      transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 8 },
    });
    const leaf = createTestNode({
      type: "VECTOR",
      name: "Leaf",
      guid: leafGuid,
      parentIndex: { guid: wrapperGuid, position: "!" },
      size: { x: 20, y: 20 },
      fillPaints: [solidPaint(0, 0, 1)],
    });
    const document = indexFigKiwiDocument([instance, localInstance, symbol, wrapper, leaf]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const container = resolved.children[0]!;
    const resolvedWrapper = container.children![0]!;
    const resolvedLeaf = resolvedWrapper.children![0]!;

    expect(container.type.name).toBe("FRAME");
    expect(container.fillGeometry).toEqual([{ commandsBlob: 6, styleID: 0 }]);
    expect(resolvedWrapper.guid).toEqual(wrapperGuid);
    expect(resolvedWrapper.transform?.m02).toBe(10);
    expect(resolvedLeaf.guid).toEqual(leafGuid);
    expect(resolvedLeaf.fillGeometry).toEqual([{ commandsBlob: 7, styleID: 0 }]);
    expect(resolvedLeaf.fillPaints).toEqual([solidPaint(1, 0, 0)]);
    expect(resolvedLeaf.size).toEqual({ x: 44, y: 45 });
    expect(resolvedLeaf.transform?.m02).toBe(3);
    expect(resolvedLeaf.transform?.m12).toBe(5);
  });

  it("binds materialized local slot addresses before applying descendant overrides", () => {
    const toolbarSymbolGuid = { sessionID: 10, localID: 1 };
    const localInstanceGuid = { sessionID: 10, localID: 2 };
    const outerSymbolGuid = { sessionID: 10, localID: 3 };
    const outerInstanceGuid = { sessionID: 10, localID: 4 };
    const materializedSearchFieldGuid = { sessionID: 20, localID: 1 };
    const materializedBgGuid = { sessionID: 20, localID: 2 };
    const materializedLeadingGuid = { sessionID: 20, localID: 3 };
    const materializedFieldGuid = { sessionID: 20, localID: 4 };
    const materializedLabelGuid = { sessionID: 20, localID: 5 };
    const materializedTrailingGuid = { sessionID: 20, localID: 6 };
    const oldSearchFieldGuid = { sessionID: 30, localID: 1 };
    const oldBgGuid = { sessionID: 30, localID: 2 };
    const oldLeadingGuid = { sessionID: 30, localID: 3 };
    const oldLabelGuid = { sessionID: 30, localID: 4 };
    const oldTrailingGuid = { sessionID: 30, localID: 5 };
    const externalBgVectorGuid = { sessionID: 40, localID: 1 };
    const toolbarSymbol = createTestNode({
      type: "SYMBOL",
      name: "Search toolbar",
      guid: toolbarSymbolGuid,
      size: { x: 402, y: 112 },
    });
    const searchField = createTestNode({
      type: "FRAME",
      name: "Search Field",
      guid: materializedSearchFieldGuid,
      parentIndex: { guid: toolbarSymbolGuid, position: "a" },
      size: { x: 226, y: 48 },
      stackSpacing: 8,
      stackHorizontalPadding: 14,
      stackPaddingRight: 14,
    });
    const bg = createTestNode({
      type: "INSTANCE",
      name: "BG",
      guid: materializedBgGuid,
      parentIndex: { guid: materializedSearchFieldGuid, position: "a" },
      size: { x: 226, y: 48 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 1 },
        symbolOverrides: [
          {
            guidPath: { guids: [externalBgVectorGuid] },
            fillPaints: [solidPaint(0, 0, 0)],
          },
        ],
      },
    });
    const leading = createTestNode({
      type: "TEXT",
      name: "leading",
      guid: materializedLeadingGuid,
      parentIndex: { guid: materializedSearchFieldGuid, position: "b" },
      size: { x: 20, y: 16 },
      transform: { m00: 1, m01: 0, m02: 14, m10: 0, m11: 1, m12: 16 },
    });
    const field = createTestNode({
      type: "FRAME",
      name: "Field",
      guid: materializedFieldGuid,
      parentIndex: { guid: materializedSearchFieldGuid, position: "c" },
      size: { x: 141, y: 20 },
    });
    const label = createTestNode({
      type: "TEXT",
      name: "Label",
      guid: materializedLabelGuid,
      parentIndex: { guid: materializedFieldGuid, position: "a" },
      size: { x: 73, y: 20 },
      fontSize: 17,
    });
    const trailing = createTestNode({
      type: "TEXT",
      name: "trailing",
      guid: materializedTrailingGuid,
      parentIndex: { guid: materializedSearchFieldGuid, position: "d" },
      size: { x: 21, y: 20 },
      transform: { m00: 1, m01: 0, m02: 191, m10: 0, m11: 1, m12: 14 },
    });
    const localToolbarInstance = createTestNode({
      type: "INSTANCE",
      name: "Search toolbar",
      guid: localInstanceGuid,
      parentIndex: { guid: outerSymbolGuid, position: "a" },
      symbolData: {
        symbolID: toolbarSymbolGuid,
        symbolOverrides: [
          {
            guidPath: { guids: [oldSearchFieldGuid] },
            name: "Search Field",
            stackSpacing: 8,
            stackHorizontalPadding: 14,
            stackPaddingRight: 14,
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [oldSearchFieldGuid, oldLeadingGuid] },
          size: { x: 20, y: 16 },
          transform: { m00: 1, m01: 0, m02: 14, m10: 0, m11: 1, m12: 16 },
          derivedTextData: derivedTextData(20, 16, 1),
        },
        {
          guidPath: { guids: [oldSearchFieldGuid, oldTrailingGuid] },
          size: { x: 21, y: 20 },
          transform: { m00: 1, m01: 0, m02: 191, m10: 0, m11: 1, m12: 14 },
          derivedTextData: derivedTextData(21, 20, 1),
        },
        {
          guidPath: { guids: [oldSearchFieldGuid, oldLabelGuid] },
          size: { x: 47, y: 20 },
          derivedTextData: derivedTextData(47, 20, 4),
        },
      ],
    });
    const outerSymbol = createTestNode({
      type: "SYMBOL",
      name: "Outer",
      guid: outerSymbolGuid,
      size: { x: 402, y: 112 },
    });
    const outerInstance = createTestNode({
      type: "INSTANCE",
      name: "Outer",
      guid: outerInstanceGuid,
      symbolData: {
        symbolID: outerSymbolGuid,
        symbolOverrides: [
          {
            guidPath: { guids: [localInstanceGuid, oldSearchFieldGuid, oldLabelGuid] },
            fontSize: 19,
          },
        ],
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [localInstanceGuid, oldSearchFieldGuid, oldBgGuid, externalBgVectorGuid] },
          fillGeometry: [{ commandsBlob: 123, styleID: 0 }],
        },
        {
          guidPath: { guids: [localInstanceGuid, oldSearchFieldGuid, oldLabelGuid] },
          size: { x: 52, y: 20 },
          derivedTextData: derivedTextData(52, 20, 5),
        },
      ],
    });
    const document = indexFigKiwiDocument([
      toolbarSymbol,
      searchField,
      bg,
      leading,
      field,
      label,
      trailing,
      outerSymbol,
      localToolbarInstance,
      outerInstance,
    ]);
    const resolver = createSymbolResolver({ document });
    const resolvedOuter = resolver.resolveInstance(outerInstance);
    const resolvedToolbar = resolver.resolveInstance(resolvedOuter.children[0]!);
    const resolvedLabel = findResolvedDescendant(resolvedToolbar.children, materializedLabelGuid);
    const resolvedBg = findResolvedDescendant(resolvedToolbar.children, materializedBgGuid);
    const resolvedBgContents = resolver.resolveInstance(resolvedBg!);

    expect(resolvedLabel?.size).toEqual({ x: 52, y: 20 });
    expect(resolvedLabel?.fontSize).toBe(19);
    expect(resolvedLabel?.derivedTextData?.glyphs).toHaveLength(5);
    expect(resolvedBgContents.children[0]!.guid).toEqual(externalBgVectorGuid);
    expect(resolvedBgContents.children[0]!.fillGeometry).toEqual([{ commandsBlob: 123, styleID: 0 }]);
    expect(resolvedBgContents.children[0]!.fillPaints).toEqual([solidPaint(0, 0, 0)]);
  });

  it("renders document-external swapped slots from their materialized Kiwi subtree", () => {
    const containerSlot = { sessionID: 99, localID: 120 };
    const swappedSlot = { sessionID: 99, localID: 121 };
    const leafSlot = { sessionID: 99, localID: 122 };
    const instance = createTestNode({
      type: "INSTANCE",
      name: "External swapped subtree",
      guid: { sessionID: 1, localID: 7 },
      symbolData: {
        symbolID: { sessionID: 99, localID: 200 },
      },
      derivedSymbolData: [
        {
          guidPath: { guids: [containerSlot] },
          size: { x: 48, y: 48 },
        },
      ],
    });
    const localContainer = createTestNode({
      type: "INSTANCE",
      name: "Local container",
      guid: containerSlot,
      derivedSymbolData: [
        {
          guidPath: { guids: [swappedSlot, leafSlot] },
          fillGeometry: [{ commandsBlob: 3, styleID: 0 }],
        },
      ],
      symbolData: {
        symbolID: { sessionID: 99, localID: 300 },
        symbolOverrides: [
          {
            guidPath: { guids: [swappedSlot] },
            overriddenSymbolID: { sessionID: 99, localID: 999 },
          },
        ],
      },
    });
    const document = indexFigKiwiDocument([instance, localContainer]);
    const resolver = createSymbolResolver({ document });
    const resolved = resolver.resolveInstance(instance);
    const swapped = resolved.children[0]!.children![0]!;

    expect(swapped.type.name).toBe("GROUP");
    expect(swapped.children![0]!.guid).toEqual(leafSlot);
    expect(swapped.children![0]!.fillGeometry).toEqual([{ commandsBlob: 3, styleID: 0 }]);
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
