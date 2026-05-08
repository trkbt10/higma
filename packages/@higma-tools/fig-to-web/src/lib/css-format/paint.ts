/**
 * @file SOLID-paint → CSS-colour resolution.
 *
 * Single SoT for the "given a Figma SOLID paint and a token index,
 * produce a CSS colour string, preferring a `var(--token)` reference
 * when one exists" concept. The concept used to live as three
 * separate implementations (`emit/svg/svg.ts paintColor`,
 * `emit/style/paint.ts solidLayer`, `emit/style/rule.ts
 * solidPaintToCss`) that drifted on alpha-handling: two compared
 * `=== 1`, one used a `>= 0.999` opaque threshold to absorb
 * floating-point noise. Centralising the logic with an explicit
 * `opaqueThreshold` option makes the intent visible and prevents
 * the next caller from re-implementing the same decision.
 */
import type { FigPaint, FigSolidPaint } from "@higma-document-models/fig/types";
import { figColorToCss } from "./color";

/**
 * Minimum surface needed to resolve a paint to its design-token
 * id. The full `TokenIndex` shape lives in `tokens/`; this module
 * declares only the slice it actually consults so the css-format
 * layer can stay independent of the token graph wiring.
 */
export type PaintTokenResolver = {
  readonly colorIdForPaint: (paint: FigPaint) => string | undefined;
};

export type SolidPaintCssOptions = {
  /**
   * Composed alpha (`paint.color.a * paint.opacity`) values at or
   * above this threshold collapse to a fully opaque `rgb(...)`
   * output. Defaults to 1, which preserves the historical "exact"
   * behaviour the JSX emitter relies on. Use a value below 1 only
   * where a paint comes from a path that accumulates floating-point
   * drift (`emit/style/rule.ts` uses 0.999 to keep nearly-opaque
   * Figma exports rendering as `rgb(...)` instead of
   * `rgba(..., 0.999)`).
   */
  readonly opaqueThreshold?: number;
};

/**
 * Resolve a SOLID paint to its CSS colour string. When a design
 * token covers the paint, the result is `var(--<id>)`; otherwise
 * the colour is emitted directly via `figColorToCss`, with
 * composed-alpha handling per `opaqueThreshold`.
 */
export function solidPaintToCss(
  paint: FigSolidPaint,
  resolver: PaintTokenResolver,
  options: SolidPaintCssOptions = {},
): string {
  const tokenId = resolver.colorIdForPaint(paint);
  if (tokenId) {
    return `var(--${tokenId})`;
  }
  const opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  const composedA = paint.color.a * opacity;
  const opaqueAt = options.opaqueThreshold ?? 1;
  const a = composedA >= opaqueAt ? 1 : composedA;
  return figColorToCss({ ...paint.color, a });
}

/**
 * Resolve the *first* visible SOLID paint in a paint stack to a CSS
 * colour string. Non-SOLID and invisible paints are skipped; the
 * caller falls back to its own default when this returns undefined.
 */
export function firstSolidPaintCss(
  paints: readonly FigPaint[] | undefined,
  resolver: PaintTokenResolver,
  options: SolidPaintCssOptions = {},
): string | undefined {
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type !== "SOLID") {
      continue;
    }
    return solidPaintToCss(paint as FigSolidPaint, resolver, options);
  }
  return undefined;
}
