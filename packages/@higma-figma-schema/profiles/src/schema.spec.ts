/**
 * @file Contract tests for the Kiwi schema SoT helpers.
 *
 * The whole monorepo's enum tables are derived through these
 * helpers, so any silent change in their behaviour can corrupt
 * `.fig` payloads. The tests below pin every observable behaviour
 * of `getFigEnumTable`, `requireFigEnumTable`, and
 * `reverseFigEnumTable` against the bundled schema.
 */

import {
  FIGMA_KIWI_SCHEMA,
  getFigEnumTable,
  requireFigEnumTable,
  reverseFigEnumTable,
} from "./schema";

describe("FIGMA_KIWI_SCHEMA", () => {
  it("contains the canonical Figma definitions", () => {
    const names = new Set(FIGMA_KIWI_SCHEMA.definitions.map((d) => d.name));
    // Spot-check the names every encoder/decoder relies on.
    for (const required of ["Message", "NodeChange", "NodeType", "Paint", "PaintType", "EffectType", "Blob", "VectorData"]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("has more than 500 definitions (real Figma exports cover this many)", () => {
    expect(FIGMA_KIWI_SCHEMA.definitions.length).toBeGreaterThan(500);
  });
});

describe("getFigEnumTable", () => {
  it("returns the schema-canonical name → value map for ImageScaleMode", () => {
    expect(getFigEnumTable("ImageScaleMode")).toEqual({
      STRETCH: 0,
      FIT: 1,
      FILL: 2,
      TILE: 3,
    });
  });

  it("returns the same frozen object on repeated calls (cached)", () => {
    const a = getFigEnumTable("BlendMode");
    const b = getFigEnumTable("BlendMode");
    expect(a).toBe(b);
    expect(Object.isFrozen(a as object)).toBe(true);
  });

  it("returns undefined for an unknown definition", () => {
    expect(getFigEnumTable("NotARealEnum")).toBeUndefined();
  });

  it("returns undefined for a non-ENUM definition (struct / message)", () => {
    // `Color` is a STRUCT, not an ENUM.
    expect(getFigEnumTable("Color")).toBeUndefined();
  });
});

describe("requireFigEnumTable", () => {
  it("returns a table containing every requested name", () => {
    const table = requireFigEnumTable("StrokeAlign", ["INSIDE", "OUTSIDE", "CENTER"]);
    expect(table.INSIDE).toBe(1);
    expect(table.OUTSIDE).toBe(2);
    expect(table.CENTER).toBe(0);
  });

  it("throws when the schema has no such ENUM", () => {
    expect(() => requireFigEnumTable("NotARealEnum", ["X"])).toThrow(
      /missing ENUM definition "NotARealEnum"/,
    );
  });

  it("throws when a required name is absent from the ENUM", () => {
    expect(() => requireFigEnumTable("ImageScaleMode", ["STRETCH", "CROP"])).toThrow(
      /missing required names: CROP/,
    );
  });

  it("rejects only the missing names (one error message lists every gap)", () => {
    expect(() => requireFigEnumTable("ImageScaleMode", ["STRETCH", "CROP", "GHOST"])).toThrow(
      /CROP, GHOST/,
    );
  });
});

describe("reverseFigEnumTable", () => {
  it("returns value → name lookup for known ENUMs", () => {
    const table = reverseFigEnumTable("ImageScaleMode");
    expect(table).toEqual({ 0: "STRETCH", 1: "FIT", 2: "FILL", 3: "TILE" });
  });

  it("returns undefined for unknown ENUM", () => {
    expect(reverseFigEnumTable("NotARealEnum")).toBeUndefined();
  });
});
