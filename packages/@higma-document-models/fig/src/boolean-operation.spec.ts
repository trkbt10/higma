/** @file Tests for the Figma Kiwi `BooleanOperation` enum bridge. */

import {
  BOOLEAN_OPERATION_VALUES,
  createBooleanOperationEnum,
  resolveBooleanOperationType,
} from "./boolean-operation";

describe("boolean-operation Kiwi enum bridge", () => {
  it("writes the schema name for each path-algebra operation (EXCLUDE → XOR per Kiwi schema)", () => {
    expect(createBooleanOperationEnum("UNION")).toEqual({ value: 0, name: "UNION" });
    expect(createBooleanOperationEnum("INTERSECT")).toEqual({ value: 1, name: "INTERSECT" });
    expect(createBooleanOperationEnum("SUBTRACT")).toEqual({ value: 2, name: "SUBTRACT" });
    // Path-algebra `EXCLUDE` writes the schema name `XOR` (value 3)
    // so the produced .fig matches Figma's own exporter byte-for-byte.
    expect(createBooleanOperationEnum("EXCLUDE")).toEqual({ value: 3, name: "XOR" });
  });

  it("resolves wire-format names back to the path-algebra alias", () => {
    expect(resolveBooleanOperationType({ value: 0, name: "UNION" })).toBe("UNION");
    expect(resolveBooleanOperationType({ value: 1, name: "INTERSECT" })).toBe("INTERSECT");
    expect(resolveBooleanOperationType({ value: 2, name: "SUBTRACT" })).toBe("SUBTRACT");
    // Schema name XOR resolves back to path-algebra EXCLUDE.
    expect(resolveBooleanOperationType({ value: 3, name: "XOR" })).toBe("EXCLUDE");
    // Legacy fig files written by an earlier revision of this project
    // (which wrote `EXCLUDE` instead of `XOR`) also round-trip via the
    // numeric value 3.
    expect(resolveBooleanOperationType({ value: 3, name: "EXCLUDE" })).toBe("EXCLUDE");
    // Falls back to the name when the value is unknown.
    expect(resolveBooleanOperationType({ value: 99, name: "SUBTRACT" })).toBe("SUBTRACT");
  });

  it("defaults to UNION when the enum payload is absent", () => {
    expect(resolveBooleanOperationType(undefined)).toBe("UNION");
  });

  it("exposes the schema-bound value table keyed by wire-format names", () => {
    expect(BOOLEAN_OPERATION_VALUES.UNION).toBe(0);
    expect(BOOLEAN_OPERATION_VALUES.INTERSECT).toBe(1);
    expect(BOOLEAN_OPERATION_VALUES.SUBTRACT).toBe(2);
    expect(BOOLEAN_OPERATION_VALUES.XOR).toBe(3);
  });
});
