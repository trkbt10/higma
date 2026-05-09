/**
 * @file Detect repeated subtrees that look like the same component.
 *
 * Pipeline:
 *   1. Walk every FRAME / GROUP / INSTANCE in the user-visible
 *      canvases.
 *   2. Bucket by `roleSignature` (depth-bounded). Buckets of size >= 3
 *      are candidates.
 *   3. For each candidate bucket, render every member to a small PNG
 *      and compute a perceptual hash. Members within a hamming
 *      threshold collapse into a *visual cluster*.
 *   4. Visual clusters with >= 3 members and consistent size become
 *      `DuplicateCluster`s — concrete componentisation candidates.
 *
 * Visual confirmation prevents the "two unrelated cards happen to
 * share a generic FRAME(VECTOR(),TEXT()) shape" false positive.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import { roleSignature, structuralSignature } from "./subtree-signature";
import type { NodeRenderer } from "../visual/render-node";
import { perceptualHash, combinedDistance } from "../visual/perceptual-hash";
import type { PerceptualHash } from "../visual/perceptual-hash";

const CANDIDATE_TYPES = new Set(["FRAME", "GROUP", "INSTANCE"]);
const MIN_CANDIDATE_DIM = 16;
const MAX_DEPTH = 4;
const MIN_BUCKET_SIZE = 3;
const VISUAL_HASH_THRESHOLD = 18;

export type DuplicateMember = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly width: number;
  readonly height: number;
  readonly hash: PerceptualHash;
};

export type DuplicateCluster = {
  /** Stable cluster id — derived from role signature + size class. */
  readonly clusterId: string;
  readonly roleSignature: string;
  readonly structuralSignature: string;
  readonly members: readonly DuplicateMember[];
  /** Rough size class — averaged width × height (pre-clustering). */
  readonly sizeClass: { readonly width: number; readonly height: number };
  /** Suggested component name (slug-style). */
  readonly suggestedName: string;
};

export type UnrenderableNote = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly reason: string;
};

export type DuplicateAnalysis = {
  readonly clusters: readonly DuplicateCluster[];
  /** Diagnostic — buckets we considered but discarded. */
  readonly rejectedBuckets: number;
  /**
   * Subtrees we attempted to render but the renderer rejected (commonly:
   * missing fonts on the host OS). Reported so the caller knows why some
   * clusters might be smaller than expected.
   */
  readonly unrenderable: readonly UnrenderableNote[];
};

type Candidate = {
  readonly node: FigNode;
  readonly width: number;
  readonly height: number;
};

function collectCandidates(node: FigNode, out: Candidate[]): void {
  const t = getNodeType(node);
  if (CANDIDATE_TYPES.has(t)) {
    const sz = node.size;
    if (sz && sz.x >= MIN_CANDIDATE_DIM && sz.y >= MIN_CANDIDATE_DIM) {
      out.push({ node, width: sz.x, height: sz.y });
    }
  }
  for (const child of safeChildren(node)) {
    collectCandidates(child, out);
  }
}

function sizeClassKey(c: Candidate): string {
  // Bucket dims to nearest 16 for a coarse pre-cluster.
  const w = Math.round(c.width / 16);
  const h = Math.round(c.height / 16);
  return `${w}x${h}`;
}

function suggestNameFor(node: FigNode, sig: string): string {
  // Only look at the immediate name. Placeholder names like "Frame N"
  // and "Group" get a structurally-derived fallback, otherwise the
  // existing name slug is reused so authored intent is respected.
  const raw = (node.name ?? "").trim();
  if (!raw || /^frame[\s_-]?\d+$/i.test(raw) || raw === "Group" || raw === "Frame") {
    return slugFromSignature(sig);
  }
  return slug(raw);
}

function slug(text: string): string {
  return text
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function slugFromSignature(sig: string): string {
  // Coarse: "FRAME<row>(ELLIPSE<avatar>...)" → "row-with-avatar"
  if (sig.includes("<avatar>")) {
    if (sig.includes("text-block")) {
      return "comment-row";
    }
    return "avatar-row";
  }
  if (sig.includes("<thumbnail>")) {
    return "media-card";
  }
  if (sig.includes("<icon>")) {
    if (sig.includes("text-line")) {
      return "icon-label";
    }
    return "icon-tile";
  }
  if (sig.includes("<button-bg>") && sig.includes("text-line")) {
    return "button";
  }
  if (sig.includes("text-block")) {
    return "text-card";
  }
  if (sig.includes("<row>")) {
    return "list-row";
  }
  return "component";
}

async function clusterByVisualHash(
  candidates: readonly Candidate[],
  renderer: NodeRenderer,
  onUnrenderable: (cand: Candidate, error: unknown) => void,
): Promise<readonly { readonly members: DuplicateMember[]; readonly hash: PerceptualHash }[]> {
  type RealCluster = { members: DuplicateMember[]; hash: PerceptualHash };
  const out: RealCluster[] = [];
  for (const cand of candidates) {
    const rendered = await tryRender(renderer, cand);
    if (rendered.kind === "skipped") {
      onUnrenderable(cand, rendered.error);
      continue;
    }
    if (!rendered.value) {
      continue;
    }
    const hash = perceptualHash(rendered.value.png);
    const member: DuplicateMember = {
      nodeGuid: guidToString(cand.node.guid),
      nodeName: cand.node.name ?? "(unnamed)",
      width: cand.width,
      height: cand.height,
      hash,
    };
    const matched = out.find((cluster) => combinedDistance(cluster.hash, hash) <= VISUAL_HASH_THRESHOLD);
    if (matched) {
      matched.members.push(member);
      continue;
    }
    out.push({ members: [member], hash });
  }
  return out;
}

type RenderAttempt =
  | { readonly kind: "rendered"; readonly value: { readonly png: Uint8Array } | undefined }
  | { readonly kind: "skipped"; readonly error: unknown };

async function tryRender(renderer: NodeRenderer, cand: Candidate): Promise<RenderAttempt> {
  try {
    const rendered = await renderer.render(cand.node, { maxRasterWidth: 256 });
    return { kind: "rendered", value: rendered };
  } catch (error) {
    return { kind: "skipped", error };
  }
}

/** Run the duplicate-detection pipeline. */
export async function detectDuplicates(
  frames: readonly FigNode[],
  renderer: NodeRenderer,
): Promise<DuplicateAnalysis> {
  const all: Candidate[] = [];
  for (const frame of frames) {
    collectCandidates(frame, all);
  }
  // Bucket by (role signature × size class). The size class keeps a
  // "card" 360×120 from clustering with a "card" 180×60.
  const buckets = new Map<string, Candidate[]>();
  for (const c of all) {
    const sig = roleSignature(c.node, MAX_DEPTH);
    const key = `${sig}|${sizeClassKey(c)}`;
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }
  const small = [...buckets.entries()].filter(([, m]) => m.length < MIN_BUCKET_SIZE);
  const big = [...buckets.entries()].filter(([, m]) => m.length >= MIN_BUCKET_SIZE);
  const clusters: DuplicateCluster[] = [];
  const unrenderable: UnrenderableNote[] = [];
  for (const [key, members] of big) {
    const visual = await clusterByVisualHash(members, renderer, (cand, error) => {
      unrenderable.push({
        nodeGuid: guidToString(cand.node.guid),
        nodeName: cand.node.name ?? "(unnamed)",
        reason: error instanceof Error ? error.message : String(error),
      });
    });
    for (const v of visual) {
      if (v.members.length < MIN_BUCKET_SIZE) {
        continue;
      }
      const node = members[0]?.node;
      if (!node) {
        continue;
      }
      const sig = roleSignature(node, MAX_DEPTH);
      const struct = structuralSignature(node, MAX_DEPTH);
      const avgW = v.members.reduce((sum, m) => sum + m.width, 0) / v.members.length;
      const avgH = v.members.reduce((sum, m) => sum + m.height, 0) / v.members.length;
      clusters.push({
        clusterId: `${slugFromSignature(sig)}-${key}`.replace(/\W+/g, "_"),
        roleSignature: sig,
        structuralSignature: struct,
        members: v.members,
        sizeClass: { width: Math.round(avgW), height: Math.round(avgH) },
        suggestedName: suggestNameFor(node, sig),
      });
    }
  }
  // Sort by member count desc to make the report easy to read.
  clusters.sort((a, b) => b.members.length - a.members.length);
  return { clusters, rejectedBuckets: small.length, unrenderable };
}
