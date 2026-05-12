/** @file Tests for the Figma Kiwi `BooleanOperation` enum bridge. */

import {
  BOOLEAN_OPERATION_VALUES,
  createBooleanOperationEnum,
  resolveBooleanOperationType,
} from "./boolean-operation";

describe("boolean-operation Kiwi enum bridge", () => {
  it("creates Figma boolean operation Kiwi enum values from the literal type", () => {
    expect(createBooleanOperationEnum("INTERSECT")).toEqual({ value: 2, name: "INTERSECT" });
    expect(createBooleanOperationEnum("UNION")).toEqual({ value: 0, name: "UNION" });
  });

  it("prefers the numeric value but falls back to the name when value is unknown", () => {
    expect(resolveBooleanOperationType({ value: 3, name: "EXCLUDE" })).toBe("EXCLUDE");
    expect(resolveBooleanOperationType({ value: 99, name: "SUBTRACT" })).toBe("SUBTRACT");
  });

  it("defaults to UNION when the enum payload is absent", () => {
    expect(resolveBooleanOperationType(undefined)).toBe("UNION");
  });

  it("exposes the canonical value table", () => {
    expect(BOOLEAN_OPERATION_VALUES.UNION).toBe(0);
    expect(BOOLEAN_OPERATION_VALUES.SUBTRACT).toBe(1);
    expect(BOOLEAN_OPERATION_VALUES.INTERSECT).toBe(2);
    expect(BOOLEAN_OPERATION_VALUES.EXCLUDE).toBe(3);
  });
});
