/** @file Page operations on the Kiwi document SoT. */

import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { DEFAULT_PAGE_BACKGROUND } from "@higma-document-models/fig/domain";
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
const POSITION_FIRST_CHAR = 0x21;
const INTERNAL_ONLY_CANVAS_POSITION = "~";

function positionString(index: number): string {
  return String.fromCharCode(POSITION_FIRST_CHAR + index);
}

function documentNode(): FigNode {
  return {
    guid: DOCUMENT_GUID,
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.DOCUMENT, name: "DOCUMENT" },
  };
}

function canvasNode(
  guid: FigGuid,
  name: string,
  position: string,
  internalOnly: boolean | undefined,
): FigNode {
  return {
    guid,
    parentIndex: { guid: DOCUMENT_GUID, position },
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
      canvasNode(FIRST_CANVAS_GUID, pageName, positionString(0), undefined),
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
  const canvasCount = context.document.nodeChanges.filter((node) => node.type.name === "CANVAS").length;
  const position = internalOnly === true ? INTERNAL_ONLY_CANVAS_POSITION : positionString(canvasCount);
  const page = canvasNode(pageGuid, name, position, internalOnly);
  return {
    context: contextWithNodes(context, [...context.document.nodeChanges, page]),
    pageGuid,
  };
}
