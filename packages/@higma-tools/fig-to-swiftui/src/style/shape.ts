/**
 * @file Map a FigNode's silhouette to a SwiftUI shape expression.
 *
 * SwiftUI uses different `Shape` types for the silhouettes Figma's
 * RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE / FRAME nodes paint:
 *
 *   - RECTANGLE / ROUNDED_RECTANGLE / FRAME with no corner radius
 *     → `Rectangle()`
 *   - RECTANGLE / ROUNDED_RECTANGLE / FRAME with uniform corner radius
 *     → `RoundedRectangle(cornerRadius: r)`
 *   - ELLIPSE → `Ellipse()`
 *
 * A single `shapeExprFor(node)` routine concentrates that decision so the
 * stroke overlay (`.overlay(<shape>().stroke(...))`) and the leaf
 * primitive itself paint with the same silhouette — without it the
 * overlay's outline would not follow the rounded corners of the fill
 * underneath.
 *
 * The routine is silhouette-only; it does not attach `.fill(...)` or
 * `.stroke(...)`. Callers compose those separately through the
 * `fillModifier` / `strokeOverlayModifier` routines in `modifiers.ts`.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { call, ident, namedArg, num, type SwiftExpr } from "../swift-tree";
import { uniformCornerRadius } from "./corner-radius";

const ELLIPSE_TYPE = "ELLIPSE";

/**
 * Produce the SwiftUI shape constructor expression that matches the
 * node's silhouette — a `RoundedRectangle(cornerRadius: r)` when a
 * uniform radius is authored, an `Ellipse()` for ELLIPSE nodes, and
 * a plain `Rectangle()` otherwise.
 *
 * Returns the expression in *constructor* form (e.g. `Rectangle()`)
 * suitable as a leaf or as the receiver of a method chain like
 * `.stroke(...)`. The caller is responsible for wrapping in
 * `.fill(...)`, `.overlay(...)`, etc.
 */
export function shapeExprFor(node: FigNode): SwiftExpr {
  if (node.type.name === ELLIPSE_TYPE) {
    return ident("Ellipse()");
  }
  const radius = uniformCornerRadius(node);
  if (radius !== undefined && radius > 0) {
    return call("RoundedRectangle", [namedArg("cornerRadius", num(radius))]);
  }
  return ident("Rectangle()");
}

/**
 * True when the node carries a uniform non-zero corner radius. Used by
 * the container path to decide whether to clip with a `RoundedRectangle`
 * rather than the bare `.cornerRadius(r)` modifier (the modifier form
 * does not survive a stroke overlay because the overlay shape would
 * paint its outline outside the clip).
 */
export function hasRoundedCorners(node: FigNode): boolean {
  const radius = uniformCornerRadius(node);
  return radius !== undefined && radius > 0;
}
