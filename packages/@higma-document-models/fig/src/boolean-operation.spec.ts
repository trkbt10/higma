/** @file Tests for the Figma Kiwi `BooleanOperation` enum bridge. */

import {
  BOOLEAN_OPERATION_VALUES,
  createBooleanOperationEnum,
  resolveBooleanOperationType,
} from "./boolean-operation";

describe("boolean-operation Kiwi enum bridge", () => {
  it("creates Figma boolean operation Kiwi enum values from the literal type", () => {
    expect(createBooleanOperationEnum("INTERSECT")).toEqual({ value: 1, name: "INTERSECT" });
    expect(createBooleanOperationEnum("SUBTRACT")).toEqual({ value: 2, name: "SUBTRACT" });
    expect(createBooleanOperationEnum("UNION")).toEqual({ value: 0, name: "UNION" });
    expect(createBooleanOperationEnum("EXCLUDE")).toEqual({ value: 3, name: "EXCLUDE" });
  });

  it("prefers the numeric value but falls back to the name when value is unknown", () => {
    expect(resolveBooleanOperationType({ value: 3, name: "EXCLUDE" })).toBe("EXCLUDE");
    expect(resolveBooleanOperationType({ value: 99, name: "SUBTRACT" })).toBe("SUBTRACT");
  });

  it("resolves the canonical Figma value pairings (anchor: composite/decoration-combo fixtures)", () => {
    // These pairings come from the .fig binary itself — Figma encodes
    // INTERSECT as value 1 and SUBTRACT as value 2 (verified by the
    // composite-* fixtures' booleanOperation field). The fixture
    // generators in `@higma-document-renderers/fig/scripts/generate-*-fixtures.ts`
    // also use this canonical pairing.
    expect(resolveBooleanOperationType({ value: 0, name: "UNION" })).toBe("UNION");
    expect(resolveBooleanOperationType({ value: 1, name: "INTERSECT" })).toBe("INTERSECT");
    expect(resolveBooleanOperationType({ value: 2, name: "SUBTRACT" })).toBe("SUBTRACT");
    expect(resolveBooleanOperationType({ value: 3, name: "EXCLUDE" })).toBe("EXCLUDE");
  });

  it("defaults to UNION when the enum payload is absent", () => {
    expect(resolveBooleanOperationType(undefined)).toBe("UNION");
  });

  it("exposes the canonical value table", () => {
    expect(BOOLEAN_OPERATION_VALUES.UNION).toBe(0);
    expect(BOOLEAN_OPERATION_VALUES.INTERSECT).toBe(1);
    expect(BOOLEAN_OPERATION_VALUES.SUBTRACT).toBe(2);
    expect(BOOLEAN_OPERATION_VALUES.EXCLUDE).toBe(3);
  });
});
