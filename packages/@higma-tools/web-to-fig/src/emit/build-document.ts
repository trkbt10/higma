/**
 * @file ViewportIR → Kiwi FigDocumentContext.
 *
 * Walks the IR root frame depth-first and appends Kiwi nodeChanges
 * directly. IR id ↔ FigGuid mapping is returned alongside the context
 * so round-trip tooling can correlate IR nodes with the resulting
 * Figma document.
 */
import {
  addNode,
  createEmptyFigDocument,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigDocumentContext } from "@higma-document-io/fig";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { NodeIR, ViewportIR } from "@higma-bridges/web-fig";
import { irToSpecGraph } from "./ir-to-spec";

export type BuildDocumentResult = {
  readonly context: FigDocumentContext;
  /** IR id → assigned FigGuid. Useful for round-trip tracing. */
  readonly idMap: ReadonlyMap<string, FigGuid>;
};

/** Convert a ViewportIR into a FigDocumentContext plus an IR id → FigGuid map. */
export function buildDocument(viewport: ViewportIR): BuildDocumentResult {
  const initialContext = createEmptyFigDocument(viewport.source);
  const contextWithAssets = installAssets(initialContext, viewport.assets);
  const builderState = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 1 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const page = contextWithAssets.document.nodeChanges.find((node) => node.type.name === "CANVAS");
  if (page === undefined) {
    throw new Error("buildDocument: createEmptyFigDocument did not create a CANVAS");
  }
  const idMap = new Map<string, FigGuid>();
  const finalContext = appendIR({
    context: contextWithAssets,
    state: builderState,
    pageGuid: page.guid,
    parentGuid: null,
    irNode: viewport.root,
    idMap,
  });
  return { context: finalContext, idMap };
}

/**
 * Install captured assets into the document's images map. Used by the
 * single-viewport entry as well as the multi-viewport path that
 * folds every viewport's assets into one shared map.
 */
export function installAssets(
  context: FigDocumentContext,
  assets: ViewportIR["assets"],
): FigDocumentContext {
  if (assets.size === 0) {
    return context;
  }
  const images = new Map(context.images);
  for (const asset of assets.values()) {
    images.set(asset.id, {
      ref: asset.id,
      data: asset.bytes,
      mimeType: asset.mime,
    });
  }
  return {
    ...context,
    images,
  };
}

export type AppendIROptions = {
  readonly context: FigDocumentContext;
  readonly state: FigBuilderState;
  readonly pageGuid: FigGuid;
  readonly parentGuid: FigGuid | null;
  readonly irNode: NodeIR;
  readonly idMap: Map<string, FigGuid>;
};

/**
 * Append an IR subtree under `parentGuid` (null = page root). Walks
 * children depth-first and threads the updated context through each
 * `addNode` call. Returns the final context; the IR id → FigGuid
 * map is populated in place via `opts.idMap`.
 *
 * Shared with `buildMultiFigFileBytes`'s per-viewport emit pass.
 */
export function appendIR(opts: AppendIROptions): FigDocumentContext {
  const graph = irToSpecGraph(opts.irNode);
  const { context: afterAdd, nodeGuid } = addNode({
    state: opts.state,
    context: opts.context,
    pageGuid: opts.pageGuid,
    parentGuid: opts.parentGuid,
    spec: graph.spec,
  });
  opts.idMap.set(opts.irNode.id, nodeGuid);

  if (opts.irNode.kind !== "frame") {
    return afterAdd;
  }
  return opts.irNode.children.reduce<FigDocumentContext>(
    (context, child) => appendIR({
      context,
      state: opts.state,
      pageGuid: opts.pageGuid,
      parentGuid: nodeGuid,
      irNode: child,
      idMap: opts.idMap,
    }),
    afterAdd,
  );
}
