/**
 * @file Case `corner-radius-percent` — percentage radius is preserved
 * in IR with `kind: percent` and resolved against `min(width, height)`
 * at the Kiwi FigNode boundary (CSS Backgrounds 3 §5.3).
 *
 * Pill assertion: a 200×40 box with `border-radius: 50%` should
 * resolve to 20px (= 50% of min(200, 40)).
 */
import { asFrame, buildOne, findFigNodeByName, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_RADIUS_PERCENT, withPercentRadius } from "./fixture";

describe("case corner-radius-percent — IR", () => {
  const frame = asFrame(singleChild(normalizeOne(withPercentRadius(baseDiv()))));

  it("preserves percentage values in IR (no premature px resolution)", () => {
    const radii = frame.style.cornerRadius!;
    for (const r of radii) {
      expect(r).toEqual({ kind: "percent", value: DEFAULT_RADIUS_PERCENT });
    }
  });
});

describe("case corner-radius-percent — Kiwi FigNode", () => {
  it("resolves 50% on a 200x40 frame to 20 px (min(200, 40) * 50%)", () => {
    const { context } = buildOne(
      withPercentRadius(
        baseDiv({ rect: { x: 0, y: 0, width: 200, height: 40 } }),
      ),
    );
    const node = findFigNodeByName(context, "div");
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.cornerRadius).toBe(20);
  });

  it("resolves 50% on a square 80x80 frame to 40 px", () => {
    const { context } = buildOne(
      withPercentRadius(
        baseDiv({ rect: { x: 0, y: 0, width: 80, height: 80 } }),
      ),
    );
    const node = findFigNodeByName(context, "div");
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.cornerRadius).toBe(40);
  });
});
