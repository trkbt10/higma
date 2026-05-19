/**
 * @file FigColor ↔ ColorIR conversion. Both carry RGBA channels in
 * `[0, 1]` so this is a pure re-shape — no rounding, no policy.
 */
import type { FigColor } from "@higma-document-models/fig/types";
import type { ColorIR } from "../ir/types";

/** FigColor → IR color (identity reshape). */
export function figColorToIR(c: FigColor): ColorIR {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

/** IR color → FigColor (identity reshape). */
export function irColorToFig(c: ColorIR): FigColor {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}
