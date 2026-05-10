/**
 * @file Symbol / Instance integrity rules.
 *
 * Two structural invariants that, when broken, leave a fig file
 * looking valid in isolation but render-broken once the user
 * resizes an INSTANCE or opens a `card-resized` style fixture:
 *
 * 1. `fig.symbol.child-constraints` (warning) — when an INSTANCE
 *    resizes its SYMBOL (instance size != symbol size) the SYMBOL's
 *    immediate children must carry `horizontalConstraint` and
 *    `verticalConstraint` so they reflow correctly. Without them
 *    Figma treats the child as fixed at the top-left and the
 *    layout looks broken (the bug that made `card-resized` and
 *    `multi-button-sizes` look wrong). The rule only fires when
 *    such a resizing INSTANCE actually exists — children of
 *    SYMBOLs that are always rendered at their authored size, or
 *    SYMBOLs driven by auto-layout, are left alone, matching the
 *    behavior of real Figma exports.
 *
 * 2. `fig.instance.symbol-ref` (error) — every INSTANCE's
 *    `symbolData` must point at a GUID that exists in the
 *    nodeChanges stream. Dangling references mean the importer
 *    silently drops the instance.
 */

import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
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

function describeNode(node: FigNode, index: number): string {
  const guid = node.guid;
  const guidLabel = guid ? `${guid.sessionID}:${guid.localID}` : "?";
  const typeLabel = node.type?.name ?? "UNKNOWN";
  const nameLabel = node.name ? ` "${node.name}"` : "";
  return `nodeChanges[${index}] ${typeLabel}${nameLabel} (guid=${guidLabel})`;
}

function hasAutoLayout(node: FigNode): boolean {
  const stackMode = node.stackMode;
  if (!stackMode) {
    return false;
  }
  if (typeof stackMode === "object" && "name" in stackMode) {
    const name = stackMode.name;
    return typeof name === "string" && name !== "NONE";
  }
  return false;
}

function nearlyEqual(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) {
    return false;
  }
  return Math.abs(a - b) < 0.5;
}

function instanceResizesSymbol(instance: FigNode, symbol: FigNode): boolean {
  const instSize = instance.size;
  const symSize = symbol.size;
  if (!instSize || !symSize) {
    return false;
  }
  return !(nearlyEqual(instSize.x, symSize.x) && nearlyEqual(instSize.y, symSize.y));
}

export const symbolInstanceRule: LintRule = (ctx, emit) => {
  if (ctx.nodeChanges.length === 0) {
    return;
  }

  // Build a guid -> node lookup and parent -> children index in one pass.
  const byGuid = new Map<string, { node: FigNode; index: number }>();
  const childrenByParent = new Map<string, Array<{ node: FigNode; index: number }>>();
  for (const [index, node] of ctx.nodeChanges.entries()) {
    const key = guidKey(node.guid);
    if (key) {
      byGuid.set(key, { node, index });
    }
    const parentKey = guidKey(node.parentIndex?.guid);
    if (parentKey) {
      const list = childrenByParent.get(parentKey);
      if (list) {
        list.push({ node, index });
      } else {
        childrenByParent.set(parentKey, [{ node, index }]);
      }
    }
  }

  // Collect SYMBOL guids that are resized by at least one INSTANCE.
  // Only those SYMBOLs need their children's constraint metadata —
  // SYMBOLs that always render at their authored size do not need
  // it, matching the behavior of real Figma exports.
  const resizedSymbolKeys = new Set<string>();
  for (const node of ctx.nodeChanges) {
    if (node.type?.name !== "INSTANCE") {
      continue;
    }
    const symbolRef = node.symbolData?.symbolID ?? node.symbolData?.overriddenSymbolID;
    const symKey = guidKey(symbolRef);
    if (!symKey) {
      continue;
    }
    const target = byGuid.get(symKey);
    if (!target || target.node.type?.name !== "SYMBOL") {
      continue;
    }
    if (instanceResizesSymbol(node, target.node)) {
      resizedSymbolKeys.add(symKey);
    }
  }

  // Rule 1: children of resized non-auto-layout SYMBOLs must carry
  // both constraint fields.
  for (const symbolKey of resizedSymbolKeys) {
    const target = byGuid.get(symbolKey);
    if (!target) {
      continue;
    }
    const { node: symbol } = target;
    if (hasAutoLayout(symbol)) {
      continue;
    }
    const children = childrenByParent.get(symbolKey) ?? [];
    for (const { node: child, index: childIndex } of children) {
      const missingH = child.horizontalConstraint === undefined;
      const missingV = child.verticalConstraint === undefined;
      if (!missingH && !missingV) {
        continue;
      }
      const missingFields = [missingH ? "horizontalConstraint" : null, missingV ? "verticalConstraint" : null]
        .filter((f): f is string => f !== null)
        .join(" / ");
      emit({
        ruleId: "fig.symbol.child-constraints",
        severity: "warning",
        path: `${describeNode(child, childIndex)}.${missingFields}`,
        message: `child of resized SYMBOL "${symbol.name ?? "?"}" is missing ${missingFields}; the symbol will not resize correctly`,
        remediation:
          'Set both horizontalConstraint and verticalConstraint (e.g. .horizontalConstraint("STRETCH").verticalConstraint("STRETCH"))',
      });
    }
  }

  // Rule 2: INSTANCE.symbolData must point at a known SYMBOL guid.
  for (const [index, node] of ctx.nodeChanges.entries()) {
    if (node.type?.name !== "INSTANCE") {
      continue;
    }
    const ref = node.symbolData?.symbolID;
    const key = guidKey(ref);
    if (!key) {
      emit({
        ruleId: "fig.instance.symbol-ref",
        severity: "error",
        path: `${describeNode(node, index)}.symbolData.symbolID`,
        message: "INSTANCE has no symbolData.symbolID",
        remediation: "Use FigFileBuilder.addInstance() with a valid symbol GUID",
      });
      continue;
    }
    const target = byGuid.get(key);
    if (!target) {
      emit({
        ruleId: "fig.instance.symbol-ref",
        severity: "error",
        path: `${describeNode(node, index)}.symbolData.symbolID`,
        message: `INSTANCE references symbol ${key} which is not present in nodeChanges`,
        remediation: "Add the SYMBOL definition before the INSTANCE, or correct the reference",
      });
      continue;
    }
    if (target.node.type?.name !== "SYMBOL") {
      emit({
        ruleId: "fig.instance.symbol-ref",
        severity: "error",
        path: `${describeNode(node, index)}.symbolData.symbolID`,
        message: `INSTANCE references ${target.node.type?.name ?? "non-SYMBOL"} node ${key}; expected SYMBOL`,
        remediation: "INSTANCE.symbolData.symbolID must point at a SYMBOL node",
      });
    }
  }
};
