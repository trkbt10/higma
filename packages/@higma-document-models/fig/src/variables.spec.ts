/** @file Kiwi variable value projection tests. */

import {
  projectVariableAnyValue,
  requireVariableColor,
  requireVariableFloat,
  resolveConcreteVariableColor,
  variableIdKey,
} from "./variables";

describe("projectVariableAnyValue", () => {
  it("projects concrete Kiwi variable values", () => {
    expect(projectVariableAnyValue({ boolValue: true })).toEqual({ kind: "bool", value: true });
    expect(projectVariableAnyValue({ textValue: "Compact" })).toEqual({ kind: "text", value: "Compact" });
    expect(projectVariableAnyValue({ floatValue: 4 })).toEqual({ kind: "float", value: 4 });
    expect(projectVariableAnyValue({ colorValue: { r: 0, g: 0, b: 0, a: 1 } }))
      .toEqual({ kind: "color", value: { r: 0, g: 0, b: 0, a: 1 } });
  });
});

describe("variableIdKey", () => {
  it("keeps local GUID and assetRef variable namespaces disjoint", () => {
    expect(variableIdKey({ sessionID: 1, localID: 2 })).toBe("guid:1:2");
    expect(variableIdKey({ guid: { sessionID: 3, localID: 4 } })).toBe("guid:3:4");
    expect(variableIdKey({ assetRef: { key: "external" } })).toBe("assetRef:external");
    expect(variableIdKey({ assetRef: { key: "external", version: "10:1" } })).toBe("assetRef:external@10:1");
  });
});

describe("requireVariableColor", () => {
  it("requires a concrete color value", () => {
    expect(requireVariableColor({
      value: { colorValue: { r: 1, g: 0, b: 0, a: 1 } },
    }, "paint")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("rejects aliases because the concrete value is not in the variableData payload", () => {
    expect(() => requireVariableColor({
      value: {
        alias: {
          assetRef: { key: "external" },
        },
      },
    }, "paint")).toThrow("paint requires a concrete COLOR variable value, got alias assetRef:external");
  });
});

describe("resolveConcreteVariableColor", () => {
  it("returns undefined for aliases so callers can use their embedded resolved Kiwi value", () => {
    expect(resolveConcreteVariableColor({
      value: {
        alias: {
          assetRef: { key: "external" },
        },
      },
    }, "paint")).toBeUndefined();
  });
});

describe("requireVariableFloat", () => {
  it("requires a concrete float value", () => {
    expect(requireVariableFloat({ value: { floatValue: 6 } }, "radius")).toBe(6);
  });
});
