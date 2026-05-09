/**
 * @file `<length-percentage>` resolver — the Single Source of Truth
 * for converting a `LengthIR` value into pixels at emit time.
 *
 * Capture stores values verbatim (`{kind: "px", value: 12}` or
 * `{kind: "percent", value: 50}`). Emit calls `resolveLength` with
 * the relevant axis dimension from the owning element's box. Each
 * percentage-bearing CSS property has a different reference axis:
 *
 *   - `border-radius`: percent resolves against `min(width, height)`
 *     of the owning border box (CSS Backgrounds 3 §5.3).
 *   - `padding-{top,bottom,left,right}`: percent resolves against
 *     the *containing block's width* (CSS Box Model §3.2).
 *   - `margin-*`: same as padding.
 *   - `gap` (flex): percent of the main-axis content size.
 *
 * Encoding all of these lookups in one place keeps emit code
 * declarative ("resolve this corner radius against the box") and
 * stops every IR consumer from re-implementing the rules.
 */
import type { BoxIR, LengthIR } from "../ir/types";

export function resolveLength(value: LengthIR, basis: number): number {
  if (value.kind === "px") {
    return value.value;
  }
  return (value.value / 100) * basis;
}

/** Resolve a corner-radius `LengthIR` against `min(width, height)`. */
export function resolveCornerRadius(value: LengthIR, box: BoxIR): number {
  return resolveLength(value, Math.min(box.width, box.height));
}

/** Resolve a padding/margin `LengthIR` against the containing-block width. */
export function resolveBlockInset(value: LengthIR, containingBlockWidth: number): number {
  return resolveLength(value, containingBlockWidth);
}

/** Construct a px-valued `LengthIR`. */
export function pxLength(value: number): LengthIR {
  return { kind: "px", value };
}

/** Construct a percent-valued `LengthIR`. */
export function percentLength(value: number): LengthIR {
  return { kind: "percent", value };
}
