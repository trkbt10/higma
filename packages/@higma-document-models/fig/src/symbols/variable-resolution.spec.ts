/**
 * @file Tests for the RESOLVE_VARIANT evaluator and the
 * `FigVariableAnyValue` projection.
 *
 * The fixtures here are minimal hand-built Kiwi document indexes — they don't
 * exercise the full Kiwi parser pipeline because the evaluator's
 * correctness depends on the *projected* shape, not the
 * presence-by-field details of the Kiwi message. The
 * `projectVariableAnyValue` test does cover the projection itself.
 */

import {
  projectVariableAnyValue,
  findVariableConsumptionExpression,
  resolveVariantOverride,
} from "./variable-resolution";
import type {
  FigGuid,
  FigKiwiVariableAnyValue,
  FigKiwiVariableData,
  FigKiwiVariableDataMap,
  FigNode,
} from "../types";
import { FIG_NODE_TYPE } from "../types";
import { indexFigKiwiDocument, type FigKiwiDocumentIndex } from "../domain";

function guid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function symbolNode(g: FigGuid, name: string, parent?: FigGuid): FigNode {
  return {
    guid: g,
    phase: { value: 0, name: "INITIAL" },
    type: { value: 0, name: FIG_NODE_TYPE.SYMBOL },
    name,
    parentIndex: parent ? { guid: parent, position: "0" } : undefined,
    children: [],
  };
}

function frameNode(g: FigGuid, name: string, children: readonly FigNode[]): FigNode {
  return {
    guid: g,
    phase: { value: 0, name: "INITIAL" },
    type: { value: 0, name: FIG_NODE_TYPE.FRAME },
    name,
    children,
  };
}

/**
 * A Variant-Set FRAME on disk. The canonical schema has no
 * COMPONENT_SET NodeType — a Variant Set is a FRAME with
 * `isStateGroup` + VARIANT-typed `componentPropDefs`. See
 * `docs/refactor/component-type-cleanup.md`.
 *
 * `propName` becomes the variant property name; each child SYMBOL must
 * carry a matching `variantPropSpec` for the SoT-aligned resolver to
 * see it as a Variant Set member.
 */
function variantSetFrame(
  g: FigGuid,
  name: string,
  propName: string,
  propDefId: FigGuid,
  children: readonly FigNode[],
): FigNode {
  return {
    guid: g,
    phase: { value: 0, name: "INITIAL" },
    type: { value: 0, name: FIG_NODE_TYPE.FRAME },
    name,
    isStateGroup: true,
    componentPropDefs: [
      {
        id: propDefId,
        name: propName,
        type: { value: 4, name: "VARIANT" },
      },
    ],
    children,
  };
}

function variantSymbol(
  g: FigGuid,
  name: string,
  parent: FigGuid,
  propDefId: FigGuid,
  value: string,
): FigNode {
  return {
    guid: g,
    phase: { value: 0, name: "INITIAL" },
    type: { value: 0, name: FIG_NODE_TYPE.SYMBOL },
    name,
    parentIndex: { guid: parent, position: "0" },
    variantPropSpecs: [{ propDefId, value }],
    children: [],
  };
}

function instanceNode(g: FigGuid, symbolID: FigGuid, vcm: FigKiwiVariableDataMap): FigNode {
  return {
    guid: g,
    phase: { value: 0, name: "INITIAL" },
    type: { value: 0, name: FIG_NODE_TYPE.INSTANCE },
    symbolData: { symbolID },
    variableConsumptionMap: vcm,
  };
}

function buildVariantContext(nodes: readonly FigNode[]): {
  readonly document: FigKiwiDocumentIndex;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
} {
  for (const n of nodes) {
    if (n.guid === undefined) {
      throw new Error("buildVariantContext requires every node to carry guid");
    }
  }
  const document = indexFigKiwiDocument(nodes);
  return {
    document,
    childrenOf: document.childrenOf,
  };
}

describe("projectVariableAnyValue", () => {
  it("projects bool / text / float values to their kind", () => {
    expect(projectVariableAnyValue({ boolValue: true })).toEqual({ kind: "bool", value: true });
    expect(projectVariableAnyValue({ textValue: "Bright" })).toEqual({ kind: "text", value: "Bright" });
    expect(projectVariableAnyValue({ floatValue: 1.5 })).toEqual({ kind: "float", value: 1.5 });
  });

  it("projects expression values verbatim", () => {
    const raw: FigKiwiVariableAnyValue = {
      expressionValue: {
        expressionFunction: { value: 2, name: "RESOLVE_VARIANT" },
        expressionArguments: [],
      },
    };
    const projected = projectVariableAnyValue(raw);
    expect(projected?.kind).toBe("expression");
    if (projected?.kind === "expression") {
      expect(projected.value.expressionFunction.name).toBe("RESOLVE_VARIANT");
    }
  });

  it("projects map values verbatim", () => {
    const raw: FigKiwiVariableAnyValue = {
      mapValue: { values: [{ key: "BG Context", value: { value: { textValue: "Bright" } } }] },
    };
    const projected = projectVariableAnyValue(raw);
    expect(projected?.kind).toBe("map");
    if (projected?.kind === "map") {
      expect(projected.value.values?.length).toBe(1);
    }
  });

  it("returns undefined for empty input", () => {
    expect(projectVariableAnyValue(undefined)).toBeUndefined();
    expect(projectVariableAnyValue({})).toBeUndefined();
  });
});

describe("findVariableConsumptionExpression", () => {
  it("returns the first expression-kind entry", () => {
    const vcm: FigKiwiVariableDataMap = {
      entries: [
        { variableData: { value: { textValue: "literal" } } },
        {
          variableData: {
            value: {
              expressionValue: {
                expressionFunction: { value: 2, name: "RESOLVE_VARIANT" },
                expressionArguments: [],
              },
            },
          },
        },
      ],
    };
    const found = findVariableConsumptionExpression(vcm);
    expect(found?.expression.expressionFunction.name).toBe("RESOLVE_VARIANT");
  });

  it("returns undefined when no expression entry exists", () => {
    expect(findVariableConsumptionExpression({ entries: [] })).toBeUndefined();
    expect(findVariableConsumptionExpression(undefined)).toBeUndefined();
  });
});

describe("resolveVariantOverride", () => {
  function makeVcmFromTextLiteral(propName: string, value: string): FigKiwiVariableDataMap {
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
                            value: { value: { textValue: value } },
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

  it("selects the variant whose variantPropSpec value matches the requested property literal", () => {
    // Two variant siblings under a Variant-Set FRAME. Detection is by
    // SoT metadata (`isStateGroup` + VARIANT `componentPropDefs` +
    // child `variantPropSpecs`), not by child name. See
    // `docs/refactor/component-type-cleanup.md`.
    const propDefId = guid(1, 10);
    const defaultSym = variantSymbol(guid(1, 100), "Type=Default", guid(1, 1), propDefId, "Default");
    const compactSym = variantSymbol(guid(1, 101), "Type=Compact", guid(1, 1), propDefId, "Compact");
    const container = variantSetFrame(guid(1, 1), "_Variants", "Type", propDefId, [defaultSym, compactSym]);
    const inst = instanceNode(guid(1, 200), guid(1, 100), makeVcmFromTextLiteral("Type", "Compact"));
    const variantContext = buildVariantContext([container, defaultSym, compactSym]);

    const out = resolveVariantOverride(inst, defaultSym, variantContext);
    expect(out.resolvedSymbolID).toEqual(guid(1, 101));
  });

  it("returns the original (default) variant when the literal matches it", () => {
    const propDefId = guid(1, 10);
    const defaultSym = variantSymbol(guid(1, 100), "Type=Default", guid(1, 1), propDefId, "Default");
    const compactSym = variantSymbol(guid(1, 101), "Type=Compact", guid(1, 1), propDefId, "Compact");
    const container = variantSetFrame(guid(1, 1), "_Variants", "Type", propDefId, [defaultSym, compactSym]);
    const inst = instanceNode(guid(1, 200), guid(1, 100), makeVcmFromTextLiteral("Type", "Default"));
    const variantContext = buildVariantContext([container, defaultSym, compactSym]);

    const out = resolveVariantOverride(inst, defaultSym, variantContext);
    expect(out.resolvedSymbolID).toEqual(guid(1, 100));
  });

  it("bails out with `unresolved-aliases` when the property value is a library alias", () => {
    const propDefId = guid(1, 10);
    const defaultSym = variantSymbol(guid(1, 100), "Type=Default", guid(1, 1), propDefId, "Default");
    const compactSym = variantSymbol(guid(1, 101), "Type=Compact", guid(1, 1), propDefId, "Compact");
    const container = variantSetFrame(guid(1, 1), "_Variants", "Type", propDefId, [defaultSym, compactSym]);
    const aliasVcm: FigKiwiVariableDataMap = {
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
                            key: "Type",
                            value: {
                              value: { alias: { assetRef: { key: "lib-key", version: "1" } } },
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
    const inst = instanceNode(guid(1, 200), guid(1, 100), aliasVcm);
    const variantContext = buildVariantContext([container, defaultSym, compactSym]);

    const out = resolveVariantOverride(inst, defaultSym, variantContext);
    expect(out.resolvedSymbolID).toBeUndefined();
    expect(out.bailReason).toBe("unresolved-aliases");
  });

  it("bails out with `no-variant-container` when the SYMBOL has no variant siblings", () => {
    // Standalone SYMBOL — parent is just a generic FRAME with one child.
    const sym = symbolNode(guid(1, 100), "Solo", guid(1, 1));
    const parent = frameNode(guid(1, 1), "Misc", [sym]);
    const inst = instanceNode(guid(1, 200), guid(1, 100), makeVcmFromTextLiteral("Type", "Compact"));
    const variantContext = buildVariantContext([parent, sym]);

    const out = resolveVariantOverride(inst, sym, variantContext);
    expect(out.resolvedSymbolID).toBeUndefined();
    expect(out.bailReason).toBe("no-variant-container");
  });

  it("bails out with `no-vcm-expression` when the INSTANCE has no expression VCM", () => {
    const sym = symbolNode(guid(1, 100), "Type=Default", guid(1, 1));
    const inst: FigNode = {
      guid: guid(1, 200),
      phase: { value: 0, name: "INITIAL" },
      type: { value: 0, name: FIG_NODE_TYPE.INSTANCE },
      symbolData: { symbolID: guid(1, 100) },
    };
    const variantContext = buildVariantContext([sym]);

    const out = resolveVariantOverride(inst, sym, variantContext);
    expect(out.bailReason).toBe("no-vcm-expression");
  });
});
