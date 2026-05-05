/**
 * @file Builder-specific ID generation utilities.
 *
 * Domain types (FigNodeId, FigPageId) and conversion helpers (guidToNodeId, etc.)
 * live in @higma-document-models/fig/domain. Import them from there at each usage site.
 *
 * This file provides only the builder-specific stateful ID counter machinery.
 */

import { parseId } from "@higma-document-models/fig/domain";
import type { FigDesignDocument, FigDesignNode, FigNodeId, FigPageId } from "@higma-document-models/fig/domain";

// =============================================================================
// Builder-specific: ID Generation
// =============================================================================

/**
 * Counter state for generating sequential IDs within a session.
 *
 * Session 0 is reserved for structural nodes (document, canvas) in Figma.
 * Session 1+ is used for user-created content nodes.
 */
export type IdCounter = {
  sessionID: number;
  nextLocalID: number;
};

/**
 * CreateIdCounterOptions provides explicit session identifier and next local identifier values for createIdCounter.
 */
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

/**
 * assertNonNegativeInteger rejects invalid explicit session identifier input for builder counter validation.
 */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

/**
 * assertPositiveInteger rejects invalid explicit next local identifier input for builder counter validation.
 */
function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

/**
 * createIdCounter builds an explicit IdCounter from CreateIdCounterOptions without hidden defaults.
 */
export function createIdCounter({ sessionID, nextLocalID }: CreateIdCounterOptions): IdCounter {
  assertNonNegativeInteger(sessionID, "sessionID");
  assertPositiveInteger(nextLocalID, "nextLocalID");
  return { sessionID, nextLocalID };
}

/**
 * Create explicit builder state from caller-provided counters.
 */
export function createFigBuilderState({
  nodeIdCounter,
  pageIdCounter,
}: CreateFigBuilderStateOptions): FigBuilderState {
  return {
    nodeIdCounter: createIdCounter(nodeIdCounter),
    pageIdCounter: createIdCounter(pageIdCounter),
  };
}

/**
 * Create explicit builder state by scanning an existing document for the next
 * available local IDs in caller-selected sessions.
 */
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

/**
 * Generate the next FigNodeId from a counter, mutating it in place.
 */
export function nextNodeId(counter: IdCounter): FigNodeId {
  const id = `${counter.sessionID}:${counter.nextLocalID}` as FigNodeId;
  counter.nextLocalID++;
  return id;
}

/**
 * Generate the next FigPageId from a counter, mutating it in place.
 */
export function nextPageId(counter: IdCounter): FigPageId {
  const id = `${counter.sessionID}:${counter.nextLocalID}` as FigPageId;
  counter.nextLocalID++;
  return id;
}
