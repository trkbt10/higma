/**
 * @file Promote a cluster of strict-byte-identical VECTORs into one
 * SYMBOL plus N INSTANCEs.
 *
 * Where `promote-icon-cluster` handles FRAME/GROUP clusters (the
 * exemplar is already a container with descendants), this helper
 * handles bare VECTORs: the exemplar must be cloned into a fresh
 * SYMBOL hosted on the Internal Only Canvas, and every member VECTOR
 * (including the exemplar at its original location) is rewritten
 * into an INSTANCE that references the new SYMBOL.
 *
 * Algorithm:
 *
 *   1. Build a SYMBOL node under the Internal Only Canvas. The
 *      SYMBOL's only direct child is a clone of the exemplar VECTOR
 *      with `transform = identity` and `parentIndex = SYMBOL.guid`.
 *      The cloned VECTOR carries the same `fillGeometry / strokeGeometry / fillPaints /
 *      strokePaints / strokeWeight / strokeAlign / strokeJoin / size` as the exemplar — i.e. the
 *      strict-byte-identical fields that defined the cluster.
 *   2. Rewrite every member VECTOR (including the original exemplar)
 *      to an INSTANCE whose `symbolData.symbolID` references the new
 *      SYMBOL. The INSTANCE keeps the member's original `size`,
 *      `transform`, and `parentIndex` so positional information stays
 *      intact at the call site.
 *
 * Fail-fast invariants:
 *
 *   - Every member must still resolve to a VECTOR in `loaded.nodeChanges`
 *     at apply time; missing members are reported in the caller's
 *     skipped tally rather than silently dropped.
 *   - The exemplar is the lex-smallest member guid by default. The
 *     plan layer may override.
 */
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { guidToString } from "@higma-document-models/fig/domain";
import { addNodeChange, type GuidAllocator } from "@higma-document-io/fig/roundtrip";

export type PromoteVectorClusterArgs = {
  readonly loaded: LoadedFigFile;
  readonly clusterName: string;
  readonly memberGuids: readonly string[];
  readonly exemplarGuid: string;
  readonly internalCanvasGuid: string;
  readonly allocator: GuidAllocator;
};

export type PromoteVectorResult = {
  readonly symbolGuid: string;
  readonly instanceGuids: readonly string[];
};

function parseGuidString(s: string): FigGuid {
  const [a, b] = s.split(":");
  if (a === undefined || b === undefined) {
    throw new Error(`promoteVectorCluster: bad guid string "${s}"`);
  }
  const sessionID = Number.parseInt(a, 10);
  const localID = Number.parseInt(b, 10);
  if (!Number.isFinite(sessionID) || !Number.isFinite(localID)) {
    throw new Error(`promoteVectorCluster: non-numeric guid "${s}"`);
  }
  return { sessionID, localID };
}

function findByGuid(loaded: LoadedFigFile, guidString: string): FigNode | undefined {
  return loaded.nodeChanges.find((n) => n.guid && guidToString(n.guid) === guidString);
}

function nextSortPosition(loaded: LoadedFigFile, parentGuidString: string): string {
  const positions = loaded.nodeChanges
    .filter((n) => {
      const p = n.parentIndex?.guid;
      if (!p) {
        return false;
      }
      return `${p.sessionID}:${p.localID}` === parentGuidString;
    })
    .map((n) => n.parentIndex?.position ?? "");
  if (positions.length === 0) {
    return "z";
  }
  const max = positions.reduce((best, p) => (p > best ? p : best), positions[0] ?? "");
  return `${max}z`;
}

/** Construct a fresh SYMBOL containing a clone of the exemplar's geometry. */
function emitSymbol(
  loaded: LoadedFigFile,
  exemplar: FigNode,
  clusterName: string,
  internalCanvasGuid: string,
  allocator: GuidAllocator,
): { readonly symbolGuid: FigGuid; readonly clonedVectorGuid: FigGuid } {
  const symbolGuid = allocator.next();
  const clonedVectorGuid = allocator.next();
  const internalParsed = parseGuidString(internalCanvasGuid);
  const symbolNode: FigNode = {
    guid: symbolGuid,
    phase: { value: 0, name: "CREATED" },
    parentIndex: { guid: internalParsed, position: nextSortPosition(loaded, internalCanvasGuid) },
    type: { value: 15, name: "SYMBOL" },
    name: clusterName,
    size: exemplar.size,
    // The SYMBOL sits at identity transform on the canvas. INSTANCEs
    // carry their own transforms back at the call sites.
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
  };
  const clonedVector: FigNode = {
    guid: clonedVectorGuid,
    phase: { value: 0, name: "CREATED" },
    parentIndex: { guid: symbolGuid, position: "z" },
    type: { value: 6, name: "VECTOR" },
    name: `${clusterName}-shape`,
    size: exemplar.size,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    fillGeometry: exemplar.fillGeometry,
    strokeGeometry: exemplar.strokeGeometry,
    fillPaints: exemplar.fillPaints,
    strokePaints: exemplar.strokePaints,
    strokeWeight: exemplar.strokeWeight,
    strokeAlign: exemplar.strokeAlign,
    strokeJoin: exemplar.strokeJoin,
    strokeMiterAngle: exemplar.strokeMiterAngle,
    opacity: exemplar.opacity,
  };
  addNodeChange(loaded, symbolNode);
  addNodeChange(loaded, clonedVector);
  return { symbolGuid, clonedVectorGuid };
}

/** Replace a VECTOR member's entry with an INSTANCE referencing the new SYMBOL. */
function rewriteMemberToInstance(
  loaded: LoadedFigFile,
  memberGuidString: string,
  symbolFigGuid: FigGuid,
): boolean {
  const idx = loaded.nodeChanges.findIndex((n) => n.guid && guidToString(n.guid) === memberGuidString);
  if (idx < 0) {
    return false;
  }
  const member = loaded.nodeChanges[idx];
  if (!member) {
    return false;
  }
  // Snapshot positional fields the INSTANCE needs to keep visually:
  // `transform`, `size`, `parentIndex`. Drop `fillGeometry/strokeGeometry/fillPaints/strokePaints`
  // — they live on the SYMBOL's cloned VECTOR now.
  const replacement: FigNode = {
    guid: member.guid,
    phase: member.phase,
    parentIndex: member.parentIndex,
    type: { value: 16, name: "INSTANCE" },
    name: member.name,
    size: member.size,
    transform: member.transform,
    symbolData: {
      symbolID: symbolFigGuid,
      symbolOverrides: [],
      uniformScaleFactor: 1,
    },
  };
  loaded.nodeChanges[idx] = replacement;
  return true;
}

/**
 * Promote a strict-byte VECTOR cluster: synthesise a fresh SYMBOL on
 * the Internal Only Canvas and turn every member VECTOR into an
 * INSTANCE pointing at it.
 */
export function promoteVectorCluster(args: PromoteVectorClusterArgs): PromoteVectorResult {
  const { loaded, clusterName, memberGuids, exemplarGuid, internalCanvasGuid, allocator } = args;
  if (!memberGuids.includes(exemplarGuid)) {
    throw new Error("promoteVectorCluster: exemplarGuid must be one of memberGuids");
  }
  const exemplar = findByGuid(loaded, exemplarGuid);
  if (!exemplar) {
    throw new Error(`promoteVectorCluster: exemplar ${exemplarGuid} not found`);
  }
  if (exemplar.type?.name !== "VECTOR") {
    throw new Error(`promoteVectorCluster: exemplar ${exemplarGuid} is not a VECTOR (got ${exemplar.type?.name})`);
  }
  const { symbolGuid } = emitSymbol(loaded, exemplar, clusterName, internalCanvasGuid, allocator);
  const symbolGuidString = guidToString(symbolGuid);
  const rewritten: string[] = [];
  for (const memberGuid of memberGuids) {
    const ok = rewriteMemberToInstance(loaded, memberGuid, symbolGuid);
    if (ok) {
      rewritten.push(memberGuid);
    }
  }
  return {
    symbolGuid: symbolGuidString,
    instanceGuids: rewritten,
  };
}
