#!/usr/bin/env bun
/**
 * @file Long-lived subprocess worker that renders nodes from a `.fig`
 * file to PNGs.
 *
 * Why a worker, not in-process rendering: `@resvg/resvg-js` panics
 * inside native Rust code on a small set of inputs (zero-area
 * geometry, malformed SVG paths). A native panic is not catchable
 * from JS — it kills the host process. Running renders in a
 * subprocess means the parent observes a non-zero exit code, can
 * respawn, and the workbench loop survives.
 *
 * Protocol over stdio:
 *   - Worker is started with argv[2] = path to the input .fig.
 *   - Parent writes one JSON request per line on the worker's stdin.
 *     Request shape: { id, nodeGuid, maxWidth, outPath }
 *   - Worker writes one JSON response per line on its stdout.
 *     Response shape: { id, ok: true } | { id, ok: false, error }
 *   - On EOF or `process.exit`, worker exits cleanly.
 *
 * The worker loads the .fig once at startup. After a panic, the
 * parent respawns it with the same args and resumes from the next
 * pending request — the failed one is recorded as un-renderable.
 */
import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { buildNodeTree, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-io/fig/roundtrip";
import { renderFigToSvg } from "@higma-document-renderers/fig/svg";
import { createCachingFontLoader, figmaFontToQuery } from "@higma-document-renderers/fig/font";
import { createNodeFontLoader } from "@higma-document-renderers/fig/font-drivers/node";
import type { FontLoader } from "@higma-document-renderers/fig/font";
import { Resvg } from "@resvg/resvg-js";

type WorkerRequest = {
  readonly id: string;
  readonly nodeGuid: string;
  readonly maxWidth: number;
  readonly outPath: string;
};

type WorkerResponse =
  | { readonly id: string; readonly ok: true }
  | { readonly id: string; readonly ok: false; readonly error: string };

async function setup(figPath: string): Promise<{
  readonly loaded: LoadedFigFile;
  readonly nodes: ReadonlyMap<string, FigNode>;
  readonly fontLoader: FontLoader;
}> {
  const bytes = new Uint8Array(await readFile(figPath));
  const loaded = await loadFigFile(bytes);
  const tree = buildNodeTree(loaded.nodeChanges);
  const nodes = new Map<string, FigNode>();
  for (const root of tree.roots) {
    indexNodes(root, nodes);
  }
  const fontLoader = createCachingFontLoader(createNodeFontLoader());
  return { loaded, nodes, fontLoader };
}

function indexNodes(node: FigNode, out: Map<string, FigNode>): void {
  out.set(guidToString(node.guid), node);
  for (const child of safeChildren(node)) {
    indexNodes(child, out);
  }
}

async function unresolvableFonts(node: FigNode, loader: FontLoader): Promise<string | undefined> {
  const queries = new Map<string, ReturnType<typeof figmaFontToQuery>>();
  collectFontQueries(node, queries);
  for (const query of queries.values()) {
    if (!query.family) {
      continue;
    }
    const loaded = await loader.loadFont(query);
    if (!loaded) {
      return query.family;
    }
  }
  return undefined;
}

function collectFontQueries(
  node: FigNode,
  out: Map<string, ReturnType<typeof figmaFontToQuery>>,
): void {
  if (node.type?.name === "TEXT" && node.fontName) {
    const q = figmaFontToQuery(node.fontName);
    const key = `${q.family}|${q.weight}|${q.style}`;
    if (!out.has(key)) {
      out.set(key, q);
    }
  }
  for (const child of safeChildren(node)) {
    collectFontQueries(child, out);
  }
}

async function handleRequest(
  req: WorkerRequest,
  ctx: { readonly loaded: LoadedFigFile; readonly nodes: ReadonlyMap<string, FigNode>; readonly fontLoader: FontLoader },
): Promise<WorkerResponse> {
  const node = ctx.nodes.get(req.nodeGuid);
  if (!node) {
    return { id: req.id, ok: false, error: `node ${req.nodeGuid} not found` };
  }
  if (!node.size) {
    return { id: req.id, ok: false, error: `node ${req.nodeGuid} has no size` };
  }
  if (!Number.isFinite(node.size.x) || !Number.isFinite(node.size.y) || node.size.x <= 0 || node.size.y <= 0) {
    return { id: req.id, ok: false, error: `node ${req.nodeGuid} has non-positive size ${node.size.x}×${node.size.y}` };
  }
  const missingFont = await unresolvableFonts(node, ctx.fontLoader);
  if (missingFont) {
    return { id: req.id, ok: false, error: `font "${missingFont}" not available on host` };
  }
  const result = await renderFigToSvg([node], {
    width: node.size.x,
    height: node.size.y,
    blobs: ctx.loaded.blobs ?? [],
    images: ctx.loaded.images ?? new Map(),
    normalizeRootTransform: true,
    symbolMap: ctx.nodes,
    fontLoader: ctx.fontLoader,
  });
  const svg = String(result.svg);
  const fitWidth = Math.max(1, Math.min(req.maxWidth, Math.round(node.size.x)));
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: fitWidth },
    background: "transparent",
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  await mkdir(dirname(req.outPath), { recursive: true });
  await writeFile(req.outPath, png);
  return { id: req.id, ok: true };
}

async function main(): Promise<void> {
  const figPath = process.argv[2];
  if (!figPath) {
    throw new Error("render-node-worker: missing fig path argv[2]");
  }
  const ctx = await setup(figPath);

  // Signal readiness so the parent knows it can start writing requests.
  process.stdout.write(`{"ready":true}\n`);

  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const req: WorkerRequest = JSON.parse(trimmed) as WorkerRequest;
    const response = await safeHandle(req, ctx);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

async function safeHandle(
  req: WorkerRequest,
  ctx: { readonly loaded: LoadedFigFile; readonly nodes: ReadonlyMap<string, FigNode>; readonly fontLoader: FontLoader },
): Promise<WorkerResponse> {
  try {
    return await handleRequest(req, ctx);
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
