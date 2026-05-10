/**
 * @file Spec for color → Godot Color value conversion.
 */
import { colorExpr, solidPaintToColor } from "./color";

describe("colorExpr", () => {
  it("emits four channels, alpha=1 explicit", () => {
    const c = colorExpr({ r: 0.5, g: 0.25, b: 0.125, a: 1 });
    expect(c.kind).toBe("color");
    if (c.kind !== "color") {
      throw new Error("expected color");
    }
    // Each channel is byte-rounding-compensated for Godot:
    // emit `(byte + 0.5) / 256` so Godot's truncate-by-256 produces
    // the same byte WebGL renders.
    expect(c.a).toBe(1);
    // r=0.5 → byte 128 → emit 128.5 / 256
    expect(c.r).toBeCloseTo(128.5 / 256, 6);
    // g=0.25 → byte 64 → emit 64.5 / 256
    expect(c.g).toBeCloseTo(64.5 / 256, 6);
    // b=0.125 → byte 32 → emit 32.5 / 256
    expect(c.b).toBeCloseTo(32.5 / 256, 6);
  });

  it("multiplies paint opacity into alpha (with compensation)", () => {
    const c = colorExpr({ r: 0, g: 0, b: 0, a: 1 }, 0.5);
    if (c.kind !== "color") {
      throw new Error("expected color");
    }
    // a=0.5 → byte 128 → emit 128.5 / 256
    expect(c.a).toBeCloseTo(128.5 / 256, 6);
  });

  it("compensates a fig channel so Godot truncate-by-256 matches WebGL byte", () => {
    const c = colorExpr({ r: 0.123456789, g: 0, b: 0, a: 1 });
    if (c.kind !== "color") {
      throw new Error("expected color");
    }
    // 0.123456789 * 255 + 0.5 = 31.9 → byte 31 → emit 31.5/256 = 0.12305
    expect(c.r).toBeCloseTo(31.5 / 256, 6);
  });

  it("preserves 0 and 1 exactly (no off-by-one shift)", () => {
    const black = colorExpr({ r: 0, g: 0, b: 0, a: 1 });
    if (black.kind !== "color") {
      throw new Error("expected color");
    }
    expect(black.r).toBe(0);
    const white = colorExpr({ r: 1, g: 1, b: 1, a: 1 });
    if (white.kind !== "color") {
      throw new Error("expected color");
    }
    expect(white.r).toBe(1);
  });
});

describe("solidPaintToColor", () => {
  it("respects an explicit paint opacity (with compensation)", () => {
    const c = solidPaintToColor({
      type: "SOLID",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 0.25,
    });
    if (c.kind !== "color") {
      throw new Error("expected color");
    }
    // a=0.25 → byte 64 → emit 64.5/256
    expect(c.a).toBeCloseTo(64.5 / 256, 6);
  });

  it("treats missing opacity as 1 (preserved exact)", () => {
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
