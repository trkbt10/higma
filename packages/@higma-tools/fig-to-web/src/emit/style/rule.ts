/**
 * @file Plain-rule (horizontal/vertical line) detection and geometry.
 *
 * Figma authors thin dividers and separators as LINE / VECTOR nodes
 * with one degenerate axis (`size.y === 0` for a horizontal rule, or
 * `size.x === 0` plus a 90°/270° rotation for a vertical separator).
 * The renderer-side path emits a tiny SVG with a near-zero viewBox
 * height; CSS `preserveAspectRatio="none"` then collapses any drawn
 * geometry into the zero-pixel CSS box and the line disappears in
 * the browser. The SVG path machinery is also blind to the node's own
 * rotation matrix when that rotation is what makes a vertical line
 * vertical, so a 90°-rotated horizontal LINE renders as an invisible
 * horizontal line of length zero on the wrong axis.
 *
 * The fix is to short-circuit these cases on the emit side: detect a
 * "plain rule" (a degenerate-axis vector with a single solid stroke,
 * no dashes, no effects, no gradient) and render it as a CSS-styled
 * `<div>` with explicit pixel width/height and a `background` set to
 * the stroke colour. The post-rotation orientation is computed from
 * the node's own transform so the layout box matches what the eye
 * sees, regardless of how Figma authored the geometry. Anything more
 * elaborate (partial dashes, gradients, multi-segment paths) keeps
 * the existing SVG path so we don't regress on richer line styling.
 */
import type { FigMatrix, FigNode, FigPaint, FigStrokeWeight } from "@higma-document-models/fig/types";
import type { TokenIndex } from "../../tokens";

const RULE_NODE_TYPES: ReadonlySet<string> = new Set([
  "LINE",
  "VECTOR",
]);

export type PlainRuleGeometry = {
  /** Post-rotation visual width (CSS px). */
  readonly width: number;
  /** Post-rotation visual height (CSS px). */
  readonly height: number;
  /** Stroke colour resolved through the token index. */
  readonly color: string;
};

/** True when the node should render as a CSS-styled rule `<div>`. */
export function isPlainRule(node: FigNode, index: TokenIndex): boolean {
  return computeRuleGeometry(node, index) !== undefined;
}

/**
 * Compute the visible rule's CSS dimensions and colour, or undefined
 * when the node is not a "plain" rule.
 *
 * Plainness criteria:
 *   - Node type is LINE or VECTOR.
 *   - Exactly one of `size.x` / `size.y` is zero (degenerate axis).
 *   - Stroke paint is a single visible SOLID colour (token-resolved).
 *   - No fill paints, no dashes, no effects.
 *   - The node's own transform is identity, a pure 90° / 180° / 270°
 *     rotation, or close enough (within float tolerance) that the
 *     orientation can be read off the matrix unambiguously.
 */
export function computeRuleGeometry(node: FigNode, index: TokenIndex): PlainRuleGeometry | undefined {
  if (!RULE_NODE_TYPES.has(node.type.name)) {
    return undefined;
  }
  const size = node.size;
  if (!size) {
    return undefined;
  }
  const widthDegenerate = isDegenerate(size.x);
  const heightDegenerate = isDegenerate(size.y);
  if (widthDegenerate === heightDegenerate) {
    return undefined;
  }
  if (hasVisibleFill(node.fillPaints) || hasVisibleFill(node.backgroundPaints)) {
    return undefined;
  }
  const stroke = resolveStrokeColor(node.strokePaints, index);
  if (!stroke) {
    return undefined;
  }
  if (hasDashes(node)) {
    return undefined;
  }
  if (Array.isArray(node.effects) && node.effects.length > 0) {
    return undefined;
  }
  const strokeWidth = pickStrokeWidth(node.strokeWeight);
  if (strokeWidth === undefined || strokeWidth <= 0) {
    return undefined;
  }
  const orientation = readOrientation(node.transform);
  if (!orientation) {
    return undefined;
  }
  // `length` is the live (post-rotation) extent of the line's long
  // axis; `thickness` is the stroke width on the short axis.
  const length = widthDegenerate ? size.y : size.x;
  if (length <= 0) {
    return undefined;
  }
  if (orientation.swap) {
    return { width: strokeWidth, height: length, color: stroke };
  }
  if (widthDegenerate) {
    return { width: strokeWidth, height: length, color: stroke };
  }
  return { width: length, height: strokeWidth, color: stroke };
}

function isDegenerate(value: number | undefined): boolean {
  if (typeof value !== "number") {
    return false;
  }
  return Math.abs(value) < 0.5;
}

function hasVisibleFill(paints: readonly FigPaint[] | undefined): boolean {
  if (!paints) {
    return false;
  }
  for (const paint of paints) {
    if (paint.visible !== false) {
      return true;
    }
  }
  return false;
}

function resolveStrokeColor(paints: readonly FigPaint[] | undefined, index: TokenIndex): string | undefined {
  if (!paints) {
    return undefined;
  }
  let visibleSolids = 0;
  let resolved: string | undefined;
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type !== "SOLID") {
      return undefined;
    }
    visibleSolids += 1;
    if (visibleSolids > 1) {
      return undefined;
    }
    const tokenId = index.colorIdForPaint(paint);
    if (tokenId) {
      resolved = `var(--${tokenId})`;
      continue;
    }
    const opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
    const a = paint.color.a * opacity;
    const r = Math.round(paint.color.r * 255);
    const g = Math.round(paint.color.g * 255);
    const b = Math.round(paint.color.b * 255);
    resolved = a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round3(a)})`;
  }
  return resolved;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function hasDashes(node: FigNode): boolean {
  const dashes = node.strokeDashes;
  return Array.isArray(dashes) && dashes.length > 0;
}

function pickStrokeWidth(weight: FigStrokeWeight | undefined): number | undefined {
  if (weight === undefined) {
    return undefined;
  }
  if (typeof weight === "number") {
    return weight;
  }
  return Math.max(weight.top, weight.right, weight.bottom, weight.left);
}

/**
 * Read the orientation of the node's authored transform.
 *
 * Returns `{ swap: false }` for an identity / 180° rotation (the
 * line's authored axis matches its visual axis) and `{ swap: true }`
 * for a ±90° rotation (a horizontally-authored line shows up as
 * vertical, or vice versa). Anything else (skew, scale, arbitrary
 * rotation) returns undefined and the caller falls back to SVG.
 */
function readOrientation(transform: FigMatrix | undefined): { readonly swap: boolean } | undefined {
  if (!transform) {
    return { swap: false };
  }
  const m00 = transform.m00 ?? 1;
  const m01 = transform.m01 ?? 0;
  const m10 = transform.m10 ?? 0;
  const m11 = transform.m11 ?? 1;
  const tol = 1e-3;
  const isZero = (v: number): boolean => Math.abs(v) < tol;
  const isOne = (v: number): boolean => Math.abs(Math.abs(v) - 1) < tol;
  // Identity or 180° (axis-aligned, no swap).
  if (isOne(m00) && isOne(m11) && isZero(m01) && isZero(m10)) {
    return { swap: false };
  }
  // ±90° rotation — diagonal entries near zero, off-diagonals near ±1.
  if (isZero(m00) && isZero(m11) && isOne(m01) && isOne(m10)) {
    return { swap: true };
  }
  return undefined;
}
