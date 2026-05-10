/**
 * @file Promote a cluster of repeated subtrees into a single SYMBOL
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
 *   surface candidate clusters; this module's `subtreeFingerprint`
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
 *   IMAGE paints are accepted iff the `imageRef` is identical across
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
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { guidToString } from "@higma-document-models/fig/domain";

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

export type PromoteIconClusterArgs = {
  readonly loaded: LoadedFigFile;
  readonly clusterName: string;
  readonly memberGuids: readonly string[];
  /** Exemplar GUID — kept as the SYMBOL. Must be one of memberGuids. */
  readonly exemplarGuid: string;
};

export type PromoteResult = {
  readonly symbolGuid: string;
  readonly instanceGuids: readonly string[];
  readonly removedDescendants: number;
};

/**
 * Decide whether a cluster's exemplar is promotable to a SYMBOL.
 *
 * The exemplar must be a FRAME / GROUP container, and every
 * descendant must be one of the renderable types listed in
 * `PROMOTABLE_DESCENDANT_TYPES`. GRADIENT paints are still refused
 * because a gradient's `gradientHandlePositions` are positional
 * relative to the node — when an INSTANCE's transform differs from
 * the SYMBOL exemplar's, the gradient direction differs too, which
 * would silently break visual parity. IMAGE paints are accepted; the
 * fingerprint folds in their `imageRef` so two members differ
 * fingerprint if they reference different images.
 */
export function isPromotableCluster(loaded: LoadedFigFile, exemplarGuid: string): boolean {
  const exemplar = findByGuid(loaded, exemplarGuid);
  if (!exemplar) {
    return false;
  }
  if (exemplar.type?.name !== "FRAME" && exemplar.type?.name !== "GROUP") {
    return false;
  }
  const descendants = collectSubtree(loaded, exemplarGuid);
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

/**
 * Backwards-compatible alias retained for callers that still spell
 * the v1 name. New code should use `isPromotableCluster`.
 *
 * @deprecated Use `isPromotableCluster`.
 */
export function isLeafIconCluster(loaded: LoadedFigFile, exemplarGuid: string): boolean {
  return isPromotableCluster(loaded, exemplarGuid);
}

/** Promote an exemplar to a SYMBOL and rewrite the other cluster members into INSTANCEs. */
export function promoteIconCluster(args: PromoteIconClusterArgs): PromoteResult {
  const { loaded, clusterName, memberGuids, exemplarGuid } = args;
  if (!memberGuids.includes(exemplarGuid)) {
    throw new Error("promoteIconCluster: exemplarGuid must be one of memberGuids");
  }
  if (!isPromotableCluster(loaded, exemplarGuid)) {
    throw new Error("promoteIconCluster: exemplar carries a non-promotable descendant (e.g. GRADIENT paint or unsupported node type)");
  }

  // 2. Filter members so only those whose subtree is *strictly identical*
  //    to the exemplar (same descendant fingerprint) are converted into
  //    INSTANCEs. Visual-hash clusters tolerate small differences which
  //    is great for surfacing candidates, but promoting non-identical
  //    subtrees would change pixels — refuse those by design.
  const exemplarFingerprint = subtreeFingerprint(loaded, exemplarGuid);
  const eligibleOthers = memberGuids
    .filter((g) => g !== exemplarGuid)
    .filter((g) => subtreeFingerprint(loaded, g) === exemplarFingerprint);

  // 1. Promote exemplar to SYMBOL.
  promoteExemplarInPlace(loaded, exemplarGuid, clusterName);

  // 3. Rewrite every fingerprint-equal member into an INSTANCE.
  const exemplarFigGuid = parseGuidString(exemplarGuid);
  const tally = eligibleOthers.reduce<{ instances: string[]; removed: number }>(
    (acc, memberGuid) => {
      const removed = rewriteMemberToInstance(loaded, memberGuid, exemplarFigGuid);
      if (removed === undefined) {
        return acc;
      }
      return {
        instances: [...acc.instances, memberGuid],
        removed: acc.removed + removed,
      };
    },
    { instances: [], removed: 0 },
  );
  return {
    symbolGuid: exemplarGuid,
    instanceGuids: tally.instances,
    removedDescendants: tally.removed,
  };
}

function promoteExemplarInPlace(loaded: LoadedFigFile, exemplarGuid: string, name: string): void {
  const idx = loaded.nodeChanges.findIndex((n) => n.guid && guidToString(n.guid) === exemplarGuid);
  if (idx < 0) {
    throw new Error(`promoteIconCluster: exemplar ${exemplarGuid} not found`);
  }
  const node = loaded.nodeChanges[idx];
  if (!node) {
    throw new Error(`promoteIconCluster: exemplar ${exemplarGuid} not found`);
  }
  loaded.nodeChanges[idx] = {
    ...node,
    type: { value: 15, name: "SYMBOL" },
    name,
  };
}

function rewriteMemberToInstance(
  loaded: LoadedFigFile,
  memberGuid: string,
  exemplarFigGuid: FigGuid,
): number | undefined {
  const idx = loaded.nodeChanges.findIndex((n) => n.guid && guidToString(n.guid) === memberGuid);
  if (idx < 0) {
    return undefined;
  }
  const member = loaded.nodeChanges[idx];
  if (!member) {
    return undefined;
  }
  // Snapshot positional fields the INSTANCE needs to keep visually.
  // We start from a shallow copy of the member (preserving `phase`,
  // `version` and any other Kiwi book-keeping fields) and then
  // overwrite the specific fields the role flip requires.
  const replacement: FigNode = {
    ...member,
    type: { value: 16, name: "INSTANCE" },
    fillPaints: [],
    symbolData: {
      symbolID: exemplarFigGuid,
      symbolOverrides: [],
      uniformScaleFactor: 1,
    },
  };
  loaded.nodeChanges[idx] = replacement;

  // Remove every descendant — they used to belong to the cloned
  // subtree but now the INSTANCE renders the SYMBOL's children.
  const descendantGuids = new Set(collectDescendantGuids(loaded, memberGuid));
  if (descendantGuids.size === 0) {
    return 0;
  }
  const filtered = loaded.nodeChanges.filter((n) => !n.guid || !descendantGuids.has(guidToString(n.guid)));
  const removed = loaded.nodeChanges.length - filtered.length;
  loaded.nodeChanges.length = 0;
  for (const n of filtered) {
    loaded.nodeChanges.push(n);
  }
  return removed;
}

/**
 * Stable fingerprint of a subtree's *visually-significant* shape.
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
 *     colour quantised to 3 decimals, IMAGE `imageRef`, opacity,
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
function subtreeFingerprint(loaded: LoadedFigFile, rootGuid: string): string {
  const root = findByGuid(loaded, rootGuid);
  if (!root) {
    return "missing";
  }
  const parts: string[] = [];
  const subtree = collectSubtree(loaded, rootGuid);
  parts.push(`root:${Math.round(root.size?.x ?? 0)}x${Math.round(root.size?.y ?? 0)}`);
  for (const node of subtree) {
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
      const blend = p.blendMode ?? "NORMAL";
      if (p.type === "SOLID") {
        const c = p.color;
        const r = c ? c.r.toFixed(3) : "0";
        const g = c ? c.g.toFixed(3) : "0";
        const b = c ? c.b.toFixed(3) : "0";
        const a = c ? c.a.toFixed(3) : "1";
        return `SOLID(${r},${g},${b},${a}):${op}:${visible}:${blend}`;
      }
      if (p.type === "IMAGE") {
        const ref = typeof p.imageRef === "string" ? p.imageRef : "";
        const scale = p.imageScaleMode ?? "";
        return `IMAGE(${ref},${scale}):${op}:${visible}:${blend}`;
      }
      // GRADIENT paints are filtered out at the gate (`isPromotableCluster`).
      return `${p.type}:${op}:${visible}:${blend}`;
    })
    .join(";");
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

function collectSubtree(loaded: LoadedFigFile, rootGuid: string): readonly FigNode[] {
  const childrenByParent = new Map<string, FigNode[]>();
  for (const node of loaded.nodeChanges) {
    const parent = node.parentIndex?.guid;
    if (!parent) {
      continue;
    }
    const key = guidToString(parent);
    const arr = childrenByParent.get(key) ?? [];
    arr.push(node);
    childrenByParent.set(key, arr);
  }
  const out: FigNode[] = [];
  walk(rootGuid, childrenByParent, out);
  return out;
}

function walk(parentGuid: string, byParent: ReadonlyMap<string, readonly FigNode[]>, out: FigNode[]): void {
  const kids = byParent.get(parentGuid);
  if (!kids) {
    return;
  }
  for (const k of kids) {
    out.push(k);
    if (k.guid) {
      walk(guidToString(k.guid), byParent, out);
    }
  }
}

function collectDescendantGuids(loaded: LoadedFigFile, rootGuid: string): readonly string[] {
  return collectSubtree(loaded, rootGuid)
    .map((n) => n.guid)
    .filter((g): g is FigGuid => Boolean(g))
    .map((g) => guidToString(g));
}

function findByGuid(loaded: LoadedFigFile, guidString: string): FigNode | undefined {
  return loaded.nodeChanges.find((n) => n.guid && guidToString(n.guid) === guidString);
}

function hasGradientFill(node: FigNode): boolean {
  const fp = node.fillPaints;
  if (!fp) {
    return false;
  }
  return fp.some((p) => p.type.startsWith("GRADIENT_"));
}

function parseGuidString(s: string): FigGuid {
  const [a, b] = s.split(":");
  if (a === undefined || b === undefined) {
    throw new Error(`promoteIconCluster: bad guid string "${s}"`);
  }
  const sessionID = Number.parseInt(a, 10);
  const localID = Number.parseInt(b, 10);
  if (!Number.isFinite(sessionID) || !Number.isFinite(localID)) {
    throw new Error(`promoteIconCluster: non-numeric guid "${s}"`);
  }
  return { sessionID, localID };
}
