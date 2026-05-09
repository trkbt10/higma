/**
 * @file Promote a cluster of repeated icon-shaped subtrees into a
 * single SYMBOL plus N INSTANCEs.
 *
 * Scope (v1):
 *
 *   The function only handles **leaf-icon clusters**: a cluster
 *   whose role signature describes a small frame containing only
 *   VECTOR / BOOLEAN_OPERATION / FRAME-of-vectors descendants — no
 *   nested INSTANCE, no TEXT, no IMAGE paints. These are the
 *   clusters where override-path machinery is not needed: the
 *   INSTANCE just renders the SYMBOL's content, no per-instance
 *   state.
 *
 *   Anything more complex (rows, cards, nested instances) is
 *   declined. The caller should check the cluster's role signature
 *   before calling, or rely on the pre-flight in `isLeafIconCluster`
 *   exposed below.
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
 *   3. For every *other* member GUID:
 *        - Snapshot the member's parentIndex / transform / size /
 *          opacity / visible / strokeWeight (a few fields Figma
 *          requires on every node).
 *        - Replace the entry with an INSTANCE node carrying those
 *          fields plus `symbolData.symbolID` pointing at the
 *          exemplar. children are not stored explicitly in
 *          `nodeChanges` (they're inferred from parentIndex), so we
 *          just need to drop the descendant entries.
 *        - Remove every descendant of the member from
 *          `loaded.nodeChanges`.
 */
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-io/fig/roundtrip";
import { guidToString } from "@higma-document-models/fig/domain";

const LEAF_ICON_ALLOWED = new Set(["VECTOR", "BOOLEAN_OPERATION", "FRAME", "GROUP"]);

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
 * Decide whether a cluster's exemplar is a leaf-icon — only such
 * clusters are promoted in v1.
 */
export function isLeafIconCluster(loaded: LoadedFigFile, exemplarGuid: string): boolean {
  const exemplar = findByGuid(loaded, exemplarGuid);
  if (!exemplar) {
    return false;
  }
  if (exemplar.type?.name !== "FRAME" && exemplar.type?.name !== "GROUP") {
    return false;
  }
  // Walk descendants; refuse if any non-allowed type appears.
  const descendants = collectSubtree(loaded, exemplarGuid);
  for (const node of descendants) {
    const t = node.type?.name;
    if (!t || !LEAF_ICON_ALLOWED.has(t)) {
      return false;
    }
    if (hasImageOrGradientFill(node)) {
      return false;
    }
  }
  return true;
}

/** Promote an exemplar to a SYMBOL and rewrite the other cluster members into INSTANCEs. */
export function promoteIconCluster(args: PromoteIconClusterArgs): PromoteResult {
  const { loaded, clusterName, memberGuids, exemplarGuid } = args;
  if (!memberGuids.includes(exemplarGuid)) {
    throw new Error("promoteIconCluster: exemplarGuid must be one of memberGuids");
  }
  if (!isLeafIconCluster(loaded, exemplarGuid)) {
    throw new Error("promoteIconCluster: exemplar is not a leaf-icon cluster (v1 scope)");
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
 * Stable fingerprint of a subtree's renderable shape — type, size,
 * and the geometry blob index of every descendant. Two members with
 * the same fingerprint render to the same pixels (modulo the wrapper
 * frame's transform, which the INSTANCE preserves). We refuse to
 * componentize members whose fingerprint diverges from the exemplar's.
 */
function subtreeFingerprint(loaded: LoadedFigFile, rootGuid: string): string {
  const root = findByGuid(loaded, rootGuid);
  if (!root) {
    return "missing";
  }
  const parts: string[] = [];
  const subtree = collectSubtree(loaded, rootGuid);
  // Include the root's own size; descendants contribute type + size +
  // every fillGeometry blob index. Position / transform / colour are
  // *not* included — those legitimately vary between clones and the
  // INSTANCE wrapper preserves them.
  parts.push(`root:${Math.round(root.size?.x ?? 0)}x${Math.round(root.size?.y ?? 0)}`);
  for (const node of subtree) {
    const t = node.type?.name ?? "?";
    const w = Math.round(node.size?.x ?? 0);
    const h = Math.round(node.size?.y ?? 0);
    const fg = (node.fillGeometry ?? []).map((g) => g.commandsBlob ?? -1).join(",");
    const sg = (node.strokeGeometry ?? []).map((g) => g.commandsBlob ?? -1).join(",");
    parts.push(`${t}:${w}x${h}:fg=${fg}:sg=${sg}`);
  }
  return parts.join("|");
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

function hasImageOrGradientFill(node: FigNode): boolean {
  const fp = node.fillPaints;
  if (!fp) {
    return false;
  }
  return fp.some((p) => p.type === "IMAGE" || p.type.startsWith("GRADIENT_"));
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
