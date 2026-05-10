/**
 * @file Translate Figma colours to Godot `Color(...)` value expressions.
 *
 * Godot's `Color` constructor (`Color(r, g, b, a)`) takes 0..1 floats —
 * the same shape Figma's `FigColor` carries, so no colour-space
 * conversion happens here. Multi-axis colour spaces (Linear, Display
 * P3) are not in scope; Godot's default `Color` is sRGB and matches
 * the v0 SwiftUI emitter's assumption.
 *
 * Paint opacity multiplies the colour's alpha. Figma authors a fill as
 * `{ color: { r, g, b, a }, opacity: paintOpacity }`; the rendered
 * alpha is `a * paintOpacity`. We collapse the two into one `a`
 * channel here so the Godot side never has to multiply.
 */
import type { FigColor, FigSolidPaint } from "@higma-document-models/fig/types";
import { colorVal, type GodotValue } from "../godot-tree";

const FIVE_DECIMAL_TOLERANCE = 1e-5;

/** Round a 0..1 component to 5 decimal places to keep emitted source compact. */
function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/**
 * Build the Godot `Color(r, g, b, a)` value for an arbitrary RGBA
 * colour with an additional opacity multiplier (used for paint opacity
 * on top of colour alpha). When the resulting alpha is fully opaque
 * the alpha is still emitted as 1.0 — Godot's `.tscn` always shows the
 * full four channels and omitting `a` would produce `Color(r, g, b)`
 * which Godot does parse, but with a default `a=1.0` that the editor
 * re-saves as the four-channel form anyway. Emitting it directly keeps
 * round-trip diff-free.
 */
export function colorExpr(color: FigColor, paintOpacity: number = 1): GodotValue {
  const alpha = color.a * paintOpacity;
  const a = alpha < 1 - FIVE_DECIMAL_TOLERANCE ? round5(alpha) : 1;
  return colorVal(round5(color.r), round5(color.g), round5(color.b), a);
}

/**
 * Build the Godot `Color` value for a SOLID paint, honouring the
 * paint's own `opacity` field (multiplied with the colour's `a`).
 */
export function solidPaintToColor(paint: FigSolidPaint): GodotValue {
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  return colorExpr(paint.color, paintOpacity);
}
