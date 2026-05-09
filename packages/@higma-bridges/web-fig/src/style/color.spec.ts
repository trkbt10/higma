/**
 * @file Round-trip tests for the CSS color codec.
 */
import { colorIRToCss, cssToColorIR } from "./color";

describe("colorIRToCss / cssToColorIR", () => {
  it("round-trips solid rgb", () => {
    const css = colorIRToCss({ r: 1, g: 0, b: 0.5, a: 1 });
    expect(css).toBe("rgb(255, 0, 128)");
    const back = cssToColorIR(css);
    expect(back.r).toBeCloseTo(1, 5);
    expect(back.g).toBeCloseTo(0, 5);
    expect(back.b).toBeCloseTo(128 / 255, 5);
    expect(back.a).toBe(1);
  });

  it("round-trips alpha", () => {
    const css = colorIRToCss({ r: 0, g: 0, b: 0, a: 0.25 });
    expect(css).toBe("rgba(0, 0, 0, 0.25)");
    const back = cssToColorIR(css);
    expect(back.a).toBe(0.25);
  });

  it("parses six-digit hex", () => {
    const ir = cssToColorIR("#3366ff");
    expect(ir.r).toBeCloseTo(51 / 255, 5);
    expect(ir.g).toBeCloseTo(102 / 255, 5);
    expect(ir.b).toBeCloseTo(1, 5);
    expect(ir.a).toBe(1);
  });

  it("parses three-digit hex shorthand", () => {
    const ir = cssToColorIR("#fff");
    expect(ir.r).toBe(1);
    expect(ir.g).toBe(1);
    expect(ir.b).toBe(1);
    expect(ir.a).toBe(1);
  });

  it("parses transparent keyword", () => {
    const ir = cssToColorIR("transparent");
    expect(ir).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("throws on unknown named colour", () => {
    expect(() => cssToColorIR("hotpink")).toThrow(/cannot parse css color/);
  });
});
