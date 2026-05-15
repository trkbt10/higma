/**
 * @file Locate the target frames the user wants to emit.
 *
 * The Figma "Layers" panel for a given page lists the direct children
 * of that page's CANVAS — there is no `"Layers"` container node.
 * Targeting "the frames under Design's Layers" therefore reduces to:
 * walk `safeChildren(designCanvas)` and collect every node whose
 * `type` is FRAME or SYMBOL (a SYMBOL is the on-disk encoding of the
 * Figma UI concept "Component"; a "Component Set" / "Variant Set" is
 * a FRAME carrying variant metadata — already covered by the FRAME
 * case). See `docs/refactor/component-type-cleanup.md`.
 *
 * SECTION nodes are *visual* groupings the designer uses to organise
 * the Layers panel; they are not themselves emit targets and do not
 * appear under "All Frames" in Figma's own export dialog, but their
 * FRAME / SYMBOL children very much do. Descending through SECTIONs
 * recovers those children — without this, real-world community .figs
 * (e.g. the App Store iOS/iPadOS/visionOS template's "App Store
 * symbols" SECTION holding Search toolbar, Event Details Card, Apps,
 * Event Card, App page metadata, … 16 SYMBOLs in total) lose every
 * symbol the designer chose to group, and the silent omission shows
 * up downstream as `Override path references unreachable guid`
 * fail-firsts on the INSTANCEs that consume those symbols.
 *
 * The walker stops at the first FRAME / SYMBOL it meets — FRAMEs /
 * SYMBOLs are themselves emit boundaries (the emitter walks their
 * descendants as JSX children), not containers we re-enter for more
 * top-level targets.
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

const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  "SECTION",
]);

function isFrameLike(node: FigNode): boolean {
  return FRAME_TYPES.has(node.type.name);
}

function isContainer(node: FigNode): boolean {
  return CONTAINER_TYPES.has(node.type.name);
}

/**
 * Walk `nodes` collecting frame-like emit targets. Recurses through
 * SECTION containers (which are not themselves emit targets) so that
 * frames / symbols grouped under a SECTION in the Figma Layers panel
 * still surface as top-level targets.
 */
function collectFrameLike(nodes: readonly FigNode[]): readonly FigNode[] {
  return nodes.flatMap((node) => {
    if (isFrameLike(node)) {
      return [node];
    }
    if (isContainer(node)) {
      return collectFrameLike(safeChildren(node));
    }
    return [];
  });
}

/**
 * Every frame-like emit target under the chosen canvas, in Figma's
 * stored order. SECTION containers are flattened — their children
 * appear inline where the SECTION sits.
 */
export function listFrameTargets(canvas: FigNode): readonly FigNode[] {
  return collectFrameLike(safeChildren(canvas));
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
