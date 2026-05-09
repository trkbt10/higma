/**
 * @file FigColor → CSS string conversion.
 *
 * Thin wrapper over the bridge's `colorIRToCss`. FigColor and ColorIR
 * are structurally identical (normalised RGBA in `[0,1]`), so this
 * file owns just the type-narrowing wrapper that lets fig-to-web's
 * existing call sites pass a `FigColor` without an explicit IR
 * conversion. The encoding rules — alpha-1 emits `rgb(...)`, otherwise
 * `rgba(...)` with 3-decimal alpha — live in the bridge.
 */
import type { FigColor } from "@higma-document-models/fig/types";
import { colorIRToCss } from "@higma-bridges/web-fig/style";

/** Convert a normalised `FigColor` (each channel in `[0, 1]`) to a CSS colour string. */
export function figColorToCss(c: FigColor): string {
  return colorIRToCss({ r: c.r, g: c.g, b: c.b, a: c.a });
}
