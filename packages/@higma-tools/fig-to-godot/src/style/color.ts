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

const FULLY_OPAQUE_TOLERANCE = 1e-6;

/**
 * Build the Godot `Color(r, g, b, a)` value for an arbitrary RGBA
 * colour with an additional opacity multiplier (used for paint opacity
 * on top of colour alpha). When the resulting alpha is fully opaque
 * the alpha is still emitted as 1.0 — Godot's `.tscn` always shows the
 * full four channels and omitting `a` would produce `Color(r, g, b)`
 * which Godot does parse, but with a default `a=1.0` that the editor
 * re-saves as the four-channel form anyway. Emitting it directly keeps
 * round-trip diff-free.
 *
 * **Godot byte-rounding compensation.** Godot's gl_compatibility
 * renderer converts `Color` floats to 8-bit pixel bytes via
 * `int(c * 256)` (truncate after multiplying by 256), not the
 * `floor(c * 255 + 0.5)` (round-half-up at *255) used by WebGL/Skia.
 * For a fig source value like `0.95`:
 *   - WebGL reference: `0.95 * 255 = 242.25` → byte 242.
 *   - Godot: `int(0.95 * 256) = 243` → byte 243.
 * The compensation: emit `(target_byte + 0.5) / 256` so Godot's
 * `int(_ * 256)` recovers the correct byte. For 0.95, target byte
 * 242 → emit `(242 + 0.5) / 256 = 0.94726…`. Godot truncates to 242,
 * matching the reference. The transform is idempotent for values
 * already at the byte centre. Empirically verified end-to-end for
 * 0.5, 0.6, 0.898, 0.9, 0.95, 1.0.
 */
export function colorExpr(color: FigColor, paintOpacity: number = 1): GodotValue {
  const alpha = color.a * paintOpacity;
  const a = alpha < 1 - FULLY_OPAQUE_TOLERANCE ? compensateForGodotByteRounding(alpha) : 1;
  return colorVal(
    compensateForGodotByteRounding(color.r),
    compensateForGodotByteRounding(color.g),
    compensateForGodotByteRounding(color.b),
    a,
  );
}

/**
 * Map a 0..1 fig channel into the 0..1 form Godot needs to truncate
 * back to the same 8-bit byte the WebGL reference renders. See the
 * docstring on `colorExpr` for the math derivation.
 *
 * - 0 maps to 0 (black stays black).
 * - 1 maps to 1 (white stays white) — the formula naturally lands at
 *   `(255 + 0.5) / 256 = 0.998…` which Godot truncates to 255.
 * - Everything else routes through the WebGL byte to lock the output.
 */
function compensateForGodotByteRounding(c: number): number {
  if (c <= 0) {
    return 0;
  }
  if (c >= 1) {
    return 1;
  }
  // WebGL/Skia byte: floor(c * 255 + 0.5)
  const targetByte = Math.floor(c * 255 + 0.5);
  // Godot byte: int(c * 256). To produce `targetByte`, emit
  // `(targetByte + 0.5) / 256` (the byte's centre in *256 space).
  return (targetByte + 0.5) / 256;
}

/**
 * Build the Godot `Color` value for a SOLID paint, honouring the
 * paint's own `opacity` field (multiplied with the colour's `a`).
 */
export function solidPaintToColor(paint: FigSolidPaint): GodotValue {
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  return colorExpr(paint.color, paintOpacity);
}
