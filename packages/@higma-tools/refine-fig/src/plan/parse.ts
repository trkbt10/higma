/**
 * @file Boundary parser for `RefinePlan` JSON.
 *
 * `JSON.parse` returns `unknown`; we cannot assign that to a typed
 * `RefinePlan` without either a structural cast or a guard. The lint
 * forbids `as` casts at the boundary — and rightly so, because a
 * curated plan may have been hand-edited and minor shape mistakes
 * would otherwise reach the apply step as silently-wrong objects.
 *
 * `parseRefinePlan` validates only the fields the apply / workbench
 * commands actually read. It does not re-validate analyser-emitted
 * fields the apply step ignores (proposals, stats, source) — those
 * pass through as-is, narrowed via a type guard.
 */
import type { RefinePlan } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function isRenameAction(value: unknown): value is RefinePlan["renames"][number] {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.kind === "rename"
    && isString(value.nodeGuid)
    && isString(value.oldName)
    && isString(value.newName)
    && isString(value.reason)
  );
}

function isBindAction(value: unknown): value is RefinePlan["fillStyleBindings"][number] {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.kind === "fill-style-bind"
    && isString(value.nodeGuid)
    && isString(value.nodeName)
    && isString(value.proxyGuid)
    && isString(value.proxyName)
    && isString(value.colorHex)
  );
}

function isComponentCandidate(value: unknown): value is RefinePlan["componentCandidates"][number] {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.kind === "component-candidate"
    && isString(value.clusterId)
    && isString(value.suggestedName)
    && isString(value.roleSignature)
    && isObject(value.sizeClass)
    && typeof value.sizeClass.width === "number"
    && typeof value.sizeClass.height === "number"
    && isStringArray(value.memberGuids)
    && value.applied === false
  );
}

function isRefinePlan(value: unknown): value is RefinePlan {
  if (!isObject(value)) {
    return false;
  }
  if (!isObject(value.source)) {
    return false;
  }
  if (!Array.isArray(value.renames) || !value.renames.every(isRenameAction)) {
    return false;
  }
  if (!Array.isArray(value.fillStyleBindings) || !value.fillStyleBindings.every(isBindAction)) {
    return false;
  }
  if (!Array.isArray(value.fillStyleProposals)) {
    return false;
  }
  if (!Array.isArray(value.textStyleProposals)) {
    return false;
  }
  if (!Array.isArray(value.typographyClusters)) {
    return false;
  }
  if (!Array.isArray(value.componentCandidates) || !value.componentCandidates.every(isComponentCandidate)) {
    return false;
  }
  if (!isObject(value.stats)) {
    return false;
  }
  return true;
}

/**
 * Parse a JSON string into a `RefinePlan`, throwing when the shape
 * does not match. Used at the CLI input boundary.
 */
export function parseRefinePlan(jsonText: string): RefinePlan {
  const parsed: unknown = JSON.parse(jsonText);
  if (!isRefinePlan(parsed)) {
    throw new Error("parseRefinePlan: input is not a valid RefinePlan JSON");
  }
  return parsed;
}
