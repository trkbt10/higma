/**
 * @file Parent-index integrity rule.
 *
 * Every non-DOCUMENT node carries a `parentIndex` whose `guid`
 * points at the node's parent. Dangling parents (referencing a
 * GUID that does not appear earlier in the nodeChanges stream)
 * leave the node orphaned in Figma's scene graph.
 */

import type { FigGuid } from "@higma-document-models/fig/types";
import type { LintRule } from "../types";

function guidKey(guid: FigGuid | undefined): string | null {
  if (!guid) {
    return null;
  }
  if (typeof guid.sessionID !== "number" || typeof guid.localID !== "number") {
    return null;
  }
  return `${guid.sessionID}:${guid.localID}`;
}

export const parentRefsRule: LintRule = (ctx, emit) => {
  if (ctx.nodeChanges.length === 0) {
    return;
  }
  const knownGuids = new Set<string>();
  for (const node of ctx.nodeChanges) {
    const key = guidKey(node.guid);
    if (key) {
      knownGuids.add(key);
    }
  }

  for (const [index, node] of ctx.nodeChanges.entries()) {
    const typeName = node.type?.name;
    if (typeName === "DOCUMENT") {
      continue;
    }
    const parentIndex = node.parentIndex;
    if (!parentIndex) {
      emit({
        ruleId: "fig.parent.refs",
        severity: "error",
        path: `nodeChanges[${index}].parentIndex`,
        message: `${typeName ?? "node"} is missing parentIndex`,
        remediation: "Use `addNode` / `addPage` which always emit parentIndex",
      });
      continue;
    }
    const parentKey = guidKey(parentIndex.guid);
    if (!parentKey) {
      emit({
        ruleId: "fig.parent.refs",
        severity: "error",
        path: `nodeChanges[${index}].parentIndex.guid`,
        message: `${typeName ?? "node"} has invalid parent GUID shape`,
        remediation: "parentIndex.guid must be { sessionID: number, localID: number }",
      });
      continue;
    }
    if (!knownGuids.has(parentKey)) {
      emit({
        ruleId: "fig.parent.refs",
        severity: "error",
        path: `nodeChanges[${index}].parentIndex.guid`,
        message: `${typeName ?? "node"} parent ${parentKey} not present anywhere in nodeChanges`,
        remediation: "Ensure the parent node is added before children, or fix the parent GUID",
      });
    }
  }
};
