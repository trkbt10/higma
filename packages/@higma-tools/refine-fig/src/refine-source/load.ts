/**
 * @file Refining-oriented view over a loaded `.fig` file.
 *
 * `RefineSource` extends the IO-layer SoT (`FigSymbolContext`) with
 * skill-specific groupings the analysis and plan layers consume:
 *
 *   - `userCanvases` / `internalCanvas` — Figma's user-visible vs
 *     internal-only CANVAS split. Required because the analysis only
 *     measures visible canvases and the internal canvas holds shared
 *     style proxies that the binding step needs.
 *   - `fillStyleProxies` / `textStyleProxies` — children of the
 *     internal canvas grouped by `styleType`. The plan layer matches
 *     palette / typography candidates against these proxies before
 *     emitting `bind` operations.
 *   - `topFrames` — every top-level FRAME (a "Variant Set" is a FRAME
 *     with variant metadata; the canonical schema has no COMPONENT or
 *     COMPONENT_SET NodeType — see
 *     `docs/refactor/component-type-cleanup.md`) across user canvases.
 *     The duplicate-cluster detector seeds its scan from this set.
 *
 * Symbol / style / nodeMap derivation lives in
 * `@higma-document-io/fig/context`. Re-implementing any of those here
 * would re-introduce the divergence this refactor removed.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren } from "@higma-document-models/fig/domain";
import {
  createFigSymbolContext,
  type FigSymbolContext,
} from "@higma-document-io/fig/context";

export type RefineSource = FigSymbolContext & {
  readonly userCanvases: readonly FigNode[];
  readonly internalCanvas: FigNode | undefined;
  readonly fillStyleProxies: readonly FigNode[];
  readonly textStyleProxies: readonly FigNode[];
  readonly topFrames: readonly FigNode[];
};

/** Load a `.fig` byte buffer for refinement (raw + resolved view). */
export async function loadRefineSource(bytes: Uint8Array): Promise<RefineSource> {
  const ctx = await createFigSymbolContext(bytes);

  const allCanvases = collectCanvases(ctx.roots);
  const userCanvases = allCanvases.filter((c) => c.internalOnly !== true);
  const internalCanvas = allCanvases.find((c) => c.internalOnly === true);

  const fillStyleProxies: FigNode[] = [];
  const textStyleProxies: FigNode[] = [];
  if (internalCanvas) {
    for (const child of safeChildren(internalCanvas)) {
      const styleType = child.styleType?.name;
      if (styleType === "FILL") {
        fillStyleProxies.push(child);
      } else if (styleType === "TEXT") {
        textStyleProxies.push(child);
      }
    }
  }

  const topFrames: FigNode[] = [];
  for (const canvas of userCanvases) {
    for (const child of safeChildren(canvas)) {
      const t = getNodeType(child);
      if (t === "FRAME") {
        topFrames.push(child);
      }
    }
  }

  return {
    ...ctx,
    userCanvases,
    internalCanvas,
    fillStyleProxies,
    textStyleProxies,
    topFrames,
  };
}

function collectCanvases(roots: readonly FigNode[]): readonly FigNode[] {
  return roots
    .filter((root) => getNodeType(root) === "DOCUMENT")
    .flatMap((root) => safeChildren(root).filter((child) => getNodeType(child) === "CANVAS"));
}
