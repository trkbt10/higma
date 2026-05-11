/**
 * @file Locate the target frames a user wants to emit.
 *
 * The Figma "Layers" panel lists exactly the direct children of the
 * page's CANVAS — there is no `"Layers"` container node. Targeting
 * "the frames directly under Design's Layers" reduces to enumerating
 * `safeChildren(designCanvas)` and filtering for FRAME nodes (the
 * canonical Figma schema has no COMPONENT or COMPONENT_SET NodeType;
 * a "Variant Set" is a FRAME with variant metadata — see
 * `docs/refactor/component-type-cleanup.md`).
 *
 * Mirrors `fig-to-swiftui/src/emit/targets.ts` — the two emitters
 * agree on what counts as a top-level emit candidate so a single fig
 * file produces matching frame lists for both.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { safeChildren } from "@higma-document-models/fig/domain";

const FRAME_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
]);

function isFrameLike(node: FigNode): boolean {
  return FRAME_TYPES.has(node.type.name);
}

/** All frame-like direct children of the chosen canvas, in Figma's stored order. */
export function listFrameTargets(canvas: FigNode): readonly FigNode[] {
  return safeChildren(canvas).filter(isFrameLike);
}

/**
 * Filter a frame list to a single name. Throws when zero or multiple
 * frames carry that name — fig files routinely contain duplicate
 * names, so silent picking would generate the wrong scene.
 */
export function pickFrameByName(frames: readonly FigNode[], name: string): FigNode {
  const matches = frames.filter((f) => f.name === name);
  if (matches.length === 0) {
    throw new Error(
      `No frame named "${name}" found under the chosen canvas. Available: ${frames
        .map((f) => f.name)
        .join(", ")}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple frames named "${name}" found (${matches.length}). Use --all or rename in Figma to disambiguate.`,
    );
  }
  const result = matches[0];
  if (!result) {
    throw new Error("pickFrameByName: matches[0] missing despite length === 1");
  }
  return result;
}
