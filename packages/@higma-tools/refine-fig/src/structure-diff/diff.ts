/**
 * @file Structural diff between two `.fig` files.
 *
 * Pixel-level diffs cannot tell apart "Figma re-rasterised slightly
 * different anti-aliasing" from "the apply step orphaned an IMAGE
 * paint and the renderer fell back to a placeholder". For an honest
 * answer to "did refining preserve image / geometry content", we
 * compare the actual structural fields of the two files.
 *
 * Reported categories (per node):
 *
 *   - missing       — nodeGuid present in `before` but absent in `after`
 *                     (and not because it became an INSTANCE descendant).
 *   - added         — nodeGuid present in `after` only. Expected for
 *                     new style proxies.
 *   - parent-moved  — parentIndex.guid changed between before/after.
 *   - type-changed  — node.type.name changed (the legitimate cases:
 *                     promoted SYMBOL exemplar, INSTANCE-rewritten
 *                     cluster member). Anything else is suspicious.
 *   - image-fill-lost   — node had an IMAGE paint before, doesn't
 *                          after.
 *   - image-fill-orphan — node still has an IMAGE paint, but its
 *                          `imageRef` no longer resolves to a stored
 *                          image in the file.
 *   - blob-rewired      — fillGeometry / strokeGeometry commandsBlob
 *                          index changed (different shape encoded).
 *
 * Each report carries the affected node guid and the relevant field
 * delta so the agent can confirm the change was intended.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-io/fig/roundtrip";
import { guidToString } from "@higma-document-models/fig/domain";

export type StructureDelta =
  | { readonly kind: "missing"; readonly nodeGuid: string; readonly nodeName: string; readonly typeName: string }
  | { readonly kind: "added"; readonly nodeGuid: string; readonly nodeName: string; readonly typeName: string }
  | { readonly kind: "parent-moved"; readonly nodeGuid: string; readonly nodeName: string; readonly fromParent: string; readonly toParent: string }
  | { readonly kind: "type-changed"; readonly nodeGuid: string; readonly nodeName: string; readonly fromType: string; readonly toType: string }
  | { readonly kind: "image-fill-lost"; readonly nodeGuid: string; readonly nodeName: string; readonly lostImageRefs: readonly string[] }
  | { readonly kind: "image-fill-orphan"; readonly nodeGuid: string; readonly nodeName: string; readonly orphanedImageRefs: readonly string[] }
  | { readonly kind: "blob-rewired"; readonly nodeGuid: string; readonly nodeName: string; readonly fromBlobs: readonly number[]; readonly toBlobs: readonly number[] };

export type StructureReport = {
  readonly summary: {
    readonly missing: number;
    readonly added: number;
    readonly parentMoved: number;
    readonly typeChanged: number;
    readonly imageFillLost: number;
    readonly imageFillOrphan: number;
    readonly blobRewired: number;
  };
  readonly deltas: readonly StructureDelta[];
};

/** Diff two loaded files structurally. */
export function diffStructure(before: LoadedFigFile, after: LoadedFigFile): StructureReport {
  const beforeByGuid = indexNodes(before);
  const afterByGuid = indexNodes(after);
  const afterImageRefs = collectImageRefs(after);

  const deltas: StructureDelta[] = [];
  for (const [guid, beforeNode] of beforeByGuid) {
    const afterNode = afterByGuid.get(guid);
    if (!afterNode) {
      deltas.push({
        kind: "missing",
        nodeGuid: guid,
        nodeName: beforeNode.name ?? "(unnamed)",
        typeName: beforeNode.type?.name ?? "?",
      });
      continue;
    }
    const beforeParent = beforeNode.parentIndex?.guid;
    const afterParent = afterNode.parentIndex?.guid;
    const beforeParentKey = beforeParent ? guidToString(beforeParent) : "";
    const afterParentKey = afterParent ? guidToString(afterParent) : "";
    if (beforeParentKey !== afterParentKey) {
      deltas.push({
        kind: "parent-moved",
        nodeGuid: guid,
        nodeName: afterNode.name ?? "(unnamed)",
        fromParent: beforeParentKey,
        toParent: afterParentKey,
      });
    }
    const beforeType = beforeNode.type?.name ?? "?";
    const afterType = afterNode.type?.name ?? "?";
    if (beforeType !== afterType) {
      deltas.push({
        kind: "type-changed",
        nodeGuid: guid,
        nodeName: afterNode.name ?? "(unnamed)",
        fromType: beforeType,
        toType: afterType,
      });
    }
    const beforeImageRefs = imageRefsOf(beforeNode);
    const afterRefsOnNode = imageRefsOf(afterNode);
    const lost = beforeImageRefs.filter((r) => !afterRefsOnNode.includes(r));
    if (lost.length > 0) {
      deltas.push({
        kind: "image-fill-lost",
        nodeGuid: guid,
        nodeName: afterNode.name ?? "(unnamed)",
        lostImageRefs: lost,
      });
    }
    const orphans = afterRefsOnNode.filter((r) => !afterImageRefs.has(r));
    if (orphans.length > 0) {
      deltas.push({
        kind: "image-fill-orphan",
        nodeGuid: guid,
        nodeName: afterNode.name ?? "(unnamed)",
        orphanedImageRefs: orphans,
      });
    }
    const beforeBlobs = blobIndicesOf(beforeNode);
    const afterBlobs = blobIndicesOf(afterNode);
    if (!arraysEqual(beforeBlobs, afterBlobs)) {
      deltas.push({
        kind: "blob-rewired",
        nodeGuid: guid,
        nodeName: afterNode.name ?? "(unnamed)",
        fromBlobs: beforeBlobs,
        toBlobs: afterBlobs,
      });
    }
  }
  for (const [guid, afterNode] of afterByGuid) {
    if (!beforeByGuid.has(guid)) {
      deltas.push({
        kind: "added",
        nodeGuid: guid,
        nodeName: afterNode.name ?? "(unnamed)",
        typeName: afterNode.type?.name ?? "?",
      });
    }
  }
  return {
    summary: summarise(deltas),
    deltas,
  };
}

function summarise(deltas: readonly StructureDelta[]): StructureReport["summary"] {
  return {
    missing: deltas.filter((d) => d.kind === "missing").length,
    added: deltas.filter((d) => d.kind === "added").length,
    parentMoved: deltas.filter((d) => d.kind === "parent-moved").length,
    typeChanged: deltas.filter((d) => d.kind === "type-changed").length,
    imageFillLost: deltas.filter((d) => d.kind === "image-fill-lost").length,
    imageFillOrphan: deltas.filter((d) => d.kind === "image-fill-orphan").length,
    blobRewired: deltas.filter((d) => d.kind === "blob-rewired").length,
  };
}

function indexNodes(loaded: LoadedFigFile): ReadonlyMap<string, FigNode> {
  const out = new Map<string, FigNode>();
  for (const node of loaded.nodeChanges) {
    if (node.guid) {
      out.set(guidToString(node.guid), node);
    }
  }
  return out;
}

function collectImageRefs(loaded: LoadedFigFile): ReadonlySet<string> {
  return new Set(loaded.images?.keys() ?? []);
}

function imageRefsOf(node: FigNode): readonly string[] {
  const fp = node.fillPaints;
  if (!fp) {
    return [];
  }
  const refs: string[] = [];
  for (const paint of fp) {
    if (paint.type !== "IMAGE") {
      continue;
    }
    const ref = paint.imageRef;
    if (typeof ref === "string" && ref.length > 0) {
      refs.push(ref);
    }
  }
  return refs;
}

function blobIndicesOf(node: FigNode): readonly number[] {
  const fillBlobs = (node.fillGeometry ?? []).map((g) => g.commandsBlob ?? -1);
  const strokeBlobs = (node.strokeGeometry ?? []).map((g) => g.commandsBlob ?? -1);
  return [...fillBlobs, ...strokeBlobs];
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((v, i) => v === b[i]);
}
