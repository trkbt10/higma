/**
 * @file Symbol / Instance / Variant-Set / Internal Canvas / Style Proxy
 * promotion handlers.
 *
 * These handlers exist so that refine-fig (and any other consumer that
 * wants to perform structural .fig edits) can do so by dispatching
 * actions on the editor reducer, instead of poking `LoadedFigFile`'s
 * `nodeChanges` directly. The latter route bypassed `FigDesignDocument`
 * — the model that `document-to-tree.ts` projects into Kiwi — and
 * therefore drifted from the SoT.
 *
 * Every load-bearing Kiwi field that this file writes is *also*
 * materialised in `document-to-tree.designNodeToFigNode` via
 * `applyNodeTypeDefaults` (Phase 0a). The two stay aligned by design:
 *  - this file decides *what* a Variant Set FRAME or FILL proxy
 *    *is* in the high-level model (FigDesignNode fields).
 *  - `applyNodeTypeDefaults` decides *which Kiwi defaults* a node type
 *    gets when it ships out as a FigNode.
 */

import { pushHistory } from "@higma-editor-kernel/core/history";
import { DEFAULT_PAGE_BACKGROUND } from "@higma-document-models/fig/domain";
import type {
  FigDesignDocument,
  FigDesignNode,
  FigDesignBlob,
  FigPage,
  FigNodeId,
  FigPageId,
  ComponentPropertyDef,
} from "@higma-document-models/fig/domain";
import type { FigSolidPaint } from "@higma-document-models/fig/types";
import { IDENTITY_MATRIX } from "@higma-document-models/fig/matrix";
import {
  encodeRoundedRectangleBlob,
} from "@higma-document-models/fig/node-factory";
import {
  findNodeById,
  insertNodeInTree,
  removeNodeFromTree,
  updateNodeInTree,
} from "@higma-document-io/fig/node-ops";
import { nextNodeId, nextPageId } from "@higma-document-models/fig/builder";
import type { HandlerMap } from "./handler-types";
import { createEditorFigBuilderState } from "./builder-state";

// =============================================================================
// Tree-walk helpers — the editor reducer historically worked one
// active page at a time, but Phase 1 actions touch the document
// globally (e.g. variant-set grouping reparents SYMBOLs across pages
// is forbidden, but Internal Only Canvas creation always lives outside
// the user's active page).
// =============================================================================

function findNodeInDocument(
  doc: FigDesignDocument,
  id: FigNodeId,
): { readonly node: FigDesignNode; readonly pageId: FigPageId } | undefined {
  for (const page of doc.pages) {
    const node = findNodeById(page.children, id);
    if (node) {
      return { node, pageId: page.id };
    }
  }
  return undefined;
}

function updateNodeInDocument(
  doc: FigDesignDocument,
  id: FigNodeId,
  updater: (node: FigDesignNode) => FigDesignNode,
): FigDesignDocument {
  const pages = doc.pages.map((page) => {
    const updated = updateNodeInTree(page.children, id, updater);
    if (updated === page.children) {
      return page;
    }
    return { ...page, children: updated };
  });
  return { ...doc, pages };
}

function insertNodeUnderPage(
  doc: FigDesignDocument,
  pageId: FigPageId,
  node: FigDesignNode,
): FigDesignDocument {
  return {
    ...doc,
    pages: doc.pages.map((page) =>
      page.id === pageId
        ? { ...page, children: [...page.children, node] }
        : page,
    ),
  };
}

function removeNodeFromDocument(
  doc: FigDesignDocument,
  id: FigNodeId,
): FigDesignDocument {
  return {
    ...doc,
    pages: doc.pages.map((page) => {
      const updated = removeNodeFromTree(page.children, id);
      if (updated === page.children) {
        return page;
      }
      return { ...page, children: updated };
    }),
  };
}

function insertChildUnderNode(
  doc: FigDesignDocument,
  parentId: FigNodeId,
  child: FigDesignNode,
): FigDesignDocument {
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      children: insertNodeInTree({ nodes: page.children, parentId, node: child }),
    })),
  };
}

function ensureComponent(
  doc: FigDesignDocument,
  symbol: FigDesignNode,
): FigDesignDocument {
  const components = new Map(doc.components);
  components.set(symbol.id, symbol);
  return { ...doc, components };
}

function dropChildSubtree(node: FigDesignNode): FigDesignNode {
  if (node.children === undefined) {
    return node;
  }
  return { ...node, children: undefined };
}

function makeInstanceFromCarrier(
  node: FigDesignNode,
  symbolId: FigNodeId,
  opts: { readonly dropChildren?: boolean } = {},
): FigDesignNode {
  // Clear geometry that belongs to the source FRAME/GROUP — INSTANCEs
  // inherit their fills/strokes/geometry from the linked SYMBOL via
  // `derivedSymbolData` resolution at projection time.
  const base: FigDesignNode = {
    ...node,
    type: "INSTANCE",
    symbolId,
    fills: [],
    strokes: [],
    strokeWeight: 0,
    fillGeometry: undefined,
    strokeGeometry: undefined,
  };
  if (opts.dropChildren === true) {
    return dropChildSubtree(base);
  }
  return base;
}

// =============================================================================
// Geometry helper for proxy nodes
// =============================================================================

const PROXY_NODE_SIZE = 100;

function appendBlob(
  doc: FigDesignDocument,
  blob: FigDesignBlob,
): { readonly doc: FigDesignDocument; readonly blobIndex: number } {
  const blobs = [...doc.blobs, blob];
  return {
    doc: { ...doc, blobs },
    blobIndex: blobs.length - 1,
  };
}

function buildProxyFillGeometry(doc: FigDesignDocument): {
  readonly doc: FigDesignDocument;
  readonly fillGeometry: readonly {
    readonly commandsBlob: number;
    readonly windingRule: { readonly value: number; readonly name: string };
    readonly styleID: number;
  }[];
} {
  // Every existing FILL/TEXT proxy in real Figma exports is a 100×100
  // rounded rectangle (radius 0 collapses to a plain rectangle). We
  // reproduce the same shape so the proxy looks correct in the
  // hidden Internal Only Canvas.
  //
  // `windingRule` must be a `KiwiEnumValue` shape because the Kiwi
  // serializer rejects string literals — `WindingRule` is a Kiwi enum
  // (NONZERO=0, EVENODD=1).
  const bytes = encodeRoundedRectangleBlob(PROXY_NODE_SIZE, PROXY_NODE_SIZE, 0);
  const blob: FigDesignBlob = { bytes };
  const { doc: nextDoc, blobIndex } = appendBlob(doc, blob);
  return {
    doc: nextDoc,
    fillGeometry: [{
      commandsBlob: blobIndex,
      windingRule: { value: 0, name: "NONZERO" },
      styleID: 0,
    }],
  };
}

// =============================================================================
// Handlers
// =============================================================================

export const PROMOTE_HANDLERS: HandlerMap = {
  PROMOTE_TO_SYMBOL(state, action) {
    const doc = state.documentHistory.present;
    const located = findNodeInDocument(doc, action.nodeId);
    if (!located) {
      return state;
    }
    const updated = updateNodeInDocument(doc, action.nodeId, (node) => ({
      ...node,
      type: "SYMBOL",
      name: action.name,
      isSymbolPublishable: true,
    }));
    // Re-find the just-promoted node so the components map gets the
    // updated record (children, name, etc.) rather than the stale
    // pre-promotion copy.
    const promoted = findNodeInDocument(updated, action.nodeId)?.node;
    const withComponent = promoted ? ensureComponent(updated, promoted) : updated;
    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, withComponent),
    };
  },

  PROMOTE_TO_INSTANCE(state, action) {
    const doc = state.documentHistory.present;
    const located = findNodeInDocument(doc, action.nodeId);
    if (!located) {
      return state;
    }
    const updated = updateNodeInDocument(doc, action.nodeId, (node) =>
      makeInstanceFromCarrier(node, action.symbolId, { dropChildren: action.dropChildren }),
    );
    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, updated),
    };
  },

  CREATE_SYMBOL_WITH_INSTANCES(state, action) {
    const doc = state.documentHistory.present;
    const exemplarLocation = findNodeInDocument(doc, action.exemplarNodeId);
    if (!exemplarLocation) {
      return state;
    }
    const exemplar = exemplarLocation.node;
    const hostPage = doc.pages.find((page) => page.id === action.hostPageId);
    if (!hostPage) {
      return state;
    }

    const builderState = createEditorFigBuilderState(doc);
    const symbolId = nextNodeId(builderState.nodeIdCounter);
    const clonedChildId = nextNodeId(builderState.nodeIdCounter);

    // Clone exemplar's content into the new SYMBOL. The cloned root
    // sits at the SYMBOL's origin so the SYMBOL bbox matches.
    const clonedChild: FigDesignNode = {
      ...exemplar,
      id: clonedChildId,
      transform: IDENTITY_MATRIX,
      layoutConstraints: exemplar.layoutConstraints ?? {
        horizontalConstraint: { value: 4, name: "SCALE" },
        verticalConstraint: { value: 4, name: "SCALE" },
      },
    };

    const symbolNode: FigDesignNode = {
      id: symbolId,
      type: "SYMBOL",
      name: action.name,
      visible: true,
      opacity: 1,
      transform: IDENTITY_MATRIX,
      size: exemplar.size,
      fills: [],
      strokes: [],
      strokeWeight: 1,
      effects: [],
      isSymbolPublishable: true,
      children: [clonedChild],
    };

    // 1. Drop the SYMBOL onto the Internal Only Canvas (or wherever
    //    the caller selected as host) and register it as a component.
    let next = insertNodeUnderPage(doc, action.hostPageId, symbolNode);
    next = ensureComponent(next, symbolNode);

    // 2. Flip every requested member to INSTANCE pointing at the new
    //    SYMBOL. The members keep their position/size on the user's
    //    page; the visual is provided by the SYMBOL link.
    for (const memberId of action.memberNodeIds) {
      next = updateNodeInDocument(next, memberId, (node) =>
        makeInstanceFromCarrier(node, symbolId, { dropChildren: true }),
      );
    }

    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, next),
    };
  },

  GROUP_AS_VARIANT_SET(state, action) {
    const doc = state.documentHistory.present;
    if (action.variants.length === 0) {
      return state;
    }

    // Every variant must already exist and live on the same page; we
    // intentionally do not migrate SYMBOLs across pages here.
    const firstLocation = findNodeInDocument(doc, action.variants[0]!.symbolId);
    if (!firstLocation) {
      return state;
    }
    for (const variant of action.variants) {
      const located = findNodeInDocument(doc, variant.symbolId);
      if (!located || located.pageId !== firstLocation.pageId) {
        return state;
      }
    }
    const parentPageId = firstLocation.pageId;

    const builderState = createEditorFigBuilderState(doc);
    const setFrameId = nextNodeId(builderState.nodeIdCounter);
    const propDefId = nextNodeId(builderState.nodeIdCounter);

    // Snapshot each variant SYMBOL so we can detach + reparent.
    const variantSnapshots: { readonly value: string; readonly node: FigDesignNode }[] = [];
    for (const variant of action.variants) {
      const located = findNodeInDocument(doc, variant.symbolId);
      if (!located) {
        return state;
      }
      variantSnapshots.push({ value: variant.value, node: located.node });
    }

    // Detach variants from their current position.
    let detached = doc;
    for (const snapshot of variantSnapshots) {
      detached = removeNodeFromDocument(detached, snapshot.node.id);
    }

    const propDef: ComponentPropertyDef = {
      id: propDefId,
      name: action.propertyName,
      type: "VARIANT",
      sortPosition: "a",
    };

    const variantChildren: FigDesignNode[] = variantSnapshots.map((snapshot) => ({
      ...snapshot.node,
      name: `${action.propertyName}=${snapshot.value}`,
      variantPropSpecs: [{ propDefId, value: snapshot.value }],
    }));

    const setFrame: FigDesignNode = {
      id: setFrameId,
      type: "FRAME",
      name: action.setName,
      visible: true,
      opacity: 1,
      transform: IDENTITY_MATRIX,
      // Figma re-fits the bounding box of a Variant Set the first
      // time it opens the file, so a placeholder size is fine.
      size: { x: 100, y: 100 },
      fills: [],
      strokes: [],
      strokeWeight: 1,
      effects: [],
      isStateGroup: true,
      componentPropertyDefs: [propDef],
      children: variantChildren,
    };

    let next = insertNodeUnderPage(detached, parentPageId, setFrame);

    // Keep `components` in sync: each variant SYMBOL is still a
    // component, but its record now reflects the renamed/tagged
    // version that lives under the Variant Set FRAME.
    for (const variantChild of variantChildren) {
      next = ensureComponent(next, variantChild);
    }

    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, next),
    };
  },

  ENSURE_INTERNAL_CANVAS(state, action) {
    const doc = state.documentHistory.present;
    const existing = doc.pages.find((page) => page.internalOnly === true);
    if (existing) {
      return state;
    }
    const builderState = createEditorFigBuilderState(doc);
    const pageId = nextPageId(builderState.pageIdCounter);
    const newPage: FigPage = {
      id: pageId,
      name: action.name,
      backgroundColor: DEFAULT_PAGE_BACKGROUND,
      children: [],
      internalOnly: true,
      backgroundOpacity: 1,
      backgroundEnabled: true,
    };
    const next: FigDesignDocument = { ...doc, pages: [...doc.pages, newPage] };
    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, next),
    };
  },

  ADD_FILL_PROXY(state, action) {
    const doc = state.documentHistory.present;
    const page = doc.pages.find((p) => p.id === action.internalPageId);
    if (!page) {
      return state;
    }
    const builderState = createEditorFigBuilderState(doc);
    const nodeId = nextNodeId(builderState.nodeIdCounter);

    const { doc: docWithBlob, fillGeometry } = buildProxyFillGeometry(doc);

    const paint: FigSolidPaint = {
      type: "SOLID",
      color: action.color,
      opacity: action.opacity ?? 1,
      visible: true,
      blendMode: "NORMAL",
    };

    const proxyNode: FigDesignNode = {
      id: nodeId,
      type: "ROUNDED_RECTANGLE",
      name: action.name,
      visible: false,
      opacity: 1,
      transform: IDENTITY_MATRIX,
      size: { x: PROXY_NODE_SIZE, y: PROXY_NODE_SIZE },
      fills: [paint],
      strokes: [],
      strokeWeight: 0,
      effects: [],
      styleType: { value: 1, name: "FILL" },
      fillGeometry,
    };

    const next = insertNodeUnderPage(docWithBlob, action.internalPageId, proxyNode);
    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, next),
    };
  },

  ADD_TEXT_PROXY(state, action) {
    const doc = state.documentHistory.present;
    const page = doc.pages.find((p) => p.id === action.internalPageId);
    if (!page) {
      return state;
    }
    const builderState = createEditorFigBuilderState(doc);
    const nodeId = nextNodeId(builderState.nodeIdCounter);

    const { doc: docWithBlob, fillGeometry } = buildProxyFillGeometry(doc);

    // TEXT proxies still render as ROUNDED_RECTANGLE shapes on the
    // Internal Only Canvas — Figma uses the `styleType: TEXT` flag and
    // `textData.styleProperties` to advertise them as text styles in
    // the side panel; the node shape itself is irrelevant.
    const paint: FigSolidPaint = {
      type: "SOLID",
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      blendMode: "NORMAL",
    };

    const proxyNode: FigDesignNode = {
      id: nodeId,
      type: "ROUNDED_RECTANGLE",
      name: action.name,
      visible: false,
      opacity: 1,
      transform: IDENTITY_MATRIX,
      size: { x: PROXY_NODE_SIZE, y: PROXY_NODE_SIZE },
      fills: [paint],
      strokes: [],
      strokeWeight: 0,
      effects: [],
      styleType: { value: 3, name: "TEXT" },
      fillGeometry,
      textData: {
        characters: "",
        fontName: { family: action.fontName.family, style: action.fontName.style, postscript: action.fontName.postscript },
        fontSize: action.fontSize,
        lineHeight: action.lineHeight,
        letterSpacing: action.letterSpacing,
        styleOverrideTable: [],
      },
    };

    const next = insertNodeUnderPage(docWithBlob, action.internalPageId, proxyNode);
    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, next),
    };
  },

  BIND_FILL_STYLE(state, action) {
    const doc = state.documentHistory.present;
    const located = findNodeInDocument(doc, action.nodeId);
    if (!located) {
      return state;
    }
    const next = updateNodeInDocument(doc, action.nodeId, (node) => ({
      ...node,
      styleIdForFill: action.styleId,
    }));
    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, next),
    };
  },

  BIND_TEXT_STYLE(state, action) {
    const doc = state.documentHistory.present;
    const located = findNodeInDocument(doc, action.nodeId);
    if (!located) {
      return state;
    }
    const next = updateNodeInDocument(doc, action.nodeId, (node) => ({
      ...node,
      styleIdForText: action.styleId,
    }));
    return {
      ...state,
      documentHistory: pushHistory(state.documentHistory, next),
    };
  },
};

// Re-export helpers in case spec/tests need them.
export {
  findNodeInDocument,
  updateNodeInDocument,
  insertNodeUnderPage,
  insertChildUnderNode,
  removeNodeFromDocument,
};
