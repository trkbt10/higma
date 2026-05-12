/**
 * @file ID allocator for scratch FigDesignDocument construction.
 *
 * Stateful counter used by `addPage` / `addNode` to assign fresh GUIDs
 * when building a document from scratch. Sessions are caller-chosen
 * (session 0 is conventionally reserved for structural nodes like
 * DOCUMENT and CANVAS; session 1+ for user-created content).
 *
 * Domain types (`FigNodeId`, `FigPageId`, `parseId`) come from
 * `@higma-document-models/fig/domain`. This module sits in
 * `@higma-document-models/fig/builder` because document construction
 * primitives belong at the model layer alongside `FigDesignDocument`
 * itself, not at the IO layer.
 */

import { parseId } from "../domain";
import type { FigDesignDocument, FigDesignNode, FigNodeId, FigPageId } from "../domain";

/**
 * Counter state for generating sequential IDs within a session.
 */
export type IdCounter = {
  sessionID: number;
  nextLocalID: number;
};

export type CreateIdCounterOptions = {
  readonly sessionID: number;
  readonly nextLocalID: number;
};

export type FigBuilderState = {
  readonly nodeIdCounter: IdCounter;
  readonly pageIdCounter: IdCounter;
};

export type CreateFigBuilderStateOptions = {
  readonly nodeIdCounter: CreateIdCounterOptions;
  readonly pageIdCounter: CreateIdCounterOptions;
};

export type CreateFigBuilderStateFromDocumentOptions = {
  readonly document: FigDesignDocument;
  readonly nodeSessionID: number;
  readonly pageSessionID: number;
  readonly minimumNodeLocalID: number;
  readonly minimumPageLocalID: number;
};

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function createIdCounter({ sessionID, nextLocalID }: CreateIdCounterOptions): IdCounter {
  assertNonNegativeInteger(sessionID, "sessionID");
  assertPositiveInteger(nextLocalID, "nextLocalID");
  return { sessionID, nextLocalID };
}

export function createFigBuilderState({
  nodeIdCounter,
  pageIdCounter,
}: CreateFigBuilderStateOptions): FigBuilderState {
  return {
    nodeIdCounter: createIdCounter(nodeIdCounter),
    pageIdCounter: createIdCounter(pageIdCounter),
  };
}

export function createFigBuilderStateFromDocument({
  document,
  nodeSessionID,
  pageSessionID,
  minimumNodeLocalID,
  minimumPageLocalID,
}: CreateFigBuilderStateFromDocumentOptions): FigBuilderState {
  assertNonNegativeInteger(nodeSessionID, "nodeSessionID");
  assertNonNegativeInteger(pageSessionID, "pageSessionID");
  assertPositiveInteger(minimumNodeLocalID, "minimumNodeLocalID");
  assertPositiveInteger(minimumPageLocalID, "minimumPageLocalID");

  const pageLocalID = document.pages.reduce(
    (current, page) => nextLocalIDForId(page.id, pageSessionID, current),
    minimumPageLocalID,
  );
  const nodeLocalID = document.pages.reduce(
    (current, page) => scanNodesForNextLocalID(page.children, nodeSessionID, current),
    minimumNodeLocalID,
  );

  return createFigBuilderState({
    nodeIdCounter: { sessionID: nodeSessionID, nextLocalID: nodeLocalID },
    pageIdCounter: { sessionID: pageSessionID, nextLocalID: pageLocalID },
  });
}

function scanNodesForNextLocalID(
  nodes: readonly FigDesignNode[],
  sessionID: number,
  current: number,
): number {
  return nodes.reduce((next, node) => {
    const nextFromNode = nextLocalIDForId(node.id, sessionID, next);
    if (!node.children) {
      return nextFromNode;
    }
    return scanNodesForNextLocalID(node.children, sessionID, nextFromNode);
  }, current);
}

function nextLocalIDForId(id: FigNodeId | FigPageId, sessionID: number, current: number): number {
  const parsed = parseId(id);
  if (parsed.sessionID !== sessionID) {
    return current;
  }
  return Math.max(current, parsed.localID + 1);
}

export function nextNodeId(counter: IdCounter): FigNodeId {
  const id = `${counter.sessionID}:${counter.nextLocalID}` as FigNodeId;
  counter.nextLocalID++;
  return id;
}

export function nextPageId(counter: IdCounter): FigPageId {
  const id = `${counter.sessionID}:${counter.nextLocalID}` as FigPageId;
  counter.nextLocalID++;
  return id;
}
