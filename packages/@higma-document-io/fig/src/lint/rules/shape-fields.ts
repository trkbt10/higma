/**
 * @file Required per-node fields on visible shapes.
 *
 * Per the project's CLAUDE.md and Figma's importer expectations,
 * every shape node (RECTANGLE, ROUNDED_RECTANGLE, ELLIPSE, LINE,
 * STAR, REGULAR_POLYGON, VECTOR, TEXT, FRAME, GROUP, SYMBOL,
 * INSTANCE, SECTION, BOOLEAN_OPERATION) must carry stroke metadata
 * even when the visible weight is zero. Real Figma exports always
 * include `strokeWeight`, `strokeAlign`, `strokeJoin`. Missing
 * values cause Figma to drop the node or fail the import outright.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import type { LintFinding, LintRule } from "../types";

const SHAPE_NODE_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
  "GROUP",
  "SECTION",
  "BOOLEAN_OPERATION",
  "SYMBOL",
  "INSTANCE",
  "RECTANGLE",
  "ROUNDED_RECTANGLE",
  "ELLIPSE",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "VECTOR",
  "TEXT",
]);

function isShape(node: FigNode): boolean {
  const name = node.type?.name;
  if (typeof name !== "string") {
    return false;
  }
  return SHAPE_NODE_TYPES.has(name);
}

function describeNode(node: FigNode, index: number): string {
  const guid = node.guid;
  const guidLabel = guid ? `${guid.sessionID}:${guid.localID}` : "?";
  const typeLabel = node.type?.name ?? "UNKNOWN";
  const nameLabel = node.name ? ` "${node.name}"` : "";
  return `nodeChanges[${index}] ${typeLabel}${nameLabel} (guid=${guidLabel})`;
}

export const shapeFieldsRule: LintRule = (ctx, emit) => {
  if (ctx.nodeChanges.length === 0) {
    return;
  }
  for (const [index, node] of ctx.nodeChanges.entries()) {
    if (!isShape(node)) {
      continue;
    }
    const findings: LintFinding[] = [];
    if (node.strokeWeight === undefined) {
      findings.push({
        ruleId: "fig.shape.stroke-fields",
        severity: "error",
        path: `${describeNode(node, index)}.strokeWeight`,
        message: "strokeWeight is required on every shape node, even when 0",
        remediation: "Set strokeWeight (use 0 if there is no visible stroke)",
      });
    }
    if (node.strokeAlign === undefined) {
      findings.push({
        ruleId: "fig.shape.stroke-fields",
        severity: "error",
        path: `${describeNode(node, index)}.strokeAlign`,
        message: "strokeAlign is required on every shape node",
        remediation: "Set strokeAlign to INSIDE / OUTSIDE / CENTER",
      });
    }
    if (node.strokeJoin === undefined) {
      findings.push({
        ruleId: "fig.shape.stroke-fields",
        severity: "error",
        path: `${describeNode(node, index)}.strokeJoin`,
        message: "strokeJoin is required on every shape node",
        remediation: "Set strokeJoin to MITER / BEVEL / ROUND",
      });
    }
    for (const finding of findings) {
      emit(finding);
    }
  }
};
