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
export function colorExpr(
  color: FigColor,
  paintOpacity: number = 1,
  compensate: boolean = true,
): GodotValue {
  const alpha = color.a * paintOpacity;
  const compensateChannel = compensate
    ? compensateForGodotByteRounding
    : compensateForOpacityComposite;
  const aFinal = alpha < 1 - FULLY_OPAQUE_TOLERANCE ? compensateChannel(alpha) : 1;
  return colorVal(
    compensateChannel(color.r),
    compensateChannel(color.g),
    compensateChannel(color.b),
    aFinal,
  );
}

/**
 * Compensation for nodes inside a CanvasGroup with `self_modulate`
 * alpha < 1. Godot composites the buffer byte with the parent over
 * integer arithmetic — different rounding parity from WebGL's float
 * composite. The `(targetByte+0.5)/256` form used outside opacity
 * contexts targets `floor(c*255+0.5)` (WebGL byte) but lands one byte
 * high through Godot's integer composite for channels whose
 * `c*255` fractional part ≥ 0.5 (e.g. `c=0.1 → 25.5`). Switch to
 * `floor(c*255)` (Polygon2D-style) so the buffer byte is the one
 * Godot's `(buf + bg_byte)/2` produces a final byte matching WebGL's
 * `floor(c_composite*255 + 0.5)`. Verified for c ∈ {0, 0.1, 0.5, 0.9,
 * 1.0} over white background at alpha=0.5.
 */
function compensateForOpacityComposite(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  const targetByte = Math.floor(c * 255);
  return (targetByte + 0.5) / 256;
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
export function solidPaintToColor(paint: FigSolidPaint, compensate: boolean = true): GodotValue {
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  return colorExpr(paint.color, paintOpacity, compensate);
}

/**
 * Build the Godot `Color` value for a SOLID paint, calibrated for
 * `Polygon2D`'s vertex-color path.
 *
 * `Polygon2D` does NOT use the same `int(c * 256)` byte truncation
 * that `StyleBoxFlat.bg_color` does. Empirically, Polygon2D's
 * vertex colour goes through `floor(c * 255)` (verified against the
 * gl_compatibility renderer with a side-by-side Panel-vs-Polygon2D
 * fixture: `0.89648438` → Panel emits 229, Polygon2D emits 228). So
 * the StyleBoxFlat compensation (which targets `int(c * 256)`)
 * over-compensates by half a byte for polygons and lands one byte
 * low.
 *
 * This helper writes the value Polygon2D needs to recover the same
 * byte the WebGL reference renders: `targetByte / 255 + ε` where
 * `ε` is small enough not to cross to the next byte. We use
 * `(targetByte + 0.5) / 255` for the byte centre — Polygon2D's
 * `floor(c * 255)` recovers the byte unchanged.
 *
 * Why two helpers instead of one: each Godot widget chooses its own
 * shader path. StyleBoxFlat draws via an immediate-mode quad whose
 * fragment colour is set from the `Color` constant directly (the
 * `int(c*256)` path). Polygon2D draws via a vertex buffer whose
 * per-vertex colour is interpolated by the GPU (the `floor(c*255)`
 * path). The two are not interchangeable.
 */
export function solidPaintToPolygon2DColor(paint: FigSolidPaint): GodotValue {
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  const a = paint.color.a * paintOpacity;
  return colorVal(
    polygon2DByteCompensate(paint.color.r),
    polygon2DByteCompensate(paint.color.g),
    polygon2DByteCompensate(paint.color.b),
    a < 1 - FULLY_OPAQUE_TOLERANCE ? polygon2DByteCompensate(a) : 1,
  );
}

/**
 * Map a 0..1 fig channel into the 0..1 form Polygon2D needs to
 * `floor(c*255)`-truncate to the same byte the WebGL reference
 * (`floor(c*255 + 0.5)`) renders.
 */
function polygon2DByteCompensate(c: number): number {
  if (c <= 0) {
    return 0;
  }
  if (c >= 1) {
    return 1;
  }
  const targetByte = Math.floor(c * 255 + 0.5);
  // Place the value at the centre of `targetByte / 255` so floor
  // recovers `targetByte` regardless of float rounding.
  return (targetByte + 0.5) / 255;
}

/**
 * Build the Godot `Color` for a SOLID paint, calibrated for `Line2D`'s
 * `default_color` path.
 *
 * Line2D quantises its vertex colour through `Color::to_argb32` which
 * does **round-half-up** (= `floor(c * 255 + 0.5)`), unlike Polygon2D
 * which truncates (`floor(c * 255)`). The 0.5-byte-centre offset that
 * recovers a target byte under floor lands one byte high under round
 * for source colours where `c * 255` already lies at or above
 * `targetByte + 0.5`. Empirically observed on
 * `vector-winding/winding-stroke-arc`: `g = 0.7` (which targets byte
 * 178 since float32(0.7) is 0.6999...) emitted via Polygon2D's
 * `(178+0.5)/255 = 0.7019` rounds to byte 179 in Line2D.
 *
 * Sending the byte's lower bound `targetByte / 255` works: `round(b)`
 * is `b` for any integer b. We use the byte center shifted slightly
 * lower than the Polygon2D form: `targetByte / 255` exactly. Float
 * noise is bounded by Godot's float32 path; verified that c=0 / c=1
 * still round to 0 / 255 respectively.
 */
export function solidPaintToLine2DColor(paint: FigSolidPaint): GodotValue {
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  const a = paint.color.a * paintOpacity;
  return colorVal(
    line2DByteCompensate(paint.color.r),
    line2DByteCompensate(paint.color.g),
    line2DByteCompensate(paint.color.b),
    a < 1 - FULLY_OPAQUE_TOLERANCE ? line2DByteCompensate(a) : 1,
  );
}

/**
 * Map a 0..1 fig channel into the 0..1 form Line2D needs to
 * `round(c*255)`-quantise (round-half-up) to the same byte the
 * WebGL reference (`floor(c*255 + 0.5)`) renders.
 *
 * Emitting the byte's lower bound `targetByte / 255` makes
 * `round(targetByte / 255 * 255) = round(targetByte) = targetByte`.
 * For the byte boundary the integer is exact so float noise can't
 * push the result either way.
 */
function line2DByteCompensate(c: number): number {
  if (c <= 0) {
    return 0;
  }
  if (c >= 1) {
    return 1;
  }
  const targetByte = Math.floor(c * 255 + 0.5);
  return targetByte / 255;
}


