/** @file Tests for Kiwi component property definition inheritance. */

import type { FigGuid, FigNode, FigNodeType } from "../types";
import { indexFigKiwiDocument } from "./kiwi-document-index";
import { resolveFigComponentPropDef } from "./component-property-definition";

function guid(localID: number, sessionID = 1): FigGuid {
  return { sessionID, localID };
}

function node(
  type: FigNodeType,
  nodeGuid: FigGuid,
  overrides: Omit<Partial<FigNode>, "guid" | "phase" | "type"> = {},
): FigNode {
  return {
    guid: nodeGuid,
    phase: { value: 0, name: "PAINT" },
    type: { value: 0, name: type },
    ...overrides,
  };
}

describe("resolveFigComponentPropDef", () => {
  it("uses direct Kiwi component property definition fields", () => {
    const owner = node("SYMBOL", guid(1), {
      componentPropDefs: [{
        id: guid(2),
        name: "Label",
        type: { value: 1, name: "TEXT" },
        initialValue: { textValue: { characters: "Buy" } },
      }],
    });
    const document = indexFigKiwiDocument([owner]);
    const def = owner.componentPropDefs?.[0];
    if (def === undefined) {
      throw new Error("test fixture is missing componentPropDefs[0]");
    }

    const resolved = resolveFigComponentPropDef({ ownerNode: owner, def, document });

    expect(resolved.id).toEqual(guid(2));
    expect(resolved.name).toBe("Label");
    expect(resolved.type).toBe("TEXT");
    expect(resolved.initialValue).toEqual({ textValue: { characters: "Buy" } });
  });

  it("inherits missing fields from the ancestor parentPropDefId definition", () => {
    const parentFrame = node("FRAME", guid(10), {
      componentPropDefs: [{
        id: guid(20),
        name: "Time",
        type: { value: 1, name: "TEXT" },
        initialValue: { textValue: { characters: "9:41" } },
      }],
    });
    const symbol = node("SYMBOL", guid(11), {
      parentIndex: { guid: parentFrame.guid, position: "!" },
      componentPropDefs: [{
        id: guid(21),
        parentPropDefId: guid(20),
      }],
    });
    const document = indexFigKiwiDocument([parentFrame, symbol]);
    const def = symbol.componentPropDefs?.[0];
    if (def === undefined) {
      throw new Error("test fixture is missing componentPropDefs[0]");
    }

    const resolved = resolveFigComponentPropDef({ ownerNode: symbol, def, document });

    expect(resolved.id).toEqual(guid(21));
    expect(resolved.name).toBe("Time");
    expect(resolved.type).toBe("TEXT");
    expect(resolved.initialValue).toEqual({ textValue: { characters: "9:41" } });
  });

  it("uses the owning ancestor instead of duplicate definition ids elsewhere", () => {
    const darkFrame = node("FRAME", guid(10), {
      componentPropDefs: [{
        id: guid(20),
        name: "Mode",
        type: { value: 1, name: "TEXT" },
        initialValue: { textValue: { characters: "Dark" } },
      }],
    });
    const lightFrame = node("FRAME", guid(30), {
      componentPropDefs: [{
        id: guid(20),
        name: "Mode",
        type: { value: 1, name: "TEXT" },
        initialValue: { textValue: { characters: "Light" } },
      }],
    });
    const darkSymbol = node("SYMBOL", guid(11), {
      parentIndex: { guid: darkFrame.guid, position: "!" },
      componentPropDefs: [{
        id: guid(21),
        parentPropDefId: guid(20),
      }],
    });
    const document = indexFigKiwiDocument([darkFrame, lightFrame, darkSymbol]);
    const def = darkSymbol.componentPropDefs?.[0];
    if (def === undefined) {
      throw new Error("test fixture is missing componentPropDefs[0]");
    }

    const resolved = resolveFigComponentPropDef({ ownerNode: darkSymbol, def, document });

    expect(resolved.initialValue).toEqual({ textValue: { characters: "Dark" } });
  });

  it("throws when parentPropDefId is not present on an ancestor", () => {
    const frame = node("FRAME", guid(10), {
      componentPropDefs: [{
        id: guid(20),
        name: "Detached",
        type: { value: 1, name: "TEXT" },
      }],
    });
    const symbol = node("SYMBOL", guid(11), {
      componentPropDefs: [{
        id: guid(21),
        parentPropDefId: guid(20),
      }],
    });
    const document = indexFigKiwiDocument([frame, symbol]);
    const def = symbol.componentPropDefs?.[0];
    if (def === undefined) {
      throw new Error("test fixture is missing componentPropDefs[0]");
    }

    expect(() => resolveFigComponentPropDef({ ownerNode: symbol, def, document })).toThrow(
      "Component property definition 1:21 references missing ancestor parent 1:20",
    );
  });
});
