/**
 * @file Refining-oriented view over a loaded `.fig` file.
 *
 * `RefineSource` extends the IO-layer SoT (`FigDocumentContext`) with
 * skill-specific groupings the analysis and plan layers consume:
 *
 *   - `userCanvases` / `internalCanvas` — Figma's user-visible vs
 *     internal-only CANVAS split. Required because the analysis only
 *     measures visible canvases and the internal canvas holds shared
 *     style styleDefinitions that the binding step needs.
 *   - `fillStyleDefinitions` / `textStyleDefinitions` — children of the
 *     internal canvas grouped by `styleType`. The plan layer matches
 *     palette / typography candidates against these styleDefinitions before
 *     emitting `bind` operations.
 *   - `topFrames` — every top-level FRAME (a "Variant Set" is a FRAME
 *     with variant metadata; the canonical schema has no COMPONENT or
 *     COMPONENT_SET NodeType — see
 *     `docs/refactor/component-type-cleanup.md`) across user canvases.
 *     The duplicate-cluster detector seeds its scan from this set.
 *
 * Symbol / style / document index derivation lives in
 * `@higma-document-io/fig/context`. Re-implementing any of those here
 * would re-introduce the divergence this refactor removed.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type { FigKiwiDocumentIndex, LoadedFigFile } from "@higma-document-models/fig/domain";
import { getNodeType } from "@higma-document-models/fig/domain";
import {
  createFigDocumentContextFromLoaded,
  type FigDocumentContext,
} from "@higma-document-io/fig/context";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

export type RefineSource = Omit<FigDocumentContext, "loaded"> & {
  readonly loaded: LoadedFigFile;
  readonly userCanvases: readonly FigNode[];
  readonly internalCanvas: FigNode | undefined;
  readonly fillStyleDefinitions: readonly FigNode[];
  readonly textStyleDefinitions: readonly FigNode[];
  readonly topFrames: readonly FigNode[];
};

/** Load a `.fig` byte buffer for refinement. */
export async function loadRefineSource(bytes: Uint8Array): Promise<RefineSource> {
  const loaded = await loadFigFile(bytes);
  const ctx = createFigDocumentContextFromLoaded(loaded);

  const allCanvases = collectCanvases(ctx.document);
  const userCanvases = allCanvases.filter((c) => c.internalOnly !== true);
  const internalCanvas = allCanvases.find((c) => c.internalOnly === true);

  const fillStyleDefinitions: FigNode[] = [];
  const textStyleDefinitions: FigNode[] = [];
  if (internalCanvas) {
    for (const child of ctx.document.childrenOf(internalCanvas)) {
      const styleType = child.styleType?.name;
      if (styleType === "FILL") {
        fillStyleDefinitions.push(child);
        continue;
      }
      if (styleType === "TEXT") {
        textStyleDefinitions.push(child);
      }
    }
  }

  const topFrames: FigNode[] = [];
  for (const canvas of userCanvases) {
    for (const child of ctx.document.childrenOf(canvas)) {
      const t = getNodeType(child);
      if (t === "FRAME") {
        topFrames.push(child);
      }
    }
  }

  return {
    ...ctx,
    loaded,
    userCanvases,
    internalCanvas,
    fillStyleDefinitions,
    textStyleDefinitions,
    topFrames,
  };
}

function collectCanvases(document: FigKiwiDocumentIndex): readonly FigNode[] {
  return document.roots
    .filter((root) => getNodeType(root) === "DOCUMENT")
    .flatMap((root) => document.childrenOf(root).filter((child) => getNodeType(child) === "CANVAS"));
}
