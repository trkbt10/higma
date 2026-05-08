/**
 * @file Pure numeric helpers used when emitting CSS values.
 *
 * Single SoT for the trivial maths that previously lived as
 * copy-pasted helpers in every emitter / token-builder file
 * (`round2`, `round3`, `clamp01`, `formatPx`). Kept here so the
 * exact rounding precision is set once: anyone reaching for "round
 * to 2/3 decimals" must come through these functions, which means
 * the precision contract is impossible to violate by accident.
 */

/** Round to 2 decimal places. Used for px values where sub-pixel detail past the 0.01 mark is noise. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round to 3 decimal places. Used for normalised colour channels and gradient stop positions. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Clamp into the closed interval `[0, 1]`. */
export function clamp01(n: number): number {
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

/**
 * Render a numeric pixel value as a CSS length. Whole numbers stay
 * integer-flavoured (`12px`); fractional ones are rounded to two
 * decimals before serialisation, so floating-point noise (`12.000001`)
 * doesn't leak into emitted styles.
 */
export function formatPx(n: number): string {
  if (Number.isInteger(n)) {
    return `${n}px`;
  }
  return `${round2(n)}px`;
}
