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
import { createFigSymbolContext, type FigSymbolContext } from "@higma-document-io/fig/context";
import type { FigNode } from "@higma-document-models/fig/types";
import { renderFigToSvg } from "@higma-document-renderers/fig/svg";
import {
  createCachingFontLoader,
  collectFontQueries,
  type FontLoader,
} from "@higma-document-models/fig/font";
import { createNodeFontLoader } from "@higma-document-renderers/fig/font-drivers/node";
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
  readonly ctx: FigSymbolContext;
  readonly fontLoader: FontLoader;
}> {
  const bytes = new Uint8Array(await readFile(figPath));
  const ctx = await createFigSymbolContext(bytes);
  const fontLoader = createCachingFontLoader(createNodeFontLoader());
  return { ctx, fontLoader };
}

/**
 * Walk the subtree and ask the font loader about every distinct
 * `(family, weight, style)` referenced by a TEXT node. Returns the
 * first family that the loader cannot satisfy, or `undefined` when
 * every TEXT-required face resolves. Tree walking + override
 * traversal is delegated to the canonical `collectFontQueries`
 * SoT — re-implementing it here would drift on edge cases.
 */
async function unresolvableFonts(node: FigNode, loader: FontLoader): Promise<string | undefined> {
  const { queries } = collectFontQueries({ roots: [node] });
  for (const query of queries) {
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

type WorkerCtx = { readonly ctx: FigSymbolContext; readonly fontLoader: FontLoader };

async function handleRequest(req: WorkerRequest, w: WorkerCtx): Promise<WorkerResponse> {
  const node = w.ctx.nodesByGuid.get(req.nodeGuid);
  if (!node) {
    return { id: req.id, ok: false, error: `node ${req.nodeGuid} not found` };
  }
  if (!node.size) {
    return { id: req.id, ok: false, error: `node ${req.nodeGuid} has no size` };
  }
  if (!Number.isFinite(node.size.x) || !Number.isFinite(node.size.y) || node.size.x <= 0 || node.size.y <= 0) {
    return { id: req.id, ok: false, error: `node ${req.nodeGuid} has non-positive size ${node.size.x}×${node.size.y}` };
  }
  const missingFont = await unresolvableFonts(node, w.fontLoader);
  if (missingFont) {
    return { id: req.id, ok: false, error: `font "${missingFont}" not available on host` };
  }
  const result = await renderFigToSvg([node], {
    width: node.size.x,
    height: node.size.y,
    blobs: w.ctx.blobs,
    images: w.ctx.images,
    normalizeRootTransform: true,
    symbolMap: w.ctx.symbolMap,
    styleRegistry: w.ctx.styleRegistry,
    fontLoader: w.fontLoader,
  });
  const svg = String(result.svg);
  // Always raster at the requested width regardless of native size.
  // Workbench cells need visible images; downscaling-only behaviour
  // produced 19×19 PNGs that vanished inside the contact sheet.
  const fitWidth = Math.max(1, req.maxWidth);
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
  const w = await setup(figPath);

  // Signal readiness so the parent knows it can start writing requests.
  process.stdout.write(`{"ready":true}\n`);

  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const req: WorkerRequest = JSON.parse(trimmed) as WorkerRequest;
    const response = await safeHandle(req, w);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

async function safeHandle(req: WorkerRequest, w: WorkerCtx): Promise<WorkerResponse> {
  try {
    return await handleRequest(req, w);
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
