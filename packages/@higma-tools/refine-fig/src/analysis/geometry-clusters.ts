/**
 * @file VECTOR geometry cluster detection (affine-normalized).
 *
 * Two VECTORs are considered the same shape iff their `commandsBlob`
 * commands, after **bbox normalisation to the unit square**, produce
 * an identical canonical command stream at Float32 precision. Uniform
 * and non-uniform scale are absorbed (20x20 → 40x40 → 60x30 cluster
 * together). Reflections are NOT absorbed in this revision — the
 * apply path would need per-instance flip transforms to recover the
 * original orientation, and that is invasive enough to land
 * separately.
 *
 * There is NO ε tolerance: the comparison is exact once normalised.
 * A 1-pixel-radius corner difference produces a different command
 * stream and therefore a different cluster — exactly the fail-fast
 * property the protocol requires.
 *
 * Pipeline per VECTOR:
 *
 *   1. Decode `fillGeometry[].commandsBlob` and
 *      `strokeGeometry[].commandsBlob` into typed PathCommand arrays.
 *   2. Compute the bbox of every coordinate across all commands.
 *      Reject degenerate shapes (bbox width or height == 0): they
 *      cannot be normalised to a unit square without dividing by zero
 *      and clustering 1D shapes is not what this analysis is for.
 *   3. For each of the 4 reflection variants, transform every
 *      coordinate `(x, y)` to its normalised form and re-serialise to
 *      a deterministic canonical string. Float32 quantisation is
 *      enforced (every coordinate routed through a DataView) so the
 *      same logical value always hashes identically across runs.
 *   4. Hash the 4 canonical strings; the fingerprint is
 *      `min(hash1, hash2, hash3, hash4)` so reflection variants
 *      collapse into one cluster regardless of which orientation came
 *      first in the input.
 *
 * Paint and stroke parameters are folded into the fingerprint
 * unchanged. Two shapes with the same normalised geometry but
 * different colours stay in different clusters — agent intent on
 * combining them is `decisions.geometryClusters[...]` with merged
 * naming, not silent collapse.
 *
 * Limits the design acknowledges:
 *
 *   - Path command order and start point are NOT canonicalised. A
 *     rectangle drawn `M 0 0 L 10 0 L 10 10 L 0 10 Z` and one drawn
 *     `M 10 10 L 0 10 L 0 0 L 10 0 Z` will not cluster despite being
 *     the same shape. Figma's exporter is consistent about ordering so
 *     this is rarely a problem in practice; the fail-fast principle
 *     prevents introducing a heuristic to "guess" a canonical start.
 *   - Axis-aligned reflections (flip-x, flip-y, rot-180) are NOT
 *     absorbed. The normalisation pipeline supports them (see
 *     `canonicaliseOne`) but `normaliseCommands` only emits the
 *     identity reflection's hash. Lifting this restriction requires
 *     apply to write `transform.m00 / m11 = -1` per INSTANCE.
 *   - Rotations other than 180° (90°, 270°) are not absorbed at all.
 */
import type { FigBlob, LoadedFigFile } from "@higma-document-models/fig/domain";
import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import {
  decodePathCommands,
  getNodeType,
  guidToString,
  safeChildren,
} from "@higma-document-models/fig/domain";
import { pathCommandsBoundingBox, type PathCommand } from "@higma-primitives/path";
import { createHash } from "node:crypto";

export type GeometryClusterMember = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly parentGuid: string | undefined;
  readonly width: number;
  readonly height: number;
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

function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Force a JS number through Float32 quantisation. Used everywhere a
 * coordinate is canonicalised so the resulting hash is stable across
 * runs and across machines: two coordinates that map to the same
 * Float32 representation produce the same canonical string, period.
 */
const f32 = new Float32Array(1);
function quantizeF32(x: number): number {
  f32[0] = x;
  return f32[0];
}

type Bbox = { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };

/**
 * Bbox helper for cluster fingerprinting. Delegates to the primitive
 * `pathCommandsBoundingBox` (the SoT) and re-shapes the result into
 * the `{minX, maxX, minY, maxY}` form the normalisation pipeline uses
 * directly. Returns `undefined` for empty / degenerate inputs so
 * `normaliseCommands` can reject them.
 *
 * The primitive's bbox covers every endpoint and every Bézier control
 * point — same definition the previous in-file impl tracked — so the
 * cluster fingerprints stay byte-identical across the migration.
 *
 * The previous impl threw on Arc; the primitive flattens Arc instead.
 * Audit: the only input channel to clustering is `decodePathCommands`,
 * which never emits "A" (the Kiwi blob alphabet has no Arc opcode),
 * so the Arc handling difference is unreachable in production.
 */
function collectCoordsBbox(commands: readonly PathCommand[]): Bbox | undefined {
  if (commands.length === 0) {
    return undefined;
  }
  const bbox = pathCommandsBoundingBox(commands);
  if (bbox.w === 0 && bbox.h === 0) {
    // The primitive returns the zero bbox when no extent-bearing
    // command was seen. Mirror the old impl's "no extent" sentinel
    // so degenerate inputs (a lone `Z`, an empty subpath) still get
    // rejected by `normaliseCommands`.
    const hasExtentSignal = commands.some((c) => c.type !== "Z");
    if (!hasExtentSignal) {
      return undefined;
    }
  }
  return {
    minX: bbox.x,
    maxX: bbox.x + bbox.w,
    minY: bbox.y,
    maxY: bbox.y + bbox.h,
  };
}

type Reflection = "id" | "fx" | "fy" | "r180";

function reflectXY(reflection: Reflection, nx: number, ny: number): { x: number; y: number } {
  if (reflection === "id") {
    return { x: nx, y: ny };
  }
  if (reflection === "fx") {
    return { x: 1 - nx, y: ny };
  }
  if (reflection === "fy") {
    return { x: nx, y: 1 - ny };
  }
  return { x: 1 - nx, y: 1 - ny };
}

function normaliseCommand(cmd: PathCommand, bbox: Bbox, reflection: Reflection): string {
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  const normX = (x: number): number => quantizeF32((x - bbox.minX) / w);
  const normY = (y: number): number => quantizeF32((y - bbox.minY) / h);
  const at = (x: number, y: number): string => {
    const p = reflectXY(reflection, normX(x), normY(y));
    return `${quantizeF32(p.x).toFixed(7)},${quantizeF32(p.y).toFixed(7)}`;
  };
  if (cmd.type === "Z") {
    return "Z";
  }
  if (cmd.type === "M") {
    return `M ${at(cmd.x, cmd.y)}`;
  }
  if (cmd.type === "L") {
    return `L ${at(cmd.x, cmd.y)}`;
  }
  if (cmd.type === "Q") {
    return `Q ${at(cmd.x1, cmd.y1)} ${at(cmd.x, cmd.y)}`;
  }
  if (cmd.type === "C") {
    return `C ${at(cmd.x1, cmd.y1)} ${at(cmd.x2, cmd.y2)} ${at(cmd.x, cmd.y)}`;
  }
  // Arc. The blob decoder (the only callers route through it) never
  // emits "A"; the union sits at the domain layer because every
  // PathCommand consumer reads both the blob and SVG-d channels.
  // Reaching this branch in the geometry-cluster pipeline means we
  // were given SVG-parsed commands, which would defeat the affine-
  // normalised hash (radii and rotation describe an ellipse in the
  // pre-normalisation space and cannot be reflected/rescaled the
  // same way endpoints can). Fail loudly rather than fingerprint
  // an arc to a misleading hash.
  throw new Error(
    "refine-fig.geometry-clusters: unexpected SVG Arc command in VECTOR clustering input — blob-decoded geometry never contains Arc",
  );
}

function canonicaliseOne(commands: readonly PathCommand[], bbox: Bbox, reflection: Reflection): string {
  return commands.map((c) => normaliseCommand(c, bbox, reflection)).join("|");
}

/**
 * Affine-normalised hash for one path commands array.
 *
 * Computes the bbox, rejects degenerate (1-D) shapes, generates 4
 * canonical strings (one per reflection), and returns the
 * lexicographically smallest hash so the same shape always produces
 * the same fingerprint regardless of which reflection happened to be
 * authored first.
 */
function normaliseCommands(commands: readonly PathCommand[]): string | undefined {
  if (commands.length === 0) {
    return "empty";
  }
  const bbox = collectCoordsBbox(commands);
  if (!bbox) {
    return undefined;
  }
  if (bbox.maxX - bbox.minX === 0 || bbox.maxY - bbox.minY === 0) {
    // Degenerate (single-axis) shape — clustering it would require a
    // 1-D normalisation pass which is intentionally out of scope.
    return undefined;
  }
  // Identity-only normalisation: the bbox absorbs uniform AND
  // non-uniform scale, but reflections stay distinct. This keeps
  // promote-vector-cluster simple — every cluster member's commands
  // render identically once scaled to the INSTANCE.size, with no
  // per-instance flip transform needed. Reflection absorption is
  // tracked as a follow-up; the apply path would need to write
  // `transform.m00 / m11 = ±1` per INSTANCE to recover the original
  // orientation, which is invasive enough to land separately.
  return sha256Hex(new TextEncoder().encode(canonicaliseOne(commands, bbox, "id")));
}

function blobToCommands(blob: FigBlob | undefined): readonly PathCommand[] | undefined {
  if (!blob) {
    return undefined;
  }
  try {
    return decodePathCommands(blob);
  } catch (err) {
    // A malformed blob disqualifies the VECTOR from clustering; the
    // caller emits a `badblob:` token in the fingerprint instead of
    // silently treating two different-but-malformed blobs as equal.
    void err;
    return undefined;
  }
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
    const commands = blobToCommands(blob);
    if (!commands) {
      parts.push(`badblob:${idx}`);
      continue;
    }
    const fp = normaliseCommands(commands);
    if (!fp) {
      parts.push(`degenerate:${idx}`);
      continue;
    }
    parts.push(fp);
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
  // size.x / size.y are intentionally not part of the fingerprint:
  // bbox normalisation already absorbs scale, and including the raw
  // size would split shape-identical-but-different-size clusters back
  // apart. The node still needs *some* size to be renderable, so we
  // reject sizeless or zero-area nodes outright.
  if (!node.size || node.size.x <= 0 || node.size.y <= 0) {
    return undefined;
  }
  const fillBlobs = blobsFingerprint(loaded, node.fillGeometry);
  const strokeBlobs = blobsFingerprint(loaded, node.strokeGeometry);
  if (fillBlobs === "none" && strokeBlobs === "none") {
    // No geometry to cluster on.
    return undefined;
  }
  const fillPaints = paintsFingerprint(node.fillPaints);
  const strokePaints = paintsFingerprint(node.strokePaints);
  // Reject any cluster that touches a GRADIENT — same reasoning as in
  // promote-icon-cluster: handle positions are node-relative.
  if (fillPaints.includes(":reject") || strokePaints.includes(":reject")) {
    return undefined;
  }
  // Stroke weight is rendered relative to the node size; including it
  // unscaled would re-fragment what bbox normalisation just unified.
  // Scaling stroke weight by the node's smaller dimension keeps two
  // INSTANCEs of the same SYMBOL visually consistent.
  const minDim = Math.min(node.size.x, node.size.y);
  const swRaw = typeof node.strokeWeight === "number" ? node.strokeWeight : Number.NaN;
  const swNormalised = Number.isFinite(swRaw) && minDim > 0 ? quantizeF32(swRaw / minDim).toFixed(6) : "none";
  const sa = node.strokeAlign ?? "DEFAULT";
  const sj = node.strokeJoin ?? "DEFAULT";
  const sm = typeof node.strokeMiterAngle === "number" ? node.strokeMiterAngle : "none";
  const opacity = typeof node.opacity === "number" ? node.opacity : 1;
  return [
    `fillBlobs:${fillBlobs}`,
    `strokeBlobs:${strokeBlobs}`,
    `fillPaints:${fillPaints}`,
    `strokePaints:${strokePaints}`,
    `swNorm:${swNormalised}`,
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
    const size = vec.size;
    if (!size) {
      continue;
    }
    const member: GeometryClusterMember = {
      nodeGuid: guidToString(vec.guid),
      nodeName: vec.name ?? "(unnamed)",
      parentGuid: parent ? guidToString(parent) : undefined,
      width: size.x,
      height: size.y,
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
    const clusterHash = sha256Hex(new TextEncoder().encode(fingerprint)).slice(0, 12);
    // Member ordering: lex-smallest guid first (matches the exemplar-
    // selection rule in componentize).
    const sorted = [...members].sort((a, b) => (a.nodeGuid < b.nodeGuid ? -1 : a.nodeGuid > b.nodeGuid ? 1 : 0));
    const exemplar = sorted[0];
    if (!exemplar) {
      continue;
    }
    clusters.push({
      clusterId: `vec-${clusterHash}`,
      fingerprint,
      width: Math.round(exemplar.width),
      height: Math.round(exemplar.height),
      members: sorted,
    });
  }
  // Largest clusters first — agent reads "high-impact" shapes top-down.
  clusters.sort((a, b) => b.members.length - a.members.length);
  return { clusters };
}
