/**
 * @file Translate Figma colours to SwiftUI `Color` initialiser expressions.
 *
 * SwiftUI exposes `Color` as a value type with several initialisers; the
 * one that round-trips Figma's premultiplied 0..1 RGBA cleanly is
 *
 *   Color(red: r, green: g, blue: b, opacity: a)
 *
 * `Color(.sRGB, red:..., opacity:...)` is more explicit but the bare
 * form already lives in the sRGB colour space when the targeting iOS
 * deployment is iOS 14+, which is the supported floor for fig-to-swiftui
 * output. Multi-axis colour spaces (P3, BT.2020) are not in scope.
 *
 * Paint opacity multiplies the colour's alpha. Figma authors a fill as
 * `{ color: { r, g, b, a }, opacity: paintOpacity }`; the rendered
 * alpha is `a * paintOpacity`. We collapse the two into one
 * `opacity:` argument here so the SwiftUI side never has to multiply.
 */
import type { FigColor, FigSolidPaint } from "@higma-document-models/fig/types";
import { call, namedArg, num, type SwiftExpr } from "../swift-tree";

const FIVE_DECIMAL_TOLERANCE = 1e-5;

/** Round a 0..1 component to 5 decimal places to keep emitted source compact. */
function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/**
 * Build the SwiftUI `Color(...)` expression for an arbitrary RGBA colour
 * with an additional opacity multiplier (used for paint opacity on top of
 * colour alpha). When the resulting alpha is fully opaque the `opacity:`
 * argument is omitted — Swift's default for the Color initialiser is 1.0.
 */
export function colorExpr(color: FigColor, paintOpacity: number = 1): SwiftExpr {
  const alpha = color.a * paintOpacity;
  const args = [
    namedArg("red", num(round5(color.r))),
    namedArg("green", num(round5(color.g))),
    namedArg("blue", num(round5(color.b))),
  ];
  if (alpha < 1 - FIVE_DECIMAL_TOLERANCE) {
    return call("Color", [...args, namedArg("opacity", num(round5(alpha)))]);
  }
  return call("Color", args);
}

/**
 * Build the SwiftUI `Color` expression for a SOLID paint, honouring the
 * paint's own `opacity` field (multiplied with the colour's `a`).
 */
export function solidPaintToColor(paint: FigSolidPaint): SwiftExpr {
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  return colorExpr(paint.color, paintOpacity);
}
