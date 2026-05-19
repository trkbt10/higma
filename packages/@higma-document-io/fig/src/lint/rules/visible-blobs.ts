/**
 * @file fillGeometry / blob coverage rule.
 *
 * Per project CLAUDE.md: every visible (non-zero size, non-mask)
 * shape needs `fillGeometry` referencing a blob in the message-level
 * `blobs` array. When a builder forgets to compute geometry, Figma
 * silently shows nothing for the node — making the file feel
 * "broken" without any explicit error.
 *
 * The rule is conservative: it only flags shape nodes that look
 * paintable (non-zero size, has fillPaints, not a mask). Containers
 * (FRAME, GROUP, SECTION, SYMBOL, INSTANCE, BOOLEAN_OPERATION) are
 * exempt because they composite child geometry.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import type { LintRule } from "../types";

// STAR and REGULAR_POLYGON are excluded because Figma derives their
// geometry procedurally from `starInnerScale` / `count` fields and
// real Figma exports also omit fillGeometry on these types.
const PAINTABLE_TYPES: ReadonlySet<string> = new Set([
  "RECTANGLE",
  "ROUNDED_RECTANGLE",
  "ELLIPSE",
  "LINE",
  "VECTOR",
]);

function hasNonZeroSize(node: FigNode): boolean {
  if (!node.size) {
    return false;
  }
  return node.size.x > 0 && node.size.y > 0;
}

function hasVisiblePaint(node: FigNode): boolean {
  if (!node.fillPaints || node.fillPaints.length === 0) {
    return false;
  }
  return node.fillPaints.some((paint) => paint.visible !== false);
}

function blobReferenceCount(node: FigNode): number {
  return node.fillGeometry?.length ?? 0;
}

function readMessageBlobs(message: Record<string, unknown> | null): readonly unknown[] | null {
  if (!message) {
    return null;
  }
  const blobs = (message as { blobs?: readonly unknown[] }).blobs;
  if (!Array.isArray(blobs)) {
    return null;
  }
  return blobs;
}

function sumReferences(nodes: readonly FigNode[]): number {
  return nodes.reduce<number>((acc, node) => {
    const typeName = node.type?.name;
    if (typeof typeName !== "string" || !PAINTABLE_TYPES.has(typeName)) {
      return acc;
    }
    return acc + blobReferenceCount(node);
  }, 0);
}

export const visibleBlobsRule: LintRule = (ctx, emit) => {
  if (ctx.nodeChanges.length === 0) {
    return;
  }
  const messageBlobs = readMessageBlobs(ctx.message);
  const totalReferences = sumReferences(ctx.nodeChanges);

  for (const [index, node] of ctx.nodeChanges.entries()) {
    const typeName = node.type?.name;
    if (typeof typeName !== "string" || !PAINTABLE_TYPES.has(typeName)) {
      continue;
    }
    if (!hasNonZeroSize(node) || !hasVisiblePaint(node)) {
      continue;
    }
    const refCount = blobReferenceCount(node);
    if (refCount === 0) {
      const guid = node.guid ? `${node.guid.sessionID}:${node.guid.localID}` : "?";
      emit({
        ruleId: "fig.shape.fill-geometry",
        severity: "error",
        path: `nodeChanges[${index}] ${typeName}${node.name ? ` "${node.name}"` : ""} (guid=${guid}).fillGeometry`,
        message: "Visible paintable shape has no fillGeometry — Figma renders nothing for it",
        remediation: "Provide fillGeometry with a commandsBlob index pointing at message.blobs",
      });
    }
  }

  if (totalReferences > 0 && messageBlobs === null) {
    emit({
      ruleId: "fig.shape.fill-geometry",
      severity: "error",
      path: "message.blobs",
      message: "Nodes reference blobs but the message has no `blobs` array (schema may be missing the field)",
      remediation: "Rebuild with the canonical figma-schema.json so the Message.blobs field is present",
    });
    return;
  }

  if (messageBlobs && totalReferences > 0) {
    for (const [index, node] of ctx.nodeChanges.entries()) {
      if (!node.fillGeometry) {
        continue;
      }
      for (const [geoIndex, geo] of node.fillGeometry.entries()) {
        const blobIndex = (geo as { commandsBlob?: number }).commandsBlob;
        if (typeof blobIndex !== "number") {
          continue;
        }
        if (blobIndex < 0 || blobIndex >= messageBlobs.length) {
          emit({
            ruleId: "fig.shape.fill-geometry",
            severity: "error",
            path: `nodeChanges[${index}].fillGeometry[${geoIndex}].commandsBlob`,
            message: `commandsBlob=${blobIndex} is out of range (message has ${messageBlobs.length} blobs)`,
            remediation: "Rebuild the nodeChanges with blob indices assigned from the Kiwi document context",
          });
        }
      }
    }
  }
};
