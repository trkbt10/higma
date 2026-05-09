/**
 * @file Numeric CSS-format helpers — fig-to-web's local entry point.
 *
 * Behaviour and rounding precision are owned by `@higma-bridges/web-fig`'s
 * `style` module. The wrappers below thread the bridge implementation
 * through fig-to-web's existing import path
 * (`../../lib/css-format/numeric`) so emitter code does not need to
 * change. Direct calls to the bridge functions are equivalent.
 */
import {
  clamp01 as bridgeClamp01,
  formatPx as bridgeFormatPx,
  round2 as bridgeRound2,
  round3 as bridgeRound3,
} from "@higma-bridges/web-fig/style";

/** Round to 2 decimal places. */
export function round2(n: number): number {
  return bridgeRound2(n);
}

/** Round to 3 decimal places. */
export function round3(n: number): number {
  return bridgeRound3(n);
}

/** Clamp into the closed interval `[0, 1]`. */
export function clamp01(n: number): number {
  return bridgeClamp01(n);
}

/** Render a numeric pixel value as a CSS length, two-decimal precision. */
export function formatPx(n: number): string {
  return bridgeFormatPx(n);
}
