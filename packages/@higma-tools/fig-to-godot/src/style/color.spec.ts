/**
 * @file Spec for color → Godot Color value conversion.
 */
import { colorExpr, solidPaintToColor } from "./color";

describe("colorExpr", () => {
  it("emits a Color with all four channels (alpha=1 included)", () => {
    expect(colorExpr({ r: 0.5, g: 0.25, b: 0.125, a: 1 })).toEqual({
      kind: "color",
      r: 0.5,
      g: 0.25,
      b: 0.125,
      a: 1,
    });
  });

  it("multiplies paint opacity into alpha", () => {
    expect(colorExpr({ r: 0, g: 0, b: 0, a: 1 }, 0.5)).toEqual({
      kind: "color",
      r: 0,
      g: 0,
      b: 0,
      a: 0.5,
    });
  });

  it("rounds components to 5 decimals", () => {
    const c = colorExpr({ r: 0.123456789, g: 0, b: 0, a: 1 });
    if (c.kind !== "color") {
      throw new Error("expected color");
    }
    expect(c.r).toBeCloseTo(0.12346, 5);
  });
});

describe("solidPaintToColor", () => {
  it("respects an explicit paint opacity", () => {
    const c = solidPaintToColor({
      type: "SOLID",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 0.25,
    });
    if (c.kind !== "color") {
      throw new Error("expected color");
    }
    expect(c.a).toBeCloseTo(0.25, 5);
  });

  it("treats missing opacity as 1", () => {
    const c = solidPaintToColor({
      type: "SOLID",
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    if (c.kind !== "color") {
      throw new Error("expected color");
    }
    expect(c.a).toBe(1);
  });
});
