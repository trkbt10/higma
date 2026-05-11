#!/usr/bin/env bun
/**
 * @file Visual-diff measurement loop for `cases-fullpage`.
 *
 * Runs each sub-directory of
 * `packages/@higma-tools/web-to-fig/spec/cases-fullpage/<case>/`
 * through:
 *
 *   1. capture (Playwright on `fixture.html`, with screenshot)
 *   2. normalize → emit `.fig`
 *   3. WebGL render of the `.fig`
 *   4. pixel diff between captured screenshot + rendered PNG
 *   5. write `actual.png`, `rendered.png`, `diff.png`, `report.json`
 *      next to the case so a developer can compare visually.
 *
 * Aggregates a top-level `report.json` with per-case diff %, which is
 * the feedback signal we use to rank what's still wrong with the
 * web-to-fig pipeline. Cases are skipped (not failed) when the
 * fixture file is missing — keeps the loop usable when only some
 * cases have local fixtures.
 *
 * Usage:
 *   bun packages/@higma-tools/web-fig-roundtrip/src/cli/measure-fullpage-bin.ts \
 *     [--case <name>] [--threshold 0.1]
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureViewport } from "@higma-tools/web-to-fig/web-source";
import { normalizeViewport } from "@higma-tools/web-to-fig/normalize";
import type { FontResolver } from "@higma-tools/web-to-fig/normalize";
import { createHostFontResolver } from "@higma-tools/web-to-fig";
import { emitFig } from "@higma-tools/web-to-fig/emit";
import { comparePng } from "@higma-codecs/png-compare";
import { renderFigFramesByName, startWebglHarness } from "../verify/render-fig-webgl";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CASES_DIR = resolve(
  __dirname,
  "../../../web-to-fig/spec/cases-fullpage",
);

type CaseReport =
  | {
      readonly case: string;
      readonly status: "skipped";
      readonly reason: string;
    }
  | {
      readonly case: string;
      readonly status: "ok";
      readonly diffPercent: number;
      readonly diffPixels: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly case: string;
      readonly status: "mismatched-dimensions";
      readonly actual: { readonly width: number; readonly height: number };
      readonly expected: { readonly width: number; readonly height: number };
    }
  | {
      readonly case: string;
      readonly status: "error";
      readonly message: string;
    };

type Args = {
  readonly only?: string;
  readonly threshold: number;
};

function parseArgs(argv: readonly string[]): Args {
  type Acc = {
    readonly only?: string;
    readonly threshold: number;
    readonly skip: number;
  };
  const initial: Acc = {
    only: undefined,
    threshold: 0.1,
    skip: 0,
  };
  return argv.reduce<Acc>(
    (acc, arg, idx) => {
      if (acc.skip > 0) {
        return { ...acc, skip: acc.skip - 1 };
      }
      if (arg === "--case") {
        const value = argv[idx + 1];
        if (value === undefined) {
          throw new Error("--case requires a value");
        }
        return { ...acc, only: value, skip: 1 };
      }
      if (arg === "--threshold") {
        const value = argv[idx + 1];
        if (value === undefined) {
          throw new Error("--threshold requires a value");
        }
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
          throw new Error(`--threshold must be in [0,1], got "${value}"`);
        }
        return { ...acc, threshold: parsed, skip: 1 };
      }
      return acc;
    },
    initial,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cases = readdirSync(CASES_DIR)
    .filter((entry) => statSync(resolve(CASES_DIR, entry)).isDirectory())
    .filter((name) => (args.only === undefined ? true : name === args.only));
  if (cases.length === 0) {
    process.stderr.write(`No cases found under ${CASES_DIR}\n`);
    process.exit(1);
  }
  process.stdout.write(`Measuring ${cases.length} case(s) under ${CASES_DIR}\n`);
  // Build the host-appropriate FontResolver once at the boundary so
  // every case shares the same installed-font catalogue and the
  // measurement loop doesn't shell out per case. The platform
  // dispatch lives in `createHostFontResolver` — a single SoT.
  const fontResolver = createHostFontResolver();
  const harness = await startWebglHarness();
  try {
    const reports: CaseReport[] = [];
    for (const caseName of cases) {
      // Wrap each case in a try/catch so a single failure doesn't
      // tear down the whole measurement run. This is a measurement
      // tool, not the production pipeline — the per-case error is
      // recorded into the report and surfaced at the end so a
      // developer can prioritise fixes.
      try {
        // eslint-disable-next-line no-await-in-loop -- harness is single-page, must serialise
        const report = await measureOne(harness, caseName, args.threshold, fontResolver);
        reports.push(report);
        printOne(report);
      } catch (err: unknown) {
        const report: CaseReport = {
          case: caseName,
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        };
        reports.push(report);
        printOne(report);
      }
    }
    const summary = {
      threshold: args.threshold,
      cases: reports,
    };
    const summaryPath = resolve(CASES_DIR, "report.json");
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`\nWrote summary to ${summaryPath}\n`);
  } finally {
    await harness.stop();
  }
}

function printOne(report: CaseReport): void {
  switch (report.status) {
    case "ok": {
      const tag = report.diffPercent < 1 ? "PASS" : report.diffPercent < 5 ? "WARN" : "FAIL";
      process.stdout.write(
        `[${tag}] ${report.case.padEnd(30)} diff=${report.diffPercent.toFixed(2)}% (${report.diffPixels}px @ ${report.width}x${report.height})\n`,
      );
      return;
    }
    case "skipped":
      process.stdout.write(`[SKIP] ${report.case.padEnd(30)} ${report.reason}\n`);
      return;
    case "mismatched-dimensions":
      process.stdout.write(
        `[DIM ] ${report.case.padEnd(30)} actual=${report.actual.width}x${report.actual.height} expected=${report.expected.width}x${report.expected.height}\n`,
      );
      return;
    case "error":
      process.stdout.write(`[ERR ] ${report.case.padEnd(30)} ${report.message}\n`);
      return;
  }
}

async function measureOne(
  harness: Awaited<ReturnType<typeof startWebglHarness>>,
  caseName: string,
  threshold: number,
  fontResolver: FontResolver,
): Promise<CaseReport> {
  const dir = resolve(CASES_DIR, caseName);
  const fixturePath = resolve(dir, "fixture.html");
  if (!existsSync(fixturePath)) {
    return {
      case: caseName,
      status: "skipped",
      reason: `no fixture.html (run ${caseName}/extract.sh)`,
    };
  }
  // The cases all run at the desktop breakpoint by convention. The
  // browser viewport is 1280×800 (what the page lays itself out
  // into), but the captured `.fig` covers the *full document*
  // height — the IR's root box is anchored to the document, not
  // the viewport. The screenshot we compare against is also a
  // full-page screenshot so both sides cover the same surface.
  const breakpoint = "desktop";
  const viewport = { width: 1280, height: 800 };
  const fixtureUrl = `file://${fixturePath}`;
  return measureCase(harness, { caseName, dir, fixtureUrl, viewport, breakpoint, threshold, fontResolver });
}

async function measureCase(
  harness: Awaited<ReturnType<typeof startWebglHarness>>,
  options: {
    readonly caseName: string;
    readonly dir: string;
    readonly fixtureUrl: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly breakpoint: string;
    readonly threshold: number;
    readonly fontResolver: FontResolver;
  },
): Promise<CaseReport> {
  // capture + screenshot
  const captureResult = await safeCapture(options.fixtureUrl, options.viewport);
  if (captureResult.kind === "error") {
    return { case: options.caseName, status: "error", message: captureResult.message };
  }
  const screenshot = captureResult.captured.screenshotBytes;
  if (screenshot === undefined) {
    return { case: options.caseName, status: "error", message: "captureScreenshot did not return bytes" };
  }
  // normalize + emit
  const ir = normalizeViewport(captureResult.captured.snapshot, {
    breakpoint: options.breakpoint,
    fontResolver: options.fontResolver,
  });
  const fig = await emitFig(ir);
  // render via WebGL harness. `emitFig` (single-viewport) does not
  // emit a `<breakpoint>/<size>`-named wrapper FRAME, so we render
  // every top-level FRAME and pick the one whose size matches the
  // captured viewport. `renderFigFramesByName` is the entry that
  // doesn't impose the slug filter.
  const rendered = await renderFigFramesByName(harness, fig.bytes);
  if (rendered.length === 0) {
    return {
      case: options.caseName,
      status: "error",
      message: "WebGL harness produced no frames for the .fig",
    };
  }
  // Pick the frame whose width matches the captured viewport width.
  // For single-viewport emit there should only be one anyway, but
  // multi-viewport `.fig`s carry one FRAME per breakpoint so we
  // disambiguate explicitly.
  const frame = rendered.find((r) => Math.abs(r.width - options.viewport.width) < 2) ?? rendered[0]!;
  // diff
  const comparison = comparePng(frame.png, screenshot, { threshold: options.threshold });
  // write artefacts (always, even on dimension mismatch — easier to inspect)
  await mkdir(options.dir, { recursive: true });
  await writeFile(resolve(options.dir, "actual.png"), screenshot);
  await writeFile(resolve(options.dir, "rendered.png"), frame.png);
  await writeFile(resolve(options.dir, "snapshot.fig"), fig.bytes);
  if (comparison.kind === "compared") {
    await writeFile(resolve(options.dir, "diff.png"), comparison.diffPng);
    return {
      case: options.caseName,
      status: "ok",
      diffPercent: comparison.diffPercent,
      diffPixels: comparison.diffPixels,
      width: comparison.width,
      height: comparison.height,
    };
  }
  return {
    case: options.caseName,
    status: "mismatched-dimensions",
    actual: comparison.actual,
    expected: comparison.expected,
  };
}

async function safeCapture(
  url: string,
  viewport: { readonly width: number; readonly height: number },
): Promise<
  | { readonly kind: "ok"; readonly captured: Awaited<ReturnType<typeof captureViewport>> }
  | { readonly kind: "error"; readonly message: string }
> {
  try {
    const captured = await captureViewport({
      url,
      viewport,
      waitUntil: "load",
      timeoutMs: 60_000,
      captureScreenshot: true,
      // cases-fullpage compares the rendered `.fig` (which covers
      // the full document height per the normaliser's root-box
      // expansion) against the captured screenshot. The screenshot
      // therefore has to cover the same surface, not just the
      // initial viewport — otherwise everything below the fold
      // diffs as 100% mismatch against a blank canvas band.
      fullPageScreenshot: true,
    });
    return { kind: "ok", captured };
  } catch (err: unknown) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

await main();
