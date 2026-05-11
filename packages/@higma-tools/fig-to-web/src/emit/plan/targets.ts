/**
 * @file Locate the target frames the user wants to emit.
 *
 * The Figma "Layers" panel for a given page lists exactly the direct
 * children of that page's CANVAS — there is no `"Layers"` container
 * node. Targeting "the frames directly under Design's Layers" therefore
 * reduces to: enumerate `safeChildren(designCanvas)` and filter for
 * nodes whose `type` is FRAME or SYMBOL (a SYMBOL is the on-disk
 * encoding of the Figma UI concept "Component"; a "Component Set" /
 * "Variant Set" is a FRAME carrying variant metadata — already covered
 * by the FRAME case). See `docs/refactor/component-type-cleanup.md`.
 *
 * The user can either request all top-level frames or a single frame
 * by name. We deliberately do NOT match by GUID — names are what the
 * CLI user can see in Figma, and resolving them surfaces ambiguity
 * (duplicate names) immediately.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { safeChildren } from "@higma-document-models/fig/domain";

const FRAME_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
  "SYMBOL",
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
 * names (the Youtube fixture has two `"Subscription"` frames), so
 * silent picking would generate the wrong page.
 */
export function pickFrameByName(frames: readonly FigNode[], name: string): FigNode {
  const matches = frames.filter((f) => f.name === name);
  if (matches.length === 0) {
    throw new Error(`No frame named "${name}" found under the chosen canvas. Available: ${frames.map((f) => f.name).join(", ")}`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple frames named "${name}" found (${matches.length}). Use --all or rename in Figma to disambiguate.`);
  }
  const result = matches[0];
  if (!result) {
    throw new Error("pickFrameByName: matches[0] missing despite length === 1");
  }
  return result;
}
