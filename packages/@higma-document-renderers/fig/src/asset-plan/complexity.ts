/**
 * @file Estimate the consumer-side compile / runtime cost of emitting
 * a fig node subtree.
 *
 * The score is the same metric the SwiftUI target uses to decide
 * "is this subtree small enough to emit as live code, or should we
 * rasterise / externalise it as an asset?" Lifting it here so other
 * tool-side emitters (fig-to-web's icon externalisation, in
 * particular) can reuse the exact same decision without duplicating
 * the heuristic.
 *
 * The score weights the two things downstream targets actually feel
 * scale-pain on:
 *
 *   - Each PathCommand byte in `fillGeometry` / `strokeGeometry`
 *     contributes to the inner closure of a SwiftUI `Path { ... }`
 *     view (whose type-checker chokes around ~1500 commands) and to
 *     the inline `<path d="..."/>` payload in HTML / SVG output.
 *   - Each visible descendant (capped at `maxDepth`) adds one more
 *     view to the parent's body — direct linear cost plus
 *     overload-resolution cost in strongly-typed targets.
 *
 * The score is intentionally crude: callers care about "is this
 * comfortably under the threshold I picked?", not exact compile-time
 * minutes. Targets pick a numerical threshold from empirical
 * measurement; this module just hands them a comparable number.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { safeChildren, type FigBlob, decodePathCommands } from "@higma-document-models/fig/domain";

function geometryCommandCount(
  geom: { readonly commandsBlob?: number } | undefined,
  blobs: readonly FigBlob[] | undefined,
): number {
  if (!geom || geom.commandsBlob === undefined) {
    return 0;
  }
  if (!blobs || geom.commandsBlob >= blobs.length) {
    return 0;
  }
  const blob = blobs[geom.commandsBlob];
  if (!blob) {
    return 0;
  }
  return decodePathCommands(blob).length;
}

/** Bytes that get translated into path commands for a vector node. */
function pathCommandCount(node: FigNode, blobs: readonly FigBlob[] | undefined): number {
  const fillTotal = (node.fillGeometry ?? []).reduce(
    (sum, fg) => sum + geometryCommandCount(fg, blobs),
    0,
  );
  const strokeTotal = (node.strokeGeometry ?? []).reduce(
    (sum, sg) => sum + geometryCommandCount(sg, blobs),
    0,
  );
  return fillTotal + strokeTotal;
}

export type ComplexityOptions = {
  readonly blobs?: readonly FigBlob[];
  readonly maxDepth?: number;
};

/**
 * Estimate the emit cost of rendering `node` as a target-native view
 * subtree. Each vector path command counts as 1, each descendant
 * counts as 1, capped at `maxDepth` (default 6) to stop pathological
 * symbol-instance trees from dominating the score. Returns 0 for
 * leaf nodes whose cost is genuinely trivial (TEXT, plain RECTANGLE
 * without geometry).
 */
export function complexityScore(node: FigNode, options: ComplexityOptions = {}): number {
  const blobs = options.blobs;
  const maxDepth = options.maxDepth ?? 6;
  return scoreSubtree(node, 0, maxDepth, blobs);
}

function scoreSubtree(
  node: FigNode,
  depth: number,
  maxDepth: number,
  blobs: readonly FigBlob[] | undefined,
): number {
  if (depth > maxDepth) {
    return 0;
  }
  const childTotal = safeChildren(node).reduce(
    (sum, c) => sum + scoreSubtree(c, depth + 1, maxDepth, blobs),
    0,
  );
  return pathCommandCount(node, blobs) + 1 + childTotal;
}
