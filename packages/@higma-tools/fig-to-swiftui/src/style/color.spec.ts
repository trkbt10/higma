/**
 * @file Spec for Figma colour → SwiftUI Color expression translation.
 */
import type { FigSolidPaint } from "@higma-document-models/fig/types";
import { PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { serialize } from "../swift-tree";
import { leaf } from "../swift-tree/builder";
import { colorExpr, solidPaintToColor } from "./color";

function solidPaint(fields: Omit<FigSolidPaint, "type">): FigSolidPaint {
  return { type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, ...fields };
}

describe("colorExpr", () => {
  it("omits opacity when fully opaque", () => {
    const expr = colorExpr({ r: 1, g: 0, b: 0, a: 1 });
    expect(serialize(leaf(expr))).toBe("Color(red: 1, green: 0, blue: 0)");
  });

  it("emits opacity when alpha is below 1", () => {
    const expr = colorExpr({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 });
    expect(serialize(leaf(expr))).toBe(
      "Color(red: 0.5, green: 0.5, blue: 0.5, opacity: 0.5)",
    );
  });

  it("multiplies paint opacity into alpha", () => {
    const expr = colorExpr({ r: 0, g: 0, b: 0, a: 1 }, 0.25);
    expect(serialize(leaf(expr))).toBe(
      "Color(red: 0, green: 0, blue: 0, opacity: 0.25)",
    );
  });
});

describe("solidPaintToColor", () => {
  it("renders a SOLID paint with its color and opacity", () => {
    const paint = solidPaint({
      color: { r: 1, g: 0.5, b: 0, a: 1 },
      opacity: 0.8,
    });
    const expr = solidPaintToColor(paint);
    expect(serialize(leaf(expr))).toBe(
      "Color(red: 1, green: 0.5, blue: 0, opacity: 0.8)",
    );
  });

  it("treats missing paint opacity as 1", () => {
    const paint = solidPaint({
      color: { r: 1, g: 1, b: 1, a: 1 },
    });
    const expr = solidPaintToColor(paint);
    expect(serialize(leaf(expr))).toBe("Color(red: 1, green: 1, blue: 1)");
  });
});
