#!/usr/bin/env bun
/**
 * @file Drive the visual round-trip loop for one or more cases.
 *
 *   bun run render-case <case-name> [<case-name>…]
 *   bun run render-case --all
 *
 * Case names map to `.fig` fixtures under
 * `packages/@higma-document-renderers/fig/fixtures/<case-name>/<case-name>.fig`.
 * That directory is the canonical SoT for round-trip fixtures (the
 * upstream renderer suite already validates them), so this runner
 * reads from there directly rather than maintaining a duplicate
 * `cases/<name>/source.fig` copy in this package.
 *
 * The script:
 *
 *   1. Renders the .fig via the WebGL harness → reference.png per frame
 *   2. Emits the SwiftUI source via fig-to-swiftui → expected.swift
 *   3. Runs the Swift toolchain on expected.swift → actual.png
 *   4. Pixel-diffs actual vs reference → diff.png + summary.md
 *
 * Output lands under `cases/<case-name>/<frame-slug>/` — that
 * directory is *output-only*; nothing is read from it. `summary.md`
 * sits at `cases/<case-name>/summary.md` and renders an inline
 * markdown image grid for a quick visual scan.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ComparisonOutcome } from "@higma-codecs/png-compare";
import { isSwiftAvailable } from "@higma-tools/fig-to-swiftui/render";
import {
  runRenderFigCase,
  type RenderFigCaseFrameResult,
} from "../spec/cases/render-fig-case";
import { listFixtureNames, resolveFixturePath } from "../spec/cases/fixture-source";

const CASES_ROOT = resolve(import.meta.dirname, "..", "cases");

async function pickCases(argv: readonly string[]): Promise<readonly string[]> {
  if (argv.length === 0) {
    process.stderr.write("usage: bun run render-case <case-name> [<case-name>…] | --all\n");
    process.exit(2);
  }
  if (argv.length === 1 && argv[0] === "--all") {
    const cases = listFixtureNames();
    if (cases.length === 0) {
      process.stderr.write(`render-case: no fixtures found under @higma-document-renderers/fig/fixtures\n`);
      process.exit(2);
    }
    return cases;
  }
  return argv;
}

function renderSummary(
  caseName: string,
  frames: readonly RenderFigCaseFrameResult[],
): string {
  const lines: string[] = [
    `# render-case: ${caseName}`,
    "",
    `Frames rendered: ${frames.length}`,
    "",
    "| frame | size | diff px | diff % |",
    "|-------|------|---------|--------|",
  ];
  for (const f of frames) {
    const cell = formatComparisonCell(f.comparison);
    lines.push(
      `| ${f.target.structName} | ${f.width}×${f.height} | ${cell.diffPx} | ${cell.diffPct} |`,
    );
  }
  lines.push("");
  for (const f of frames) {
    lines.push(`## ${f.target.structName}`);
    lines.push("");
    lines.push("| reference | actual | diff |");
    lines.push("|-----------|--------|------|");
    lines.push(
      `| ![reference](./${f.target.slug}/reference.png) | ![actual](./${f.target.slug}/actual.png) | ${diffImageCell(f)} |`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

function formatComparisonCell(c: ComparisonOutcome): { readonly diffPx: string; readonly diffPct: string } {
  if (c.kind === "compared") {
    return { diffPx: String(c.diffPixels), diffPct: `${c.diffPercent.toFixed(2)}%` };
  }
  return {
    diffPx: "—",
    diffPct: `dim mismatch (${c.actual.width}×${c.actual.height} vs ${c.expected.width}×${c.expected.height})`,
  };
}

function diffImageCell(f: RenderFigCaseFrameResult): string {
  if (f.comparison.kind === "compared") {
    return `![diff](./${f.target.slug}/diff.png)`;
  }
  return "(dimension mismatch)";
}

async function writeFrame(
  outDir: string,
  frame: RenderFigCaseFrameResult,
): Promise<{ readonly diffPx: number | null; readonly diffPct: number | null }> {
  const dir = resolve(outDir, frame.target.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "expected.swift"), frame.file.contents);
  await writeFile(resolve(dir, "reference.png"), frame.referencePng);
  await writeFile(resolve(dir, "actual.png"), frame.actualPng);
  if (frame.comparison.kind === "compared") {
    await writeFile(resolve(dir, "diff.png"), frame.comparison.diffPng);
    return { diffPx: frame.comparison.diffPixels, diffPct: frame.comparison.diffPercent };
  }
  return { diffPx: null, diffPct: null };
}

async function runOneCase(caseName: string): Promise<{ readonly maxDiffPct: number; readonly frameCount: number }> {
  const figPath = resolveFixturePath(caseName);
  process.stdout.write(`\n=== ${caseName} ===\n`);
  const result = await runRenderFigCase({
    source: figPath,
    threshold: 0.1,
  });
  const outDir = resolve(CASES_ROOT, caseName);
  const accum = { maxDiffPct: 0 };
  for (const frame of result.frames) {
    const { diffPx, diffPct } = await writeFrame(outDir, frame);
    const pctStr = diffPct === null ? "—" : `${diffPct.toFixed(2)}%`;
    const pxStr = diffPx === null ? "(dim mismatch)" : `${diffPx}px`;
    process.stdout.write(`  ${frame.target.structName} (${frame.width}×${frame.height}): ${pxStr} ${pctStr}\n`);
    if (diffPct !== null && diffPct > accum.maxDiffPct) {
      accum.maxDiffPct = diffPct;
    }
  }
  await writeFile(resolve(outDir, "summary.md"), renderSummary(caseName, result.frames));
  process.stdout.write(`  → ${resolve(outDir, "summary.md")}\n`);
  return { maxDiffPct: accum.maxDiffPct, frameCount: result.frames.length };
}

type RunRow =
  | { readonly kind: "ok"; readonly name: string; readonly maxDiffPct: number; readonly frameCount: number }
  | { readonly kind: "skipped"; readonly name: string; readonly reason: string };

async function main(): Promise<void> {
  if (!(await isSwiftAvailable())) {
    process.stderr.write(
      "render-case: Apple `swift` CLI not on PATH — install Xcode command-line tools (`xcode-select --install`) on macOS, or run on a host with Swift available.\n",
    );
    process.exit(2);
  }
  const argv = process.argv.slice(2);
  const caseNames = await pickCases(argv);
  const isAllMode = argv.length === 1 && argv[0] === "--all";

  // In `--all` mode, surface unsupported-fixture failures (e.g.
  // BOOLEAN_OPERATION nodes that the v0 emitter doesn't yet handle)
  // as skipped rows rather than aborting the whole run — the goal
  // there is "render every fixture I can," not "fail at the first
  // gap." When the user names cases explicitly we still throw so
  // the gap is visible and CI fails appropriately.
  const summary: RunRow[] = [];
  for (const name of caseNames) {
    try {
      const { maxDiffPct, frameCount } = await runOneCase(name);
      summary.push({ kind: "ok", name, maxDiffPct, frameCount });
    } catch (err) {
      if (!isAllMode) {
        throw err;
      }
      const reason = err instanceof Error ? err.message : String(err);
      summary.push({ kind: "skipped", name, reason });
      process.stdout.write(`  (skipped: ${reason.split("\n", 1)[0]})\n`);
    }
  }

  process.stdout.write("\n=== summary ===\n");
  for (const row of summary) {
    if (row.kind === "ok") {
      process.stdout.write(
        `  ${row.name}: ${row.frameCount} frames, max diff ${row.maxDiffPct.toFixed(2)}%\n`,
      );
    } else {
      process.stdout.write(`  ${row.name}: SKIPPED — ${row.reason.split("\n", 1)[0]}\n`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
