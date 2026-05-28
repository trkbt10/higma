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

// Shape types whose visible rendering requires a `commandsBlob`
// blob reference. Empirically verified against
// `/Users/terukichi/Downloads/shapes.fig` (the user-rendered
// reference for the project's shapes fixture): RECTANGLE /
// ROUNDED_RECTANGLE / ELLIPSE / VECTOR carry the blob on
// `fillGeometry`; LINE has zero height and no fill region so its
// blob lives on `strokeGeometry`. STAR / REGULAR_POLYGON also
// require an explicit blob — Figma does NOT derive their geometry
// procedurally at import time; the importer renders them as empty
// frames when fillGeometry is absent. Earlier revisions of this
// list excluded STAR / REGULAR_POLYGON based on a misread of
// Figma's renderer behaviour.
const FILL_GEOMETRY_TYPES: ReadonlySet<string> = new Set([
  "RECTANGLE",
  "ROUNDED_RECTANGLE",
  "ELLIPSE",
  "VECTOR",
  "STAR",
  "REGULAR_POLYGON",
]);

const STROKE_GEOMETRY_TYPES: ReadonlySet<string> = new Set(["LINE"]);

const PAINTABLE_TYPES: ReadonlySet<string> = new Set([
  ...FILL_GEOMETRY_TYPES,
  ...STROKE_GEOMETRY_TYPES,
]);

function hasNonZeroSize(node: FigNode): boolean {
  if (!node.size) {
    return false;
  }
  return node.size.x > 0 && node.size.y > 0;
}

/**
 * Whether the node has a non-zero size in the dimension that
 * matters for its type. LINE has zero height by definition — only
 * its width matters; treating `size.y === 0` as "invisible" would
 * skip every legitimate LINE node.
 */
function hasNonZeroPaintableSize(node: FigNode, typeName: string): boolean {
  if (!node.size) {
    return false;
  }
  if (typeName === "LINE") {
    return node.size.x > 0;
  }
  return hasNonZeroSize(node);
}

function hasVisibleFills(node: FigNode): boolean {
  const fills = node.fillPaints ?? [];
  return fills.length > 0 && fills.some((paint) => paint.visible !== false);
}

function hasVisibleStrokes(node: FigNode): boolean {
  const strokes = node.strokePaints ?? [];
  return strokes.length > 0 && strokes.some((paint) => paint.visible !== false);
}

/**
 * Which geometry slot a paintable node uses for its commandsBlob,
 * and whether it actually needs one given its paint set. LINE has
 * no fill region — its blob lives in `strokeGeometry` and the rule
 * only fires when strokePaints are present. Every other paintable
 * type uses `fillGeometry` and the rule fires when fillPaints are
 * present. VECTOR has a third option (`vectorPaths`), so the rule
 * accepts either `fillGeometry` OR `vectorPaths` as the geometry
 * carrier — having vectorPaths means the node already has its
 * commands and no fillGeometry blob is needed.
 */
function relevantGeometryEntries(node: FigNode): readonly { readonly slot: "fillGeometry" | "strokeGeometry"; readonly entries: readonly unknown[] }[] {
  const typeName = node.type?.name;
  if (typeof typeName !== "string") {
    return [];
  }
  if (STROKE_GEOMETRY_TYPES.has(typeName)) {
    return [{ slot: "strokeGeometry", entries: node.strokeGeometry ?? [] }];
  }
  return [{ slot: "fillGeometry", entries: node.fillGeometry ?? [] }];
}

function blobReferenceCount(node: FigNode): number {
  return relevantGeometryEntries(node).reduce((sum, { entries }) => sum + entries.length, 0);
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

function nodeGeometryEntries(node: FigNode): readonly { readonly slot: "fillGeometry" | "strokeGeometry"; readonly entries: readonly unknown[] }[] {
  const out: { readonly slot: "fillGeometry" | "strokeGeometry"; readonly entries: readonly unknown[] }[] = [];
  if (node.fillGeometry) {
    out.push({ slot: "fillGeometry", entries: node.fillGeometry });
  }
  if (node.strokeGeometry) {
    out.push({ slot: "strokeGeometry", entries: node.strokeGeometry });
  }
  return out;
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
    if (!hasNonZeroPaintableSize(node, typeName)) {
      continue;
    }
    const needsFillGeometry = FILL_GEOMETRY_TYPES.has(typeName) && hasVisibleFills(node);
    const needsStrokeGeometry = STROKE_GEOMETRY_TYPES.has(typeName) && hasVisibleStrokes(node);
    if (!needsFillGeometry && !needsStrokeGeometry) {
      continue;
    }
    // VECTOR carries its commands in `vectorPaths` instead of (or in
    // addition to) `fillGeometry`. Real Figma exports of icon
    // VECTORs sometimes ship only `vectorPaths` with no fillGeometry
    // blob — the renderer reads the path from vectorPaths directly.
    if (typeName === "VECTOR" && (node.vectorPaths?.length ?? 0) > 0) {
      continue;
    }
    const refCount = blobReferenceCount(node);
    if (refCount === 0) {
      const guid = node.guid ? `${node.guid.sessionID}:${node.guid.localID}` : "?";
      const slot = STROKE_GEOMETRY_TYPES.has(typeName) ? "strokeGeometry" : "fillGeometry";
      emit({
        ruleId: "fig.shape.fill-geometry",
        severity: "error",
        path: `nodeChanges[${index}] ${typeName}${node.name ? ` "${node.name}"` : ""} (guid=${guid}).${slot}`,
        message: `Visible paintable shape has no ${slot} — Figma renders nothing for it`,
        remediation: `Provide ${slot} with a commandsBlob index pointing at message.blobs`,
      });
    }
    // styleID:0 is the load-bearing default — Figma's importer
    // treats a missing styleID as "skip this geometry entry" and
    // renders the shape transparent. Real Figma exports always
    // include styleID:0 on every geometry entry.
    for (const { slot, entries } of relevantGeometryEntries(node)) {
      for (const [entryIndex, entry] of entries.entries()) {
        const styleId = (entry as { styleID?: unknown }).styleID;
        if (typeof styleId !== "number") {
          const guid = node.guid ? `${node.guid.sessionID}:${node.guid.localID}` : "?";
          emit({
            ruleId: "fig.shape.geometry-style-id",
            severity: "error",
            path: `nodeChanges[${index}] ${typeName}${node.name ? ` "${node.name}"` : ""} (guid=${guid}).${slot}[${entryIndex}].styleID`,
            message: `${slot}[${entryIndex}] is missing the styleID field — Figma renders the geometry as transparent without it`,
            remediation: "Set styleID: 0 on the geometry entry (the schema sentinel for 'no style override')",
          });
        }
      }
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
      for (const { slot, entries } of nodeGeometryEntries(node)) {
        for (const [geoIndex, geo] of entries.entries()) {
          const blobIndex = (geo as { commandsBlob?: number }).commandsBlob;
          if (typeof blobIndex !== "number") {
            continue;
          }
          if (blobIndex < 0 || blobIndex >= messageBlobs.length) {
            emit({
              ruleId: "fig.shape.fill-geometry",
              severity: "error",
              path: `nodeChanges[${index}].${slot}[${geoIndex}].commandsBlob`,
              message: `commandsBlob=${blobIndex} is out of range (message has ${messageBlobs.length} blobs)`,
              remediation: "Rebuild the nodeChanges with blob indices assigned from the Kiwi document context",
            });
          }
        }
      }
    }
  }
};
