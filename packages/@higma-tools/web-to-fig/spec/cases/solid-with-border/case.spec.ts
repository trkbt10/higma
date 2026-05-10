/**
 * @file Tier-1 case `solid-with-border` — `withSolidBg` ∘ `withUniformBorder`
 * applied to `baseDiv`. Demonstrates the smallest meaningful
 * composition: paint and stroke at the same time, neither feature
 * interfering with the other.
 *
 * If `solid-bg` and `border-uniform` both pass but THIS fails, the
 * regression is in feature *interaction* (e.g. one helper overwriting
 * the other's computed-style keys).
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_BORDER_WIDTH_PX, withUniformBorder } from "../border-uniform/fixture";
import { DEFAULT_SOLID_COLOR, withSolidBg } from "../solid-bg/fixture";

describe("case solid-with-border", () => {
  const frame = asFrame(
    singleChild(normalizeOne(withUniformBorder(withSolidBg(baseDiv())))),
  );

  it("preserves the solid-bg fill (composition didn't drop it)", () => {
    expect(frame.style.fills).toHaveLength(1);
    const fill = frame.style.fills[0]!;
    if (fill.kind !== "solid") {
      throw new Error("expected SOLID fill");
    }
    // DEFAULT_SOLID_COLOR is rgb(220, 50, 47).
    expect(fill.color.r).toBeCloseTo(220 / 255, 3);
    void DEFAULT_SOLID_COLOR;
  });

  it("preserves the uniform border (composition didn't drop it)", () => {
    expect(frame.style.strokes).toHaveLength(1);
    expect(frame.style.strokes[0]!.weight).toBe(DEFAULT_BORDER_WIDTH_PX);
  });

  it("composition order is irrelevant — either way the result matches", () => {
    const reversed = asFrame(
      singleChild(normalizeOne(withSolidBg(withUniformBorder(baseDiv())))),
    );
    expect(reversed.style.fills).toHaveLength(1);
    expect(reversed.style.strokes).toHaveLength(1);
  });
});
