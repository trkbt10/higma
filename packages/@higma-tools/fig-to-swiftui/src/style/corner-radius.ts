/**
 * @file Resolve a node's corner radius into a single uniform value.
 *
 * Figma stores corner radii as either a uniform `cornerRadius` field or
 * four per-corner fields (`rectangleTopLeftCornerRadius`, …). SwiftUI's
 * `RoundedRectangle(cornerRadius:)` accepts a uniform value only; the
 * per-corner case requires a custom `Shape` and is not yet in scope —
 * the routine throws (Fail-Fast) so the caller surfaces the gap rather
 * than silently flattening to one corner.
 */
import type { FigNode } from "@higma-document-models/fig/types";

/**
 * Pick the uniform corner-radius value for a node, or undefined when no
 * radius is authored / radius is zero. Throws when per-corner radii are
 * non-uniform — that case is intentionally out of scope for the v0
 * emitter (a future iteration would emit a custom path).
 */
export function uniformCornerRadius(node: FigNode): number | undefined {
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return node.cornerRadius;
  }
  const tl = node.rectangleTopLeftCornerRadius;
  const tr = node.rectangleTopRightCornerRadius;
  const br = node.rectangleBottomRightCornerRadius;
  const bl = node.rectangleBottomLeftCornerRadius;
  if (tl === undefined && tr === undefined && br === undefined && bl === undefined) {
    return undefined;
  }
  const values = [tl ?? 0, tr ?? 0, br ?? 0, bl ?? 0];
  const first = values[0];
  if (first === undefined) {
    return undefined;
  }
  for (const v of values) {
    if (v !== first) {
      throw new Error(
        `fig-to-swiftui: per-corner radii are not supported (node "${node.name ?? "unnamed"}" has [${values.join(", ")}])`,
      );
    }
  }
  return first > 0 ? first : undefined;
}
