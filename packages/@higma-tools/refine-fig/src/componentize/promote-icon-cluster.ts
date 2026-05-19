/**
 * @file Promote a cluster of repeated structures into a single SYMBOL
 * plus N INSTANCEs.
 *
 * Scope:
 *
 *   The function handles every cluster whose members are *strictly
 *   identical* — same descendant types, sizes, geometry blob indices,
 *   text content, image references, nested-symbol references, and
 *   opacity. Strict identity means a plain SYMBOL/INSTANCE flip is
 *   visually equivalent: the INSTANCE renders the SYMBOL's children
 *   verbatim, no per-instance overrides required.
 *
 *   The fingerprint is the safety mechanism. Visual-hash clustering
 *   (in `analysis/duplicate-clusters`) tolerates small pixel diffs to
 *   surface candidate clusters; this module's `structureFingerprint`
 *   tightens that to literal field-equality across the visually-
 *   significant axes. Members that pass the loose hash but differ on
 *   any of those axes are correctly excluded from `eligibleOthers`
 *   and stay as plain frames.
 *
 *   Allowed descendant types are the renderable shape kinds that
 *   round-trip cleanly under SYMBOL → INSTANCE without override
 *   payloads:
 *
 *     - VECTOR, BOOLEAN_OPERATION, FRAME, GROUP — same as v1.
 *     - RECTANGLE, ROUNDED_RECTANGLE, ELLIPSE, LINE, STAR,
 *       REGULAR_POLYGON — primitive shapes.
 *     - TEXT — text content is folded into the fingerprint, so only
 *       members with identical characters/font/style cluster.
 *     - INSTANCE — only when its `symbolData.symbolID` is identical
 *       across cluster members (folded into the fingerprint). The
 *       cluster's SYMBOL holds the descendant INSTANCE; every
 *       cluster INSTANCE then transitively includes that descendant
 *       reference.
 *
 *   IMAGE paints are accepted iff the `image.hash` is identical across
 *   members (folded into the fingerprint).
 *
 * Algorithm:
 *
 *   1. Pick the exemplar member (caller decides; defaults to the
 *      lexicographically smallest GUID for determinism).
 *   2. Mutate the exemplar's nodeChange entry in place:
 *        - type: SYMBOL
 *        - name: the cluster's authored name
 *      Descendants stay where they are; their parentIndex still
 *      points at the exemplar's GUID, so they become the SYMBOL's
 *      content automatically.
 *   3. For every *other* fingerprint-equal member GUID:
 *        - Replace the entry with an INSTANCE node whose
 *          `symbolData.symbolID` references the exemplar.
 *        - Remove every descendant of the member from
 *          `loaded.nodeChanges`.
 */
import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { indexFigKiwiDocument, type FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { asImagePaint, asSolidPaint, getPaintType } from "@higma-document-models/fig/color";
import { kiwiEnumName } from "@higma-document-models/fig/constants";
import { getImageHash, getScaleMode } from "@higma-document-renderers/fig/paint";

const PROMOTABLE_DESCENDANT_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "FRAME",
  "GROUP",
  "RECTANGLE",
  "ROUNDED_RECTANGLE",
  "ELLIPSE",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "TEXT",
  "INSTANCE",
]);

/**
 * Decide whether a cluster's exemplar is promotable to a SYMBOL.
 *
 * The exemplar must be a FRAME / GROUP container, and every
 * descendant must be one of the renderable types listed in
 * `PROMOTABLE_DESCENDANT_TYPES`. GRADIENT paints are still refused
 * because a gradient's Kiwi transform and stops are positional
 * relative to the node — when an INSTANCE's transform differs from
 * the SYMBOL exemplar's, the gradient direction differs too, which
 * would silently break visual parity. IMAGE paints are accepted; the
 * fingerprint folds in their `image.hash` so two members differ
 * fingerprint if they reference different images.
 */
export function isPromotableCluster(loaded: LoadedFigFile, exemplarGuid: string): boolean {
  const document = indexFigKiwiDocument(loaded.nodeChanges);
  const exemplar = requiredNode(document, exemplarGuid);
  if (exemplar.type?.name !== "FRAME" && exemplar.type?.name !== "GROUP") {
    return false;
  }
  const descendants = collectStructure(document, exemplar);
  for (const node of descendants) {
    const t = node.type?.name;
    if (!t || !PROMOTABLE_DESCENDANT_TYPES.has(t)) {
      return false;
    }
    if (hasGradientFill(node)) {
      return false;
    }
  }
  return true;
}

// Phase 2 of the SoT consolidation removed the `promoteIconCluster`
// mutator from refine-fig's apply pipeline; the equivalent rewrite is
// now expressed as `PROMOTE_TO_SYMBOL` + N × `PROMOTE_TO_INSTANCE`
// reducer dispatches inside `apply-plan.ts`. The gating and
// fingerprint routines (`isPromotableCluster`, `structureFingerprint`)
// are still used by the planner / apply layer to decide whether a
// cluster qualifies and which members share visual identity with the
// exemplar.

/**
 * Stable fingerprint of a structure's *visually-significant* shape.
 *
 * Two members with the same fingerprint render to the same pixels
 * once their wrapping INSTANCE's transform is applied. The
 * fingerprint folds in:
 *
 *   - root size (the INSTANCE preserves the wrapping transform but
 *     not the wrapper's size — sizes must already match);
 *   - per-descendant type, size, and fillGeometry / strokeGeometry
 *     blob indices (geometry identity);
 *   - per-descendant fillPaints / strokePaints — paint type, SOLID
 *     colour quantised to 3 decimals, IMAGE `image.hash`, opacity,
 *     visibility, blend mode;
 *   - per-descendant `characters` (TEXT) and font descriptor
 *     (family / style / size / lineHeight / letterSpacing) — TEXT
 *     content matters for visual identity;
 *   - per-descendant `symbolData.symbolID` (INSTANCE) — nested
 *     INSTANCE references must match for a plain SYMBOL/INSTANCE
 *     flip to render the same content;
 *   - per-descendant opacity and corner-radius fields — common
 *     authoring axes the loose hash does not distinguish.
 *
 * Position / transform / parent-relative offset are *not* included;
 * those are wrapper concerns the INSTANCE legitimately preserves.
 */
export function structureFingerprint(loaded: LoadedFigFile, rootGuid: string): string {
  const document = indexFigKiwiDocument(loaded.nodeChanges);
  const root = requiredNode(document, rootGuid);
  const parts: string[] = [];
  const structure = collectStructure(document, root);
  parts.push(`root:${Math.round(root.size?.x ?? 0)}x${Math.round(root.size?.y ?? 0)}`);
  for (const node of structure) {
    parts.push(descendantFingerprint(node));
  }
  return parts.join("|");
}

function descendantFingerprint(node: FigNode): string {
  const t = node.type?.name ?? "?";
  const w = Math.round(node.size?.x ?? 0);
  const h = Math.round(node.size?.y ?? 0);
  const fg = (node.fillGeometry ?? []).map((g) => g.commandsBlob ?? -1).join(",");
  const sg = (node.strokeGeometry ?? []).map((g) => g.commandsBlob ?? -1).join(",");
  const op = node.opacity ?? 1;
  const visible = node.visible !== false;
  const cornerR = node.cornerRadius ?? -1;
  const fills = paintsFingerprint(node.fillPaints);
  const strokes = paintsFingerprint(node.strokePaints);
  const text = textFingerprint(node);
  const ref = instanceRefFingerprint(node);
  return `${t}:${w}x${h}:fg=${fg}:sg=${sg}:op=${op}:vis=${visible}:cr=${cornerR}:fills=${fills}:strokes=${strokes}:${text}:${ref}`;
}

function paintsFingerprint(paints: FigNode["fillPaints"]): string {
  if (!paints || paints.length === 0) {
    return "none";
  }
  return paints
    .map((p) => {
      const visible = p.visible !== false;
      const op = p.opacity ?? 1;
      const blend = paintBlendName(p);
      const solid = asSolidPaint(p);
      if (solid !== undefined) {
        const c = solid.color;
        const r = c ? c.r.toFixed(3) : "0";
        const g = c ? c.g.toFixed(3) : "0";
        const b = c ? c.b.toFixed(3) : "0";
        const a = c ? c.a.toFixed(3) : "1";
        return `SOLID(${r},${g},${b},${a}):${op}:${visible}:${blend}`;
      }
      const image = asImagePaint(p);
      if (image !== undefined) {
        const ref = getImageHash(image);
        const scale = getScaleMode(image);
        return `IMAGE(${ref},${scale}):${op}:${visible}:${blend}`;
      }
      // GRADIENT paints are filtered out at the gate (`isPromotableCluster`).
      return `${getPaintType(p)}:${op}:${visible}:${blend}`;
    })
    .join(";");
}

function paintBlendName(paint: FigPaint): string {
  if (paint.blendMode === undefined) {
    return "UNSET";
  }
  const name = kiwiEnumName(paint.blendMode, "FigPaint.blendMode");
  if (name === undefined) {
    throw new Error("promote-icon-cluster: FigPaint.blendMode was present but resolved to undefined");
  }
  return name;
}

function textFingerprint(node: FigNode): string {
  if (node.type?.name !== "TEXT") {
    return "txt=";
  }
  const chars = node.characters ?? "";
  const family = node.fontName?.family ?? "";
  const style = node.fontName?.style ?? "";
  const size = node.fontSize ?? 0;
  const lineH = node.lineHeight ? `${node.lineHeight.value}${node.lineHeight.units?.name ?? ""}` : "";
  const letterS = node.letterSpacing ? `${node.letterSpacing.value}${node.letterSpacing.units?.name ?? ""}` : "";
  return `txt=${chars}|font=${family}/${style}@${size}|lh=${lineH}|ls=${letterS}`;
}

function instanceRefFingerprint(node: FigNode): string {
  if (node.type?.name !== "INSTANCE") {
    return "ref=";
  }
  const sid = node.symbolData?.symbolID;
  if (!sid) {
    return "ref=none";
  }
  return `ref=${sid.sessionID}:${sid.localID}`;
}

function collectStructure(document: FigKiwiDocumentIndex, root: FigNode): readonly FigNode[] {
  const out: FigNode[] = [];
  walk(root, document, out);
  return out;
}

function walk(parent: FigNode, document: FigKiwiDocumentIndex, out: FigNode[]): void {
  for (const child of document.childrenOf(parent)) {
    out.push(child);
    walk(child, document, out);
  }
}

function requiredNode(document: FigKiwiDocumentIndex, guidString: string): FigNode {
  const node = document.nodesByGuid.get(guidString);
  if (node === undefined) {
    throw new Error(`promote-icon-cluster: missing node ${guidString}`);
  }
  return node;
}

function hasGradientFill(node: FigNode): boolean {
  const fp = node.fillPaints;
  if (!fp) {
    return false;
  }
  return fp.some((p) => getPaintType(p).startsWith("GRADIENT_"));
}
