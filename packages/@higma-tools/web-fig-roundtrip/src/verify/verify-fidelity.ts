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
import { comparePng, type ComparisonOutcome } from "./compare";
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

/**
 * Run the full web-to-fig → fig-to-web → browser-render → pixel-diff
 * pipeline and report a per-breakpoint comparison.
 */
export async function verifyFidelity(
  source: string,
  figBytes: Uint8Array,
  captures: readonly CapturedBreakpoint[],
  options: VerifyOptions = {},
): Promise<VerificationReport> {
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
