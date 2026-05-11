/**
 * @file Locate the target frames a user wants to emit.
 *
 * The Figma "Layers" panel lists exactly the direct children of the
 * page's CANVAS — there is no `"Layers"` container node. Targeting
 * "the frames directly under Design's Layers" reduces to enumerating
 * `safeChildren(designCanvas)` and filtering for FRAME nodes (a
 * Variant Set on disk is also a FRAME, carrying variant metadata; see
 * `docs/refactor/component-type-cleanup.md`).
 *
 * SYMBOL nodes (Figma's "main components" that INSTANCE nodes
 * reference, i.e. the on-disk encoding of the UI concept "Component")
 * are NOT in the default target set — they're library components, not
 * page-level layouts. Pass `{ includeSymbols: true }` to include them;
 * this is the right shape for design-system fig files where the canvas
 * is a palette of reusable parts. The CLI surfaces this via
 * `--symbols` / `--all-with-symbols`.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { safeChildren } from "@higma-document-models/fig/domain";

const FRAME_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
]);

const SYMBOL_TYPES: ReadonlySet<string> = new Set([
  "SYMBOL",
]);

function isFrameLike(node: FigNode): boolean {
  return FRAME_TYPES.has(node.type.name);
}

function isSymbol(node: FigNode): boolean {
  return SYMBOL_TYPES.has(node.type.name);
}

export type ListTargetsOptions = {
  /** Include SYMBOL nodes alongside FRAMEs. */
  readonly includeSymbols?: boolean;
};

/**
 * Frame-like direct children of the chosen canvas, in Figma's stored
 * order. With `includeSymbols: true` SYMBOL nodes are also returned —
 * design-system fig files (component libraries) keep their reusable
 * parts as SYMBOLs at the canvas root, and emitting those as
 * standalone SwiftUI Views is the only way a consumer can compose
 * them into a real app.
 */
export function listFrameTargets(
  canvas: FigNode,
  options: ListTargetsOptions = {},
): readonly FigNode[] {
  const children = safeChildren(canvas);
  if (options.includeSymbols) {
    return children.filter((c) => isFrameLike(c) || isSymbol(c));
  }
  return children.filter(isFrameLike);
}

/**
 * Filter a frame list to a single name. Throws when zero or multiple
 * frames carry that name — fig files routinely contain duplicate
 * names, so silent picking would generate the wrong page.
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
