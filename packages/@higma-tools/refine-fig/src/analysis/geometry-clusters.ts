/**
 * @file Strict-byte VECTOR geometry cluster detection.
 *
 * Walks every VECTOR in the user-visible canvases and groups them by
 * a deterministic fingerprint that admits zero heuristic tolerance:
 *
 *   - SHA-256 of the `fillGeometry[].commandsBlob` and
 *     `strokeGeometry[].commandsBlob` bytes (path commands stored
 *     verbatim in `loaded.blobs[].bytes`)
 *   - Integer `size.x × size.y`
 *   - Stroke parameters that affect rendering (`strokeWeight`,
 *     `strokeAlign`, `strokeJoin`, `strokeMiterAngle`)
 *   - Paint fingerprint: SOLID colour quantised to 3 decimals + IMAGE
 *     `imageRef` + opacity / blendMode / visible flag, in stack order
 *
 * Two VECTORs land in the same cluster iff every byte and every
 * numeric agree. There is no perceptual tolerance, no path-command
 * decode, no bbox normalisation. The point is to identify VECTORs
 * that Figma's renderer would draw identical pixels for — anything
 * looser would silently merge shapes that diverge by one path
 * coordinate.
 *
 * Clusters with member count >= 2 are surfaced. The exemplar is the
 * lex-smallest `nodeGuid`, matching the deterministic choice in
 * `componentize/promote-icon-cluster.ts`.
 */
import type { FigBlob, LoadedFigFile } from "@higma-document-models/fig/domain";
import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import { getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import { createHash } from "node:crypto";

export type GeometryClusterMember = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly parentGuid: string | undefined;
};

export type GeometryCluster = {
  /** Stable cluster id derived from the fingerprint hash. */
  readonly clusterId: string;
  readonly fingerprint: string;
  readonly width: number;
  readonly height: number;
  readonly members: readonly GeometryClusterMember[];
};

export type GeometryClusterAnalysis = {
  readonly clusters: readonly GeometryCluster[];
};

function bytesOf(blob: FigBlob | undefined): Uint8Array | undefined {
  if (!blob) {
    return undefined;
  }
  const raw = blob.bytes;
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (Array.isArray(raw)) {
    return new Uint8Array(raw);
  }
  return undefined;
}

function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function blobsFingerprint(
  loaded: LoadedFigFile,
  geometries: readonly { readonly commandsBlob?: number }[] | undefined,
): string {
  if (!geometries || geometries.length === 0) {
    return "none";
  }
  const parts: string[] = [];
  for (const g of geometries) {
    const idx = g.commandsBlob;
    if (idx === undefined) {
      parts.push("nil");
      continue;
    }
    const blob = loaded.blobs[idx];
    const bytes = bytesOf(blob);
    if (!bytes) {
      parts.push(`badblob:${idx}`);
      continue;
    }
    parts.push(sha256Hex(bytes));
  }
  return parts.join(",");
}

function paintsFingerprint(paints: readonly FigPaint[] | undefined): string {
  if (!paints || paints.length === 0) {
    return "none";
  }
  return paints
    .map((p) => {
      const visible = p.visible !== false;
      const opacity = p.opacity ?? 1;
      const blend = p.blendMode ?? "NORMAL";
      if (p.type === "SOLID") {
        const c = p.color;
        const r = c ? c.r.toFixed(3) : "0";
        const g = c ? c.g.toFixed(3) : "0";
        const b = c ? c.b.toFixed(3) : "0";
        const a = c ? c.a.toFixed(3) : "1";
        return `SOLID(${r},${g},${b},${a}):op=${opacity}:vis=${visible}:bl=${blend}`;
      }
      if (p.type === "IMAGE") {
        const ref = typeof p.imageRef === "string" ? p.imageRef : "";
        return `IMAGE(${ref}):op=${opacity}:vis=${visible}:bl=${blend}`;
      }
      // GRADIENT paints would make per-INSTANCE handle positions
      // diverge — exclude clusters containing them by returning an
      // unstable sentinel that no other paint can collide with.
      return `${p.type}:reject`;
    })
    .join(";");
}

function vectorFingerprint(loaded: LoadedFigFile, node: FigNode): string | undefined {
  if (!node.size) {
    return undefined;
  }
  const width = Math.round(node.size.x);
  const height = Math.round(node.size.y);
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  const fillBlobs = blobsFingerprint(loaded, node.fillGeometry);
  const strokeBlobs = blobsFingerprint(loaded, node.strokeGeometry);
  const fillPaints = paintsFingerprint(node.fillPaints);
  const strokePaints = paintsFingerprint(node.strokePaints);
  // Reject any cluster that touches a GRADIENT — same reasoning as in
  // promote-icon-cluster: handle positions are node-relative.
  if (fillPaints.includes(":reject") || strokePaints.includes(":reject")) {
    return undefined;
  }
  const sw = typeof node.strokeWeight === "number" ? node.strokeWeight : "obj";
  const sa = node.strokeAlign ?? "DEFAULT";
  const sj = node.strokeJoin ?? "DEFAULT";
  const sm = typeof node.strokeMiterAngle === "number" ? node.strokeMiterAngle : "none";
  const opacity = typeof node.opacity === "number" ? node.opacity : 1;
  return [
    `${width}x${height}`,
    `fillBlobs:${fillBlobs}`,
    `strokeBlobs:${strokeBlobs}`,
    `fillPaints:${fillPaints}`,
    `strokePaints:${strokePaints}`,
    `sw:${sw}`,
    `sa:${sa}`,
    `sj:${sj}`,
    `sm:${sm}`,
    `op:${opacity}`,
  ].join("|");
}

function walkVectors(node: FigNode, out: FigNode[]): void {
  if (getNodeType(node) === "VECTOR") {
    out.push(node);
  }
  for (const child of safeChildren(node)) {
    walkVectors(child, out);
  }
}

/**
 * Detect strict-equal VECTOR groups across a set of root FRAMEs.
 * Strict means byte-equal `commandsBlob`, integer-equal size, same
 * paint stack, and same stroke parameters. No heuristic tolerance.
 */
export function detectGeometryClusters(
  loaded: LoadedFigFile,
  roots: readonly FigNode[],
): GeometryClusterAnalysis {
  const vectors: FigNode[] = [];
  for (const root of roots) {
    walkVectors(root, vectors);
  }
  const byFingerprint = new Map<string, GeometryClusterMember[]>();
  for (const vec of vectors) {
    const fp = vectorFingerprint(loaded, vec);
    if (!fp) {
      continue;
    }
    const parent = vec.parentIndex?.guid;
    const member: GeometryClusterMember = {
      nodeGuid: guidToString(vec.guid),
      nodeName: vec.name ?? "(unnamed)",
      parentGuid: parent ? guidToString(parent) : undefined,
    };
    const arr = byFingerprint.get(fp) ?? [];
    arr.push(member);
    byFingerprint.set(fp, arr);
  }
  const clusters: GeometryCluster[] = [];
  for (const [fingerprint, members] of byFingerprint) {
    if (members.length < 2) {
      continue;
    }
    // Stable cluster id: short hash of the fingerprint. The full
    // fingerprint is also kept so the agent can audit what made two
    // VECTORs cluster together.
    const clusterHash = sha256Hex(new TextEncoder().encode(fingerprint)).slice(0, 12);
    // Size is the integer width/height that drove the fingerprint;
    // pull it back off the first member for the record.
    const first = members[0];
    if (!first) {
      continue;
    }
    const m0Match = /(\d+)x(\d+)\|/u.exec(fingerprint);
    const width = m0Match ? Number(m0Match[1]) : 0;
    const height = m0Match ? Number(m0Match[2]) : 0;
    // Deterministic member ordering: lex-smallest guid first (matches
    // the exemplar-selection rule in componentize).
    const sorted = [...members].sort((a, b) => (a.nodeGuid < b.nodeGuid ? -1 : a.nodeGuid > b.nodeGuid ? 1 : 0));
    clusters.push({
      clusterId: `vec-${clusterHash}`,
      fingerprint,
      width,
      height,
      members: sorted,
    });
  }
  // Largest clusters first — agent reads "high-impact" shapes top-down.
  clusters.sort((a, b) => b.members.length - a.members.length);
  return { clusters };
}
