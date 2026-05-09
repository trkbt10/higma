/**
 * @file ViewportIR → FigDesignDocument (in-memory, ready to export).
 *
 * Walks the IR root frame depth-first, calling `addNode` for every
 * descendant so the resulting document has the same parent-child
 * topology. The page is created empty; the IR root frame becomes a
 * top-level FRAME at (0, 0). Asset bytes from `viewport.assets`
 * become entries in the document's `images` map keyed by the same
 * id used by IR image paints.
 *
 * IR id ↔ FigNodeId mapping is returned alongside the document so
 * round-trip tooling can correlate IR nodes with the resulting Figma
 * tree.
 */
import {
  addNode,
  createEmptyFigDesignDocument,
  createFigBuilderState,
} from "@higma-document-io/fig";
import type { FigDesignDocument, FigNodeId } from "@higma-document-models/fig/domain";
import type { FigBuilderState } from "@higma-document-io/fig/types";
import type { NodeIR, ViewportIR } from "@higma-bridges/web-fig";
import { irToSpecGraph } from "./ir-to-spec";

export type BuildDocumentResult = {
  readonly doc: FigDesignDocument;
  /** IR id → assigned FigNodeId. Useful for round-trip tracing. */
  readonly idMap: ReadonlyMap<string, FigNodeId>;
};

/** Convert a ViewportIR into a FigDesignDocument plus an IR id → FigNodeId map. */
export function buildDocument(viewport: ViewportIR): BuildDocumentResult {
  const initialDoc = createEmptyFigDesignDocument(viewport.source);
  const docWithAssets = installAssets(initialDoc, viewport);
  const builderState = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 1 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = docWithAssets.pages[0]!.id;
  const idMap = new Map<string, FigNodeId>();
  const finalDoc = appendIR({
    doc: docWithAssets,
    state: builderState,
    pageId,
    parentId: null,
    irNode: viewport.root,
    idMap,
  });
  return { doc: finalDoc, idMap };
}

function installAssets(doc: FigDesignDocument, viewport: ViewportIR): FigDesignDocument {
  if (viewport.assets.size === 0) {
    return doc;
  }
  const images = new Map(doc.images);
  for (const asset of viewport.assets.values()) {
    images.set(asset.id, {
      ref: asset.id,
      data: asset.bytes,
      mimeType: asset.mime,
    });
  }
  return { ...doc, images };
}

type AppendOptions = {
  readonly doc: FigDesignDocument;
  readonly state: FigBuilderState;
  readonly pageId: FigDesignDocument["pages"][number]["id"];
  readonly parentId: FigNodeId | null;
  readonly irNode: NodeIR;
  readonly idMap: Map<string, FigNodeId>;
};

function appendIR(opts: AppendOptions): FigDesignDocument {
  const graph = irToSpecGraph(opts.irNode);
  const { doc: afterAdd, nodeId } = addNode({
    state: opts.state,
    doc: opts.doc,
    pageId: opts.pageId,
    parentId: opts.parentId,
    spec: graph.spec,
  });
  opts.idMap.set(opts.irNode.id, nodeId);

  if (opts.irNode.kind !== "frame") {
    return afterAdd;
  }
  return opts.irNode.children.reduce<FigDesignDocument>(
    (doc, child) => appendIR({
      doc,
      state: opts.state,
      pageId: opts.pageId,
      parentId: nodeId,
      irNode: child,
      idMap: opts.idMap,
    }),
    afterAdd,
  );
}
