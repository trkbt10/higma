/**
 * @file Unit tests for palette helpers.
 */
import { colorHex, colorKey } from "./palette";

describe("palette helpers", () => {
  it("colorKey buckets near-identical SOLID colours together", () => {
    expect(colorKey({ r: 0.1, g: 0.2, b: 0.3, a: 1 })).toBe(colorKey({ r: 0.1004, g: 0.2003, b: 0.3001, a: 1 }));
  });

  it("colorHex omits alpha when fully opaque and includes when not", () => {
    expect(colorHex({ r: 1, g: 0, b: 0, a: 1 })).toBe("#ff0000");
    expect(colorHex({ r: 1, g: 0, b: 0, a: 0.5 })).toBe("#ff000080");
  });
});
