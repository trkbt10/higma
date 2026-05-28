/**
 * @file Background-decoration folding.
 *
 * In Figma, a common authoring pattern for "card with background image
 * and overlay text" is:
 *
 *   FRAME 150x250 (no fills)
 *     └─ ROUNDED_RECT 150x250 at (0,0) — fills the parent, carries the
 *        image / colour
 *     └─ FRAME 134x226 at (8,12) — the overlay content
 *
 * A naive emitter renders the parent as a static box and both children
 * as absolutely-positioned siblings. The web idiom is *one* element
 * with a `background-image` whose content sits inside `padding`. The
 * absolute child becomes a flex flow child once the background is
 * absorbed.
 *
 * Detection rule: the FIRST visible child is a "leaf decoration" iff
 *
 *   - its type is RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE (no text,
 *     no nested layout, no instance binding),
 *   - its size matches the parent's size within tolerance,
 *   - its transform is identity translation at (0, 0),
 *   - it has no rendered children of its own.
 *
 * "First visible child" is the bottom-most painted layer in Figma's
 * array order — Figma stores children bottom-first (children[0] is
 * the lowest layer in the Layers panel, i.e. the one painted first).
 * That's the layer CSS would model as `background`.
 *
 * Folding: the decoration's fills (solid / gradient / image) become
 * the parent's `background*` style, its `borderRadius` overrides the
 * parent's (when the parent has none), and its `boxShadow` /
 * `effects` likewise. The decoration node is then *skipped* by the
 * children emission so the parent reduces from N children to N-1, and
 * the layout inference can re-run with a cleaner shape.
 *
 * The fold deliberately runs at most ONE absorption per parent. If a
 * parent has two stacked full-bleed decorations the lower one wins;
 * the upper one stays as a regular child. Authors who want both as
 * `background-image` layers should rely on Figma's multi-paint stack
 * on a single decoration node — that already maps to a multi-layer
 * `background-image`.
 */
import type { FigEffect, FigNode } from "@higma-document-models/fig/types";
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { StyleInputs } from "./style";
import { paintsToBackgroundStyle } from "./paint";
import { effectsToBoxShadow } from "../../tokens";
import { formatPx } from "../../lib/css-format/numeric";

const SIZE_TOLERANCE = 0.5;
const POSITION_TOLERANCE = 0.5;

const DECORATION_TYPES: ReadonlySet<string> = new Set([
  "RECTANGLE",
  "ROUNDED_RECTANGLE",
  "ELLIPSE",
]);

export type AbsorptionResult = {
  /** Decoration node to skip during children emission, if any. */
  readonly absorbed: FigNode | undefined;
  /** Style entries to merge onto the parent's computed style. */
  readonly style: Record<string, string>;
};

const NONE: AbsorptionResult = { absorbed: undefined, style: {} };

function firstVisibleChild(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): FigNode | undefined {
  for (const child of childrenOf(node)) {
    if (child.visible !== false) {
      return child;
    }
  }
  return undefined;
}

function isLeafDecoration(
  child: FigNode,
  parentSize: { x: number; y: number },
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): boolean {
  if (!DECORATION_TYPES.has(child.type.name)) {
    return false;
  }
  if (!child.size) {
    return false;
  }
  if (Math.abs(child.size.x - parentSize.x) > SIZE_TOLERANCE) {
    return false;
  }
  if (Math.abs(child.size.y - parentSize.y) > SIZE_TOLERANCE) {
    return false;
  }
  const tx = child.transform?.m02 ?? 0;
  const ty = child.transform?.m12 ?? 0;
  if (Math.abs(tx) > POSITION_TOLERANCE) {
    return false;
  }
  if (Math.abs(ty) > POSITION_TOLERANCE) {
    return false;
  }
  if (Math.abs((child.transform?.m00 ?? 1) - 1) > 0.001) {
    return false;
  }
  if (Math.abs((child.transform?.m11 ?? 1) - 1) > 0.001) {
    return false;
  }
  if (Math.abs(child.transform?.m01 ?? 0) > 0.001) {
    return false;
  }
  if (Math.abs(child.transform?.m10 ?? 0) > 0.001) {
    return false;
  }
  // Has no rendered children of its own.
  for (const grandchild of childrenOf(child)) {
    if (grandchild.visible !== false) {
      return false;
    }
  }
  return true;
}

function parentHasInterferingPaint(parent: FigNode): boolean {
  // If the parent already has its own visible fills, we cannot absorb
  // an additional background — they'd compete or stack in undefined
  // order. Stop and let the decoration render as a normal child.
  const fills = parent.fillPaints ?? parent.backgroundPaints;
  if (!fills) {
    return false;
  }
  for (const paint of fills) {
    if (paint.visible !== false) {
      return true;
    }
  }
  return false;
}

/**
 * Real Figma `.fig` files store per-corner radii on individual fields
 * (`rectangleTopLeftCornerRadius` …) instead of as a uniform
 * `cornerRadius` or the array `rectangleCornerRadii`. fig-to-web walks raw
 * `FigNode`, so the per-corner read happens here. Returns
 * `undefined` when no per-corner field is set; otherwise emits the
 * 4-value `tl tr br bl` shorthand. Missing corners default to 0
 * (matching the renderer's `?? 0`).
 *
 * Suppresses the all-zeros case so we don't emit `borderRadius:
 * "0px 0px 0px 0px"` for plain rectangles.
 */
function perCornerRadiusCss(node: FigNode): string | undefined {
  const tl = node.rectangleTopLeftCornerRadius;
  const tr = node.rectangleTopRightCornerRadius;
  const br = node.rectangleBottomRightCornerRadius;
  const bl = node.rectangleBottomLeftCornerRadius;
  if (tl === undefined && tr === undefined && br === undefined && bl === undefined) {
    return undefined;
  }
  const tlN = tl ?? 0;
  const trN = tr ?? 0;
  const brN = br ?? 0;
  const blN = bl ?? 0;
  if (tlN === 0 && trN === 0 && brN === 0 && blN === 0) {
    return undefined;
  }
  return `${formatPx(tlN)} ${formatPx(trN)} ${formatPx(brN)} ${formatPx(blN)}`;
}

function decorationStyle(decoration: FigNode, inputs: StyleInputs): Record<string, string> {
  const style: Record<string, string> = {};
  const fills = decoration.fillPaints ?? decoration.backgroundPaints;
  const size = decoration.size;
  const nodeSize = size && size.x > 0 && size.y > 0 ? { width: size.x, height: size.y } : undefined;
  Object.assign(style, paintsToBackgroundStyle(fills, inputs.index, inputs.imageResolver, nodeSize));

  const radius = decorationRadius(decoration);
  if (radius !== undefined) {
    style.borderRadius = radius;
  }

  const shadow = decorationShadow(decoration, inputs);
  if (shadow !== undefined) {
    style.boxShadow = shadow;
  }

  return style;
}

function decorationRadius(node: FigNode): string | undefined {
  if (node.type.name === "ELLIPSE") {
    return "50%";
  }
  if (node.rectangleCornerRadii && node.rectangleCornerRadii.length === 4) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    const valid = typeof tl === "number" && typeof tr === "number"
      && typeof br === "number" && typeof bl === "number";
    if (valid) {
      return `${formatPx(tl)} ${formatPx(tr)} ${formatPx(br)} ${formatPx(bl)}`;
    }
  }
  const perCorner = perCornerRadiusCss(node);
  if (perCorner !== undefined) {
    return perCorner;
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return formatPx(node.cornerRadius);
  }
  return undefined;
}

function decorationShadow(node: FigNode, inputs: StyleInputs): string | undefined {
  const tokenId = inputs.index.shadowIdFor(node.effects as readonly FigEffect[] | undefined);
  if (tokenId) {
    return `var(--${tokenId})`;
  }
  return effectsToBoxShadow(node.effects);
}

/**
 * Try to absorb the parent's first child as a background decoration.
 * Returns `NONE` when the pattern doesn't match — the caller should
 * render children unchanged.
 */
export function absorbBackgroundDecoration(parent: FigNode, inputs: StyleInputs): AbsorptionResult {
  if (!parent.size) {
    return NONE;
  }
  if (parentHasInterferingPaint(parent)) {
    return NONE;
  }
  const first = firstVisibleChild(parent, inputs.childrenOf);
  if (!first) {
    return NONE;
  }
  if (!isLeafDecoration(first, parent.size, inputs.childrenOf)) {
    return NONE;
  }
  const style = decorationStyle(first, inputs);
  if (Object.keys(style).length === 0) {
    return NONE;
  }
  return { absorbed: first, style };
}
