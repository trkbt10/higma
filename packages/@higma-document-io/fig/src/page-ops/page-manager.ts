/** @file Page operations on the Kiwi document SoT. */

import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import {
  DEFAULT_PAGE_BACKGROUND,
  getNodeType,
  guidToString,
} from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { nextPageGuid } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import {
  createFigDocumentContextFromNodeChanges,
  replaceFigDocumentContextNodeChanges,
  type FigDocumentContext,
} from "../context";

const DOCUMENT_GUID: FigGuid = { sessionID: 0, localID: 0 };
const FIRST_CANVAS_GUID: FigGuid = { sessionID: 0, localID: 1 };
const FIRST_VISIBLE_CANVAS_POSITION = "!";
const INTERNAL_ONLY_CANVAS_POSITION = "~";

function documentNode(): FigNode {
  return {
    guid: DOCUMENT_GUID,
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.DOCUMENT, name: "DOCUMENT" },
  };
}

function canvasNode(
  guid: FigGuid,
  documentGuid: FigGuid,
  name: string,
  position: string,
  internalOnly: boolean | undefined,
): FigNode {
  return {
    guid,
    parentIndex: { guid: documentGuid, position },
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.CANVAS, name: "CANVAS" },
    name,
    backgroundColor: DEFAULT_PAGE_BACKGROUND,
    internalOnly,
  };
}

function contextWithNodes(context: FigDocumentContext, nodeChanges: readonly FigNode[]): FigDocumentContext {
  return replaceFigDocumentContextNodeChanges({ context, nodeChanges });
}

function requireNodeGuid(node: FigNode, owner: string): FigGuid {
  if (node.guid === undefined) {
    throw new Error(`${owner}: Kiwi node is missing guid`);
  }
  return node.guid;
}

function requireDocumentRoot(context: FigDocumentContext): FigNode {
  const documentRoots = context.document.roots.filter((node) => getNodeType(node) === "DOCUMENT");
  if (documentRoots.length !== 1) {
    throw new Error(`addPage requires exactly one DOCUMENT root; found ${documentRoots.length}`);
  }
  const documentRoot = documentRoots[0];
  if (documentRoot === undefined) {
    throw new Error("addPage requires a readable DOCUMENT root");
  }
  const documentGuid = requireNodeGuid(documentRoot, "addPage DOCUMENT root");
  const key = guidToString(documentGuid);
  if (!context.document.nodesByGuid.has(key)) {
    throw new Error(`addPage DOCUMENT root ${key} is not indexed`);
  }
  return documentRoot;
}

function requireParentIndexPosition(node: FigNode, owner: string): string {
  const position = node.parentIndex?.position;
  if (position === undefined || position.length === 0) {
    throw new Error(`${owner}: Kiwi node ${guidToString(requireNodeGuid(node, owner))} is missing parentIndex.position`);
  }
  return position;
}

function nextVisibleCanvasPosition(context: FigDocumentContext, documentRoot: FigNode): string {
  const visibleCanvases = context.document.childrenOf(documentRoot).filter((node) => (
    getNodeType(node) === "CANVAS" && node.internalOnly !== true
  ));
  const lastCanvas = visibleCanvases[visibleCanvases.length - 1];
  if (lastCanvas === undefined) {
    return FIRST_VISIBLE_CANVAS_POSITION;
  }
  return `${requireParentIndexPosition(lastCanvas, "addPage visible CANVAS")}!`;
}

function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

/**
 * Create a minimal Kiwi document with one CANVAS page.
 */
export function createEmptyFigDocument(pageName: string): FigDocumentContext {
  assertNonEmptyString(pageName, "createEmptyFigDocument pageName");
  return createFigDocumentContextFromNodeChanges({
    nodeChanges: [
      documentNode(),
      canvasNode(FIRST_CANVAS_GUID, DOCUMENT_GUID, pageName, FIRST_VISIBLE_CANVAS_POSITION, undefined),
    ],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
}

type AddPageOptions = {
  readonly state: FigBuilderState;
  readonly context: FigDocumentContext;
  readonly name: string;
  readonly internalOnly?: boolean;
};

/**
 * Append a CANVAS page and return its allocated GUID.
 */
export function addPage(
  { state, context, name, internalOnly }: AddPageOptions,
): { readonly context: FigDocumentContext; readonly pageGuid: FigGuid } {
  assertNonEmptyString(name, "addPage name");
  const pageGuid = nextPageGuid(state.pageGuidCounter);
  const documentRoot = requireDocumentRoot(context);
  const documentGuid = requireNodeGuid(documentRoot, "addPage DOCUMENT root");
  const position = internalOnly === true ? INTERNAL_ONLY_CANVAS_POSITION : nextVisibleCanvasPosition(context, documentRoot);
  const page = canvasNode(pageGuid, documentGuid, name, position, internalOnly);
  return {
    context: contextWithNodes(context, [...context.document.nodeChanges, page]),
    pageGuid,
  };
}
