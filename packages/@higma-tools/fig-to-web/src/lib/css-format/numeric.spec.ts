/**
 * @file Pin the numeric SoT — the rounding precision is what every
 * emitter relies on, so changing it must show up here as a
 * deliberate test edit.
 */
import { clamp01, formatPx, round2, round3 } from "./numeric";

describe("css-format numeric", () => {
  it("round2 rounds to two decimals (with banker-style Math.round)", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBeCloseTo(1.24, 5);
    expect(round2(2)).toBe(2);
  });

  it("round3 rounds to three decimals", () => {
    expect(round3(0.123456)).toBe(0.123);
    expect(round3(0.0009)).toBe(0.001);
    expect(round3(1)).toBe(1);
  });

  it("clamp01 floors at 0 and ceilings at 1", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2)).toBe(1);
  });

  it("formatPx keeps integers integer-flavoured", () => {
    expect(formatPx(12)).toBe("12px");
    expect(formatPx(0)).toBe("0px");
    expect(formatPx(-3)).toBe("-3px");
  });

  it("formatPx rounds non-integer values to two decimals", () => {
    expect(formatPx(12.345)).toBe("12.35px");
    expect(formatPx(0.001)).toBe("0px");
    expect(formatPx(1.5)).toBe("1.5px");
  });
});
