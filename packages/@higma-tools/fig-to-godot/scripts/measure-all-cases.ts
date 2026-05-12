#!/usr/bin/env bun
/**
 * @file Sweep every `.fig` fixture under
 * `@higma-document-renderers/fig/fixtures/<name>/<name>.fig`, emit
 * the Godot scene per top-level frame, render them all in **one**
 * Godot batch process, and pixel-diff each against the swiftui peer's
 * reference PNG. Per-frame status:
 *
 *   - `OK 0.42% (140x200)` — render succeeded, diff under 1%.
 *   - `OVER 12.34% (140x200)` — render succeeded, diff over 1%.
 *   - `EMIT-THROW <message>` — fig-to-godot threw on emit.
 *   - `NO-REF` — no per-frame `reference.png` to compare against.
 *
 * Architecture: previous version forked one Godot process per frame,
 * which OOMed at ~150 frames under any concurrency. This version runs
 * a single Godot process per case (or one for all cases — see
 * `BATCH_BY` constant), keeping resident memory flat.
 *
 * Run via: `bun run packages/@higma-tools/fig-to-godot/scripts/measure-all-cases.ts`
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePng } from "@higma-codecs/png-compare";
import { createFigSymbolContext } from "@higma-document-io/fig/context";
import {
  buildFrameTarget,
  emitFrameFile,
  listFrameTargets,
  type EmitContext,
} from "@higma-tools/fig-to-godot/emit";
import { renderGodotBatch, type GodotBatchEntry } from "@higma-tools/fig-to-godot/render";
import type { FigNode } from "@higma-document-models/fig/types";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const FIXTURES_ROOT = resolve(REPO_ROOT, "packages/@higma-document-renderers/fig/fixtures");
const SWIFTUI_CASES_ROOT = resolve(REPO_ROOT, "packages/@higma-tools/fig-to-swiftui/cases");

type FrameJob = {
  readonly caseName: string;
  readonly figmaName: string;
  readonly width: number;
  readonly height: number;
  readonly emitError?: string;
  readonly sceneText?: string;
  readonly companions?: ReadonlyMap<string, Uint8Array>;
};

type FrameReport = {
  readonly caseName: string;
  readonly figmaName: string;
  readonly width: number;
  readonly height: number;
  readonly status: string;
  readonly detail: string;
};

async function main(): Promise<void> {
  const caseNames = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  // Phase 1: emit all scenes (CPU only, no Godot).
  const allJobs: FrameJob[] = [];
  const caseCanvases = new Map<string, string | undefined>();
  for (const caseName of caseNames) {
    const figPath = pickFigPath(caseName);
    if (!figPath) {
      caseCanvases.set(caseName, undefined);
      continue;
    }
    const { canvasName, jobs } = await emitCase(caseName, figPath);
    caseCanvases.set(caseName, canvasName);
    allJobs.push(...jobs);
  }

  // Phase 2: batch-render the emitted scenes in ONE Godot process.
  const renderable = allJobs.filter((j) => j.sceneText !== undefined);
  const entries: GodotBatchEntry[] = renderable.map((j) => ({
    sceneText: j.sceneText!,
    companions: j.companions,
    width: j.width,
    height: j.height,
  }));
  process.stderr.write(`[measure] rendering ${entries.length} scenes in one Godot batch...\n`);
  const batch = await renderGodotBatch(entries);

  // Phase 3: diff each rendered PNG against its reference.
  const renderedByJob = new Map<FrameJob, Uint8Array>();
  for (let i = 0; i < renderable.length; i += 1) {
    renderedByJob.set(renderable[i]!, batch.pngs[i]!);
  }
  const reports: FrameReport[] = [];
  for (const job of allJobs) {
    if (job.emitError) {
      reports.push({
        caseName: job.caseName,
        figmaName: job.figmaName,
        width: job.width,
        height: job.height,
        status: "EMIT-THROW",
        detail: job.emitError.slice(0, 120),
      });
      continue;
    }
    const png = renderedByJob.get(job);
    if (!png) {
      reports.push({
        caseName: job.caseName,
        figmaName: job.figmaName,
        width: job.width,
        height: job.height,
        status: "RENDER-MISS",
        detail: "no PNG returned for this entry",
      });
      continue;
    }
    const refPath = resolve(SWIFTUI_CASES_ROOT, job.caseName, job.figmaName, "reference.png");
    if (!existsSync(refPath)) {
      reports.push({
        caseName: job.caseName,
        figmaName: job.figmaName,
        width: job.width,
        height: job.height,
        status: "NO-REF",
        detail: "",
      });
      continue;
    }
    const referencePng = new Uint8Array(await readFile(refPath));
    const outcome = comparePng(png, referencePng, { threshold: 0.0 });
    if (outcome.kind === "mismatched-dimensions") {
      reports.push({
        caseName: job.caseName,
        figmaName: job.figmaName,
        width: job.width,
        height: job.height,
        status: "DIM-MISMATCH",
        detail: `actual ${outcome.actual.width}x${outcome.actual.height} vs expected ${outcome.expected.width}x${outcome.expected.height}`,
      });
      continue;
    }
    reports.push({
      caseName: job.caseName,
      figmaName: job.figmaName,
      width: job.width,
      height: job.height,
      status: outcome.diffPercent <= 1 ? "OK" : "OVER",
      detail: `${outcome.diffPercent.toFixed(2)}%`,
    });
  }

  printReport(caseNames, caseCanvases, reports);
}

function pickFigPath(caseName: string): string | undefined {
  const dir = resolve(FIXTURES_ROOT, caseName);
  if (!existsSync(dir)) {
    return undefined;
  }
  const expected = resolve(dir, `${caseName}.fig`);
  if (existsSync(expected)) {
    return expected;
  }
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith(".fig")) {
      return resolve(dir, entry);
    }
  }
  return undefined;
}

async function emitCase(
  caseName: string,
  figPath: string,
): Promise<{ readonly canvasName: string | undefined; readonly jobs: readonly FrameJob[] }> {
  const bytes = new Uint8Array(await readFile(figPath));
  const ctx = await createFigSymbolContext(bytes);
  const doc = ctx.tree.roots.find((r) => r.type.name === "DOCUMENT");
  const canvas = doc?.children?.find(
    (c): c is FigNode => c?.type?.name === "CANVAS" && c.internalOnly !== true,
  );
  if (!canvas) {
    return { canvasName: undefined, jobs: [] };
  }
  const frames = listFrameTargets(canvas);
  const sceneNamesUsed = new Set<string>();
  const slugsUsed = new Set<string>();
  // Plumbing the symbolMap is what lets INSTANCE frames (constraints,
  // symbol-resolution, decoration-combo's instance-* cases) resolve
  // to their authoring SYMBOL. Without it those frames emit empty
  // Controls.
  const emitCtx: EmitContext = {
    symbolMap: ctx.symbolMap,
    blobs: ctx.blobs,
    images: ctx.images,
  };
  const jobs: FrameJob[] = [];
  for (const node of frames) {
    const figmaName = node.name ?? "";
    const size = node.size ?? { x: 0, y: 0 };
    const width = Math.max(1, Math.round(size.x));
    const height = Math.max(1, Math.round(size.y));
    const target = buildFrameTarget(node, { outputDir: "Pages", sceneNamesUsed, slugsUsed });
    try {
      const file = emitFrameFile(target, emitCtx);
      jobs.push({
        caseName,
        figmaName,
        width,
        height,
        sceneText: file.contents,
        companions: file.assets,
      });
    } catch (err) {
      jobs.push({
        caseName,
        figmaName,
        width,
        height,
        emitError: String((err as Error).message ?? err),
      });
    }
  }
  return { canvasName: canvas.name, jobs };
}

function formatCaseHeader(caseName: string, canvas: string | undefined, frameCount: number): string {
  if (canvas === undefined) return `# ${caseName} — (no fig file)`;
  return `# ${caseName} (canvas="${canvas}", ${frameCount} frames)`;
}

function printReport(
  caseNames: readonly string[],
  caseCanvases: ReadonlyMap<string, string | undefined>,
  reports: readonly FrameReport[],
): void {
  const totals: Record<string, number> = {};
  const reportsByCase = new Map<string, FrameReport[]>();
  for (const r of reports) {
    const list = reportsByCase.get(r.caseName) ?? [];
    list.push(r);
    reportsByCase.set(r.caseName, list);
  }
  for (const caseName of caseNames) {
    const canvas = caseCanvases.get(caseName);
    const frames = reportsByCase.get(caseName) ?? [];
    const headerLine = formatCaseHeader(caseName, canvas, frames.length);
    process.stdout.write(`${headerLine}\n`);
    for (const f of frames) {
      totals[f.status] = (totals[f.status] ?? 0) + 1;
      process.stdout.write(
        `  ${f.status.padEnd(13)} ${f.figmaName.padEnd(30)} ${f.width}x${f.height} ${f.detail}\n`,
      );
    }
  }
  process.stdout.write("\n# totals\n");
  for (const [k, v] of Object.entries(totals)) {
    process.stdout.write(`  ${k.padEnd(13)} ${v}\n`);
  }
}

await main();
