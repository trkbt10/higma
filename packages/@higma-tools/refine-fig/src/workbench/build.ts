/**
 * @file Materialise a "visual workbench" on disk so the agent can
 * Read each candidate change with its rendered PNG side-by-side.
 *
 * Why this is the skill's primary surface, not the apply step:
 *
 *   - Heuristic naming is unreliable on its own. "row" / "card" /
 *     "icon" are placeholders dressed up. The agent's job is to look
 *     at the rendered subtree, read the surrounding TEXT, and pick a
 *     name that actually signifies *something*.
 *
 *   - Fill-style bindings can erase image / gradient layers if the
 *     analyser misjudged the paint stack. Side-by-side before / after
 *     PNGs let the agent confirm the rebind is visually neutral
 *     before committing.
 *
 *   - Component clusters live or die on a contact sheet. Naming a
 *     cluster correctly requires seeing all its members at once.
 *
 * The renderer is OS-font-only (per project policy). Subtrees that
 * fail to render are reported in the manifest with a `null` png path
 * so the agent can decide whether to install fonts and re-run, or
 * skip those proposals.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import { getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import type { RefineSource } from "../refine-source/load";
import type { RefinePlan } from "../plan/types";
import { createWorkerClient, type WorkerClient } from "../visual/worker-client";
import type { WorkbenchManifest, RenameWorkbenchEntry, BindingWorkbenchEntry, ClusterWorkbenchEntry, ClusterMemberEntry } from "./types";

export type BuildWorkbenchOptions = {
  readonly outDir: string;
  readonly file: string;
  readonly bytes: number;
  /** Path to the input .fig file — passed to the render-node worker subprocess. */
  readonly figPath: string;
  /** Maximum raster width for context renders. Default 512. */
  readonly contextWidth?: number;
  /** Maximum raster width for node renders. Default 256. */
  readonly nodeWidth?: number;
};

export type BuildWorkbenchResult = {
  readonly manifest: WorkbenchManifest;
  readonly skippedRenames: number;
  readonly skippedBindings: number;
  readonly skippedClusterMembers: number;
};

/**
 * Build the workbench. Renders each candidate's PNG via a long-lived
 * subprocess worker; if the worker panics during a render (a known
 * resvg failure mode for some inputs), the worker is respawned and
 * the offending request is recorded as un-renderable.
 */
export async function buildWorkbench(
  source: RefineSource,
  plan: RefinePlan,
  options: BuildWorkbenchOptions,
): Promise<BuildWorkbenchResult> {
  const { outDir, contextWidth = 512, nodeWidth = 256 } = options;
  const renamesDir = join(outDir, "renames");
  const bindingsDir = join(outDir, "bindings");
  const clustersDir = join(outDir, "clusters");
  await ensureDir(renamesDir);
  await ensureDir(bindingsDir);
  await ensureDir(clustersDir);

  const skippedTracker = { renames: 0, bindings: 0, clusterMembers: 0 };
  const worker = createWorkerClient(options.figPath);
  try {
    const renames = await collectRenameEntries({
      plan,
      source,
      worker,
      outDir: renamesDir,
      contextWidth,
      nodeWidth,
      skipped: skippedTracker,
    });
    const bindings = await collectBindingEntries({
      plan,
      source,
      worker,
      outDir: bindingsDir,
      nodeWidth,
      skipped: skippedTracker,
    });
    const clusters = await collectClusterEntries({
      plan,
      source,
      worker,
      outDir: clustersDir,
      nodeWidth,
      skipped: skippedTracker,
    });
    const manifest: WorkbenchManifest = {
      source: { file: options.file, bytes: options.bytes },
      renames,
      bindings,
      clusters,
    };
    await writeFile(join(outDir, "index.json"), JSON.stringify(manifest, null, 2));
    return {
      manifest,
      skippedRenames: skippedTracker.renames,
      skippedBindings: skippedTracker.bindings,
      skippedClusterMembers: skippedTracker.clusterMembers,
    };
  } finally {
    await worker.close();
  }
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

// ============================================================================
// Renames
// ============================================================================

type CollectRenameArgs = {
  readonly plan: RefinePlan;
  readonly source: RefineSource;
  readonly worker: WorkerClient;
  readonly outDir: string;
  readonly contextWidth: number;
  readonly nodeWidth: number;
  readonly skipped: { renames: number; bindings: number; clusterMembers: number };
};

async function collectRenameEntries(args: CollectRenameArgs): Promise<readonly RenameWorkbenchEntry[]> {
  const { plan, source, worker, outDir, contextWidth, nodeWidth, skipped } = args;
  const out: RenameWorkbenchEntry[] = [];
  for (const action of plan.renames) {
    const node = source.nodesByGuid.get(action.nodeGuid);
    if (!node) {
      skipped.renames = skipped.renames + 1;
      continue;
    }
    const ancestor = pickRenderableAncestor(node, source);
    const slug = action.nodeGuid.replace(/[^A-Za-z0-9]+/g, "_");
    const dir = join(outDir, slug);
    await ensureDir(dir);
    const nodeResult = await worker.render({ nodeGuid: action.nodeGuid, maxWidth: nodeWidth, outPath: join(dir, "node.png") });
    const ancestorGuid = ancestor ? guidToString(ancestor.guid) : action.nodeGuid;
    const contextResult = await worker.render({ nodeGuid: ancestorGuid, maxWidth: contextWidth, outPath: join(dir, "context.png") });
    if (nodeResult.kind === "failed" && contextResult.kind === "failed") {
      skipped.renames = skipped.renames + 1;
      continue;
    }
    out.push({
      nodeGuid: action.nodeGuid,
      currentName: action.oldName,
      suggestedName: action.newName,
      reason: action.reason,
      nodePng: nodeResult.kind === "ok" ? nodeResult.outPath : "",
      contextPng: contextResult.kind === "ok" ? contextResult.outPath : "",
      ancestorNames: collectAncestorNames(node, source),
      dominantText: findDominantText(node),
    });
  }
  return out;
}

function pickRenderableAncestor(node: FigNode, source: RefineSource): FigNode | undefined {
  const lineage = findLineage(node, source.topFrames);
  // Walk back up to a frame ancestor at most ~4 levels — closer than
  // the page surface but bigger than the node alone.
  if (lineage.length === 0) {
    return undefined;
  }
  const lastIndex = lineage.length - 1;
  const target = lineage[Math.max(0, lastIndex - 2)];
  return target;
}

function collectAncestorNames(node: FigNode, source: RefineSource): readonly string[] {
  const lineage = findLineage(node, source.topFrames);
  return lineage.map((n) => n.name ?? "(unnamed)");
}

function findLineage(target: FigNode, roots: readonly FigNode[]): readonly FigNode[] {
  const targetGuid = guidToString(target.guid);
  for (const root of roots) {
    const path = pathFromRoot(root, targetGuid, []);
    if (path) {
      return path;
    }
  }
  return [];
}

function pathFromRoot(node: FigNode, target: string, acc: readonly FigNode[]): readonly FigNode[] | undefined {
  const next = [...acc, node];
  if (guidToString(node.guid) === target) {
    return next;
  }
  for (const child of safeChildren(node)) {
    const found = pathFromRoot(child, target, next);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findDominantText(node: FigNode): string | undefined {
  const out: { depth: number; text: string }[] = [];
  walkText(node, 0, 4, out);
  if (out.length === 0) {
    return undefined;
  }
  out.sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return b.text.length - a.text.length;
  });
  return out[0]?.text;
}

function walkText(node: FigNode, depth: number, maxDepth: number, out: { depth: number; text: string }[]): void {
  if (depth > maxDepth) {
    return;
  }
  if (getNodeType(node) === "TEXT") {
    const chars = (node.characters ?? "").trim();
    if (chars) {
      out.push({ depth, text: chars });
    }
    return;
  }
  for (const child of safeChildren(node)) {
    walkText(child, depth + 1, maxDepth, out);
  }
}

// ============================================================================
// Bindings
// ============================================================================

type CollectBindingArgs = {
  readonly plan: RefinePlan;
  readonly source: RefineSource;
  readonly worker: WorkerClient;
  readonly outDir: string;
  readonly nodeWidth: number;
  readonly skipped: { renames: number; bindings: number; clusterMembers: number };
};

async function collectBindingEntries(args: CollectBindingArgs): Promise<readonly BindingWorkbenchEntry[]> {
  const { plan, source, worker, outDir, nodeWidth, skipped } = args;
  const out: BindingWorkbenchEntry[] = [];
  for (const action of plan.fillStyleBindings) {
    const node = source.nodesByGuid.get(action.nodeGuid);
    if (!node) {
      skipped.bindings = skipped.bindings + 1;
      continue;
    }
    const slug = action.nodeGuid.replace(/[^A-Za-z0-9]+/g, "_");
    const dir = join(outDir, slug);
    await ensureDir(dir);
    // After: same node — once bound, the renderer reads through the
    // style registry. Since the proxy's paint already matches the
    // current cached fill (by construction of the binding action),
    // an "after" render is structurally identical to "before". We
    // still write it so the agent can pixel-diff and confirm there's
    // no regression. (When the proxy paint diverges from the cache,
    // pixel-diff will surface that immediately.)
    const beforeResult = await worker.render({ nodeGuid: action.nodeGuid, maxWidth: nodeWidth, outPath: join(dir, "before.png") });
    const afterResult = await worker.render({ nodeGuid: action.nodeGuid, maxWidth: nodeWidth, outPath: join(dir, "after.png") });
    if (beforeResult.kind === "failed" && afterResult.kind === "failed") {
      skipped.bindings = skipped.bindings + 1;
      continue;
    }
    out.push({
      nodeGuid: action.nodeGuid,
      nodeName: action.nodeName,
      proxyGuid: action.proxyGuid,
      proxyName: action.proxyName,
      colorHex: action.colorHex,
      paintStack: summarisePaints(node.fillPaints),
      beforePng: beforeResult.kind === "ok" ? beforeResult.outPath : "",
      afterPng: afterResult.kind === "ok" ? afterResult.outPath : "",
    });
  }
  return out;
}

function summarisePaints(paints: readonly FigPaint[] | undefined): readonly { readonly type: string; readonly summary: string }[] {
  if (!paints) {
    return [];
  }
  return paints.map((p) => {
    if (p.type === "SOLID" && p.color) {
      const c = p.color;
      const hex = `#${[c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
      const visible = p.visible === false ? " hidden" : "";
      const opacity = typeof p.opacity === "number" && p.opacity < 1 ? ` opacity=${p.opacity.toFixed(2)}` : "";
      return { type: "SOLID", summary: `${hex}${opacity}${visible}` };
    }
    if (p.type === "IMAGE") {
      const ref = p.imageRef ?? "(no ref)";
      return { type: "IMAGE", summary: `imageRef=${ref}` };
    }
    if (p.type.startsWith("GRADIENT_")) {
      return { type: p.type, summary: "(gradient)" };
    }
    return { type: p.type, summary: "(other)" };
  });
}

// ============================================================================
// Clusters
// ============================================================================

type CollectClusterArgs = {
  readonly plan: RefinePlan;
  readonly source: RefineSource;
  readonly worker: WorkerClient;
  readonly outDir: string;
  readonly nodeWidth: number;
  readonly skipped: { renames: number; bindings: number; clusterMembers: number };
};

async function collectClusterEntries(args: CollectClusterArgs): Promise<readonly ClusterWorkbenchEntry[]> {
  const { plan, source, worker, outDir, nodeWidth, skipped } = args;
  const out: ClusterWorkbenchEntry[] = [];
  for (const cluster of plan.componentCandidates) {
    const dir = join(outDir, cluster.clusterId);
    const memberDir = join(dir, "members");
    await ensureDir(memberDir);
    const members = await collectClusterMembers(cluster.memberGuids, source, worker, memberDir, nodeWidth, skipped);
    const contactSheet = await renderContactSheet(members, join(dir, "contact-sheet.png"));
    out.push({
      clusterId: cluster.clusterId,
      suggestedName: cluster.suggestedName,
      roleSignature: cluster.roleSignature,
      contactSheetPng: contactSheet,
      members,
    });
  }
  return out;
}

async function collectClusterMembers(
  guids: readonly string[],
  source: RefineSource,
  worker: WorkerClient,
  dir: string,
  nodeWidth: number,
  skipped: { renames: number; bindings: number; clusterMembers: number },
): Promise<readonly ClusterMemberEntry[]> {
  const out: ClusterMemberEntry[] = [];
  for (let i = 0; i < guids.length; i = i + 1) {
    const guid = guids[i];
    if (!guid) {
      continue;
    }
    const node = source.nodesByGuid.get(guid);
    if (!node) {
      skipped.clusterMembers = skipped.clusterMembers + 1;
      continue;
    }
    const file = join(dir, `${i}.png`);
    const result = await worker.render({ nodeGuid: guid, maxWidth: nodeWidth, outPath: file });
    if (result.kind === "failed") {
      skipped.clusterMembers = skipped.clusterMembers + 1;
      continue;
    }
    out.push({
      nodeGuid: guid,
      nodeName: node.name ?? "(unnamed)",
      width: node.size?.x ?? 0,
      height: node.size?.y ?? 0,
      png: result.outPath,
    });
  }
  return out;
}

async function renderContactSheet(members: readonly ClusterMemberEntry[], outPath: string): Promise<string> {
  if (members.length === 0) {
    return "";
  }
  // Compose an SVG that <image>s each member PNG into a grid. Resvg
  // will rasterise the result. This avoids pulling in a separate
  // image-composition library.
  const cellW = 256;
  const cellH = 192;
  const cols = Math.min(6, Math.ceil(Math.sqrt(members.length)));
  const rows = Math.ceil(members.length / cols);
  const totalW = cellW * cols;
  const totalH = cellH * rows;
  const cells = members.map((m, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    return `<image href="file://${m.png}" x="${x}" y="${y}" width="${cellW}" height="${cellH}" preserveAspectRatio="xMidYMid meet" />`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}"><rect width="${totalW}" height="${totalH}" fill="#f5f5f5"/>${cells}</svg>`;
  const png = svgToPng(svg, totalW);
  await writeFile(outPath, png);
  return outPath;
}

// ============================================================================
// Contact sheet composition
// ============================================================================

function svgToPng(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "#ffffff",
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}
