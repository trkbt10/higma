/**
 * @file GUID allocator for scratch Kiwi document construction.
 *
 * Stateful counter used by `addPage` / `addNode` to assign fresh GUIDs
 * when building a document from scratch. Sessions are caller-chosen
 * (session 0 is conventionally reserved for structural nodes like
 * DOCUMENT and CANVAS; session 1+ for user-created content).
 */

import type { FigGuid } from "../types";
import type { FigKiwiDocumentIndex } from "../domain";
import { getNodeType } from "../domain";

/** Counter state for generating sequential GUID localIDs within a session. */
export type GuidCounter = {
  sessionID: number;
  nextLocalID: number;
};

export type CreateGuidCounterOptions = {
  readonly sessionID: number;
  readonly nextLocalID: number;
};

/** Builder-local counters for node and page GUID allocation. */
export type FigBuilderState = {
  readonly nodeGuidCounter: GuidCounter;
  readonly pageGuidCounter: GuidCounter;
};

export type CreateFigBuilderStateOptions = {
  readonly nodeGuidCounter: CreateGuidCounterOptions;
  readonly pageGuidCounter: CreateGuidCounterOptions;
};

export type CreateFigBuilderStateFromDocumentOptions = {
  readonly document: FigKiwiDocumentIndex;
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

/** Create a GUID counter for a concrete session and next local id. */
export function createGuidCounter({ sessionID, nextLocalID }: CreateGuidCounterOptions): GuidCounter {
  assertNonNegativeInteger(sessionID, "sessionID");
  assertPositiveInteger(nextLocalID, "nextLocalID");
  return { sessionID, nextLocalID };
}

/** Create the paired GUID counter state used by Fig document builders. */
export function createFigBuilderState({
  nodeGuidCounter,
  pageGuidCounter,
}: CreateFigBuilderStateOptions): FigBuilderState {
  return {
    nodeGuidCounter: createGuidCounter(nodeGuidCounter),
    pageGuidCounter: createGuidCounter(pageGuidCounter),
  };
}

/** Derive the next writable GUID counters from an indexed Kiwi document. */
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

  const pageLocalID = document.nodeChanges.reduce((current, node) => {
    if (getNodeType(node) !== "CANVAS") {
      return current;
    }
    return nextLocalIDForGuid(requiredGuid(node.guid, "CANVAS"), pageSessionID, current);
  }, minimumPageLocalID);
  const nodeLocalID = document.nodeChanges.reduce((current, node) => {
    if (getNodeType(node) === "CANVAS" || getNodeType(node) === "DOCUMENT") {
      return current;
    }
    return nextLocalIDForGuid(requiredGuid(node.guid, "node"), nodeSessionID, current);
  }, minimumNodeLocalID);

  return createFigBuilderState({
    nodeGuidCounter: { sessionID: nodeSessionID, nextLocalID: nodeLocalID },
    pageGuidCounter: { sessionID: pageSessionID, nextLocalID: pageLocalID },
  });
}

function requiredGuid(guid: FigGuid | undefined, owner: string): FigGuid {
  if (guid === undefined) {
    throw new Error(`createFigBuilderStateFromDocument: ${owner} is missing guid`);
  }
  return guid;
}

function nextLocalIDForGuid(guid: FigGuid, sessionID: number, current: number): number {
  if (guid.sessionID !== sessionID) {
    return current;
  }
  return Math.max(current, guid.localID + 1);
}

/** Allocate the next node GUID from a mutable counter. */
export function nextNodeGuid(counter: GuidCounter): FigGuid {
  const guid: FigGuid = { sessionID: counter.sessionID, localID: counter.nextLocalID };
  counter.nextLocalID++;
  return guid;
}

/** Allocate the next page GUID from a mutable counter. */
export function nextPageGuid(counter: GuidCounter): FigGuid {
  const guid: FigGuid = { sessionID: counter.sessionID, localID: counter.nextLocalID };
  counter.nextLocalID++;
  return guid;
}
