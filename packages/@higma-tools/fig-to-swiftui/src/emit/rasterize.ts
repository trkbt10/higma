/**
 * @file Rasterisation manifest — assigns a stable resource name to
 * each fig node that should be replaced with an `Image(...)` view
 * at emit time, instead of recursing into its children.
 *
 * SwiftUI's `body` type-checker scales super-linearly with subtree
 * size; a Figma face card with 1500 path commands compiles for
 * minutes (or runs out of memory). The rasteriser sidesteps that
 * by burning down the subtree into a single PNG asset, which the
 * Swift consumer loads as `Image("<resource>")`. Rasterisation
 * happens at fig-to-swiftui CLI time via an externally-supplied
 * renderer (the WebGL harness in `@higma-tools/web-fig-roundtrip`).
 *
 * The CLI flow:
 *
 *   1. Walk the candidate frame trees, score each node's
 *      complexity (`complexity.ts`).
 *   2. For every node whose score crosses the threshold, mark it
 *      "rasterise" and stop recursing into its descendants — the
 *      whole subtree becomes one PNG.
 *   3. Hand the manifest to the renderer (a closure the CLI binary
 *      injects). The renderer returns a PNG buffer per entry.
 *   4. Write each PNG to `<out>/Resources/<slug>.png` and pass the
 *      `Map<guid-key, resource-slug>` to the emitter via
 *      `EmitContext.rasterizedSubtrees` so the walker emits an
 *      `Image("<slug>")` leaf instead of the original SwiftUI
 *      subtree.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { safeChildren, type FigBlob } from "@higma-document-models/fig/domain";
import { toCssSlug, uniqueId } from "@higma-primitives/identifier";
import { complexityScore } from "./complexity";

/** Stable identifier for a fig node — `${sessionID}:${localID}`. */
export function nodeKey(node: FigNode): string {
  const guid = node.guid;
  if (!guid) {
    throw new Error("rasterize: node missing guid");
  }
  return `${guid.sessionID}:${guid.localID}`;
}

export type RasterizationEntry = {
  /** Stable key (`nodeKey(node)`) used by EmitContext lookup. */
  readonly key: string;
  /** Slug suitable for filesystem + Swift `Image(...)` use. */
  readonly resourceSlug: string;
  /** The node that should be replaced by an `Image(...)` view. */
  readonly node: FigNode;
  /** Authored width/height in points. */
  readonly width: number;
  readonly height: number;
};

export type PlanRasterizationOptions = {
  /** Below this score, the node emits as plain SwiftUI views. */
  readonly threshold: number;
  /** Used by `complexityScore` to count Path commands accurately. */
  readonly blobs?: readonly FigBlob[];
};

/**
 * Decide which nodes need rasterisation. Walks each root top-down
 * and records the FIRST descendant whose complexity exceeds
 * `threshold` — once a node is rasterised, its children inherit
 * the bitmap and don't need their own PNG. This minimises the
 * number of WebGL renders and keeps higher-level layout (HStack /
 * ZStack composition) as live SwiftUI when possible.
 *
 * Subtrees with no `size` are skipped — the WebGL harness needs an
 * authored `width × height` to allocate the framebuffer; intrinsic-
 * size leaves (TEXT, etc.) shouldn't hit the threshold anyway.
 */
export function planRasterization(
  roots: readonly FigNode[],
  options: PlanRasterizationOptions,
): readonly RasterizationEntry[] {
  const slugs = new Set<string>();
  const out: RasterizationEntry[] = [];
  const visit = (node: FigNode): void => {
    if (!node.size || node.size.x <= 0 || node.size.y <= 0) {
      // No authored size — can't render. Recurse into children
      // (some intrinsic-size groups have sized descendants).
      for (const child of safeChildren(node)) {
        visit(child);
      }
      return;
    }
    const score = complexityScore(node, { blobs: options.blobs });
    if (score >= options.threshold) {
      const baseSlug = toCssSlug(node.name ?? `node-${nodeKey(node)}`);
      const resourceSlug = uniqueId(baseSlug, slugs);
      out.push({
        key: nodeKey(node),
        resourceSlug,
        node,
        width: Math.round(node.size.x),
        height: Math.round(node.size.y),
      });
      return; // don't recurse — children are inside this PNG
    }
    for (const child of safeChildren(node)) {
      visit(child);
    }
  };
  for (const root of roots) {
    visit(root);
  }
  return out;
}
