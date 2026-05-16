/**
 * @file Visual-fidelity verifier for the web → fig → web round-trip.
 *
 * Drives the full user-visible pipeline:
 *   1. Take the `.fig` web-to-fig produced.
 *   2. Run fig-to-web's CLI exactly as a downstream consumer would
 *      (`bun run packages/@higma-tools/fig-to-web/src/cli/bin.ts`).
 *   3. Serve the resulting bundle over local HTTP.
 *   4. Drive Chromium against the per-frame standalone route, one
 *      viewport per breakpoint.
 *   5. Pixel-diff the screenshot against the original Playwright
 *      capture of the source URL.
 *
 * Why this lives in `@higma-tools/web-fig-roundtrip`: it imports
 * BOTH `@higma-tools/web-to-fig` (for the captured breakpoint type)
 * AND `@higma-tools/fig-to-web` (for the runCli entrypoint). Same-
 * scope sibling tools cannot import each other under the boundary
 * rules, so the verifier sits one neutral package over and pulls
 * both into the same process.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@higma-tools/fig-to-web";
import type { CapturedBreakpoint } from "@higma-tools/web-to-fig/web-source";
import { comparePng, type ComparisonOutcome } from "@higma-codecs/png-compare";
import { startStaticPreview, type StaticPreview } from "./preview-server";
import { renderPreview, type RenderedPreviewFrame } from "./render-preview";

export type VerifiedBreakpoint = {
  readonly breakpoint: string;
  readonly frame: RenderedPreviewFrame;
  readonly actualScreenshot: Uint8Array;
  readonly comparison: ComparisonOutcome;
};

export type VerificationReport = {
  readonly source: string;
  readonly results: readonly VerifiedBreakpoint[];
};

export type VerifyOptions = {
  /** pixelmatch threshold in [0,1]. Default 0.1. */
  readonly threshold?: number;
  /** Device pixel ratio applied while the preview is screenshot. */
  readonly devicePixelRatio?: number;
};

function assertEndToEndVerificationGateHasInputs(figBytes: Uint8Array, captures: readonly CapturedBreakpoint[]): void {
  if (figBytes.byteLength === 0) {
    throw new Error("End-to-end verification gate requires generated .fig bytes.");
  }
  if (captures.length === 0) {
    throw new Error("End-to-end verification gate requires captured source-of-truth breakpoints.");
  }
}

/**
 * Run the full web-to-fig → fig-to-web → browser-render → pixel-diff
 * pipeline and report a per-breakpoint comparison.
 *
 * This is the end-to-end verification gate for generation, validation, and
 * test execution: the workflow only passes when generated fixtures and
 * renderer output agree with the captured source of truth.
 */
export async function verifyFidelity(
  source: string,
  figBytes: Uint8Array,
  captures: readonly CapturedBreakpoint[],
  options: VerifyOptions = {},
): Promise<VerificationReport> {
  assertEndToEndVerificationGateHasInputs(figBytes, captures);
  const workDir = await mkdtemp(join(tmpdir(), "web-fig-roundtrip-verify-"));
  const figPath = join(workDir, "input.fig");
  const outDir = join(workDir, "out");
  let preview: StaticPreview | undefined;
  try {
    await writeFile(figPath, figBytes);
    await runCli(
      {
        input: figPath,
        out: outDir,
        page: "Web Capture",
        mode: "all",
        serve: false,
        port: 0,
        bundle: true,
        debugAttrs: false,
        // The roundtrip verifier asserts visual fidelity, not export
        // shape — stay on the historical `function-default` form so
        // the generated preview shell / standalone pages keep their
        // default-import wiring intact.
        exportStyle: "function-default",
        // Inline styles are what the visual-fidelity harness has been
        // measuring against; switching to css-modules here would force
        // the bundler to inline a stylesheet via JS, which is a
        // separate verification surface.
        cssMode: "inline",
        // `cssImport` only affects external-css mode, but the field
        // is part of the CliOptions shape.
        cssImport: "direct",
        // Visual fidelity targets the historical single-component
        // emit; the exploded form is for downstream consumers who
        // want per-variant tree-shake-friendly imports.
        variantStrategy: "discriminated",
        // Asset externalisation also routes the rendered icon
        // through an `<img>` instead of inline SVG, which is a
        // different surface than the visual-fidelity harness was
        // calibrated against. Keep icons inline here.
        assetStrategy: "inline",
        assetComplexityThreshold: 200,
      },
      {
        info: () => undefined,
        error: (msg) => process.stderr.write(`${msg}\n`),
      },
    );
    preview = await startStaticPreview(outDir);
    const rendered = await renderPreview({
      baseUrl: preview.url,
      captures,
      devicePixelRatio: options.devicePixelRatio ?? 1,
    });
    const results: VerifiedBreakpoint[] = [];
    for (const cap of captures) {
      const frame = rendered.find((f) => f.breakpoint === cap.breakpoint.name);
      if (!frame) {
        throw new Error(`verifyFidelity: fig-to-web preview missing breakpoint "${cap.breakpoint.name}"`);
      }
      const screenshot = cap.result.screenshotBytes;
      if (!screenshot) {
        throw new Error(`verifyFidelity: breakpoint "${cap.breakpoint.name}" has no screenshot — capture with captureScreenshot=true`);
      }
      const comparison = comparePng(frame.png, screenshot, { threshold: options.threshold });
      results.push({
        breakpoint: cap.breakpoint.name,
        frame,
        actualScreenshot: screenshot,
        comparison,
      });
    }
    return { source, results };
  } finally {
    if (preview !== undefined) {
      await preview.stop();
    }
    await rm(workDir, { recursive: true, force: true });
  }
}
