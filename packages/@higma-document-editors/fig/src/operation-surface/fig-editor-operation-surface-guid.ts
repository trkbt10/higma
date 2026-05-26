/** @file Fig editor operation surface GUID and numeric input validation. */
import { isFigGuid } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { FigEditorOperationSurfaceGuidInput } from "./fig-editor-operation-surface-types";

/** Require a finite number from an explicit operation surface input. */
export function requireFigEditorOperationSurfaceFiniteNumber(value: number, owner: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${owner} must be a finite number`);
  }
  return value;
}

/** Require a finite non-negative number from an explicit operation surface input. */
export function requireFigEditorOperationSurfaceFiniteNonNegativeNumber(value: number, owner: string): number {
  requireFigEditorOperationSurfaceFiniteNumber(value, owner);
  if (value < 0) {
    throw new Error(`${owner} must be non-negative`);
  }
  return value;
}

/** Require an existing Kiwi GUID field. */
export function requireFigEditorOperationSurfaceGuid(guid: FigGuid | undefined, owner: string): FigGuid {
  if (guid === undefined) {
    throw new Error(`${owner} requires a Kiwi guid`);
  }
  return guid;
}

/** Parse a stable `sessionID:localID` Kiwi GUID key. */
export function parseFigEditorOperationSurfaceGuidKey(guidKey: string): FigGuid {
  const parts = guidKey.split(":");
  if (parts.length !== 2) {
    throw new Error(`Fig GUID key "${guidKey}" must be formatted as sessionID:localID`);
  }
  const sessionID = Number(parts[0]);
  const localID = Number(parts[1]);
  if (!Number.isInteger(sessionID) || !Number.isInteger(localID)) {
    throw new Error(`Fig GUID key "${guidKey}" must contain integer sessionID and localID`);
  }
  return { sessionID, localID };
}

/** Resolve a operation surface GUID input without converting away from FigGuid SoT. */
export function resolveFigEditorOperationSurfaceGuidInput(input: FigEditorOperationSurfaceGuidInput, owner: string): FigGuid {
  if (typeof input === "string") {
    return parseFigEditorOperationSurfaceGuidKey(input);
  }
  if (!isFigGuid(input)) {
    throw new Error(`${owner} requires a Kiwi FigGuid or GUID key`);
  }
  if (!Number.isInteger(input.sessionID) || !Number.isInteger(input.localID)) {
    throw new Error(`${owner} requires integer Kiwi FigGuid fields`);
  }
  return input;
}
