/**
 * @file Estimate the SwiftUI compile-cost of a fig node subtree.
 *
 * SwiftUI's `body` is type-checked through a chain of generic
 * `@ViewBuilder` overloads whose inference cost grows super-
 * linearly with the number of nested expressions. A handful of
 * Path-heavy fixtures (Win98 face cards, complex vector icons)
 * push the type-checker past its practical limit and either time
 * out, allocate gigabytes, or emit "the compiler is unable to
 * type-check this expression in reasonable time" diagnostics.
 *
 * `complexityScore(node)` returns a single number that
 * approximates the type-check cost of emitting the node directly
 * as SwiftUI views. Callers compare the score against a
 * caller-chosen threshold and rasterise the subtree to a PNG when
 * it crosses the line.
 *
 * The score weights the things SwiftUI's checker actually
 * inflates on:
 *   - Each PathCommand byte in `fillGeometry`/`strokeGeometry`
 *     contributes to the closure body of a `Path { ... }` view,
 *     which dominates compile time when there are hundreds of
 *     commands per node.
 *   - Each visible child (recursively) adds one more SwiftUI
 *     `View` element to the parent's body — direct linear cost
 *     plus the type-checker's overload-resolution cost.
 *
 * The score is intentionally crude. Callers care about "is this
 * comfortably under the limit?", not exact compile-time minutes.
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

/** Bytes that get translated into Path commands for a vector node. */
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
 * Estimate the compile-cost of rendering `node` as a SwiftUI
 * subtree. Each vector path command counts as 1, each descendant
 * counts as 1, capped at `maxDepth` (default 6) to stop pathological
 * symbol-instance trees from dominating the score. Returns 0 for
 * leaf nodes whose compile cost is genuinely trivial (TEXT, plain
 * RECTANGLE without geometry).
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
