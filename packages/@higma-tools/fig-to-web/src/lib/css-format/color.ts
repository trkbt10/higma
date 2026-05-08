/**
 * @file FigColor → CSS string conversion.
 *
 * Single SoT for the four-channel `(r,g,b,a)` projection that was
 * previously copy-pasted into svg.ts, paint.ts, effect.ts, color.ts
 * and the typography path. All copies were byte-identical; keeping
 * them aligned by hand was a SoT violation waiting to drift.
 *
 * Output rules:
 *   - alpha = 1 → `rgb(r, g, b)` (the readable form Figma authors
 *     expect to see in DevTools).
 *   - alpha < 1 → `rgba(r, g, b, a)` with alpha rounded to 3
 *     decimals so floating-point noise doesn't leak into emitted
 *     CSS.
 */
import type { FigColor } from "@higma-document-models/fig/types";
import { round3 } from "./numeric";

/** Convert a normalised `FigColor` (each channel in `[0, 1]`) to a CSS colour string. */
export function figColorToCss(c: FigColor): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  if (c.a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${round3(c.a)})`;
}
