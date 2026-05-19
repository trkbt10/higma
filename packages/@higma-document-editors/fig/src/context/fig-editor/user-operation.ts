/** @file Operation gates for Fig editor user intent. */
import type { FigUserIntent } from "./user-intent";

export type FigUserOperation =
  | "select-node"
  | "move-node"
  | "create-node"
  | "edit-path"
  | "update-property"
  | "delete-selection";

export type FigUserOperationDomain = {
  readonly intent: FigUserIntent;
  readonly allowed: ReadonlySet<FigUserOperation>;
};

/** Build the operation set allowed by an intent. */
export function resolveFigUserOperationDomain(intent: FigUserIntent): FigUserOperationDomain {
  if (intent.kind === "select") {
    return {
      intent,
      allowed: new Set(["select-node", "move-node", "update-property", "delete-selection"]),
    };
  }
  if (intent.kind === "path-edit") {
    return {
      intent,
      allowed: new Set(["select-node", "edit-path"]),
    };
  }
  if (intent.kind === "text-edit" || intent.kind === "transform") {
    return {
      intent,
      allowed: new Set([]),
    };
  }
  return {
    intent,
    allowed: new Set(["create-node"]),
  };
}

/** Return true when an operation is allowed. */
export function allowsFigUserOperation(domain: FigUserOperationDomain, operation: FigUserOperation): boolean {
  return domain.allowed.has(operation);
}
