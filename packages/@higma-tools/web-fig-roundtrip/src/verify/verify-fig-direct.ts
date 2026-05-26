/**
 * @file `.fig` direct-render fidelity verifier (WebGL renderer).
 *
 * Companion to `verifyFidelity` (which exercises fig-to-web's React
 * renderer) — this verifier renders the `.fig` directly with the
 * production `WebGLFigmaRenderer` via the same vite + puppeteer
 * harness the renderer's parity tests use. The diff against the
 * captured screenshot then isolates `web-to-fig` correctness, with
 * no fig-to-web layer in between.
 */
import type { CapturedBreakpoint } from "@higma-tools/web-to-fig/web-source";
import { comparePng, type ComparisonOutcome } from "@higma-codecs/png-compare";
import {
  renderFigViewports,
  startWebglHarness,
  type FigDirectRenderResult,
} from "./render-fig-webgl";

export type DirectVerifiedBreakpoint = {
  readonly breakpoint: string;
  readonly frame: FigDirectRenderResult;
  readonly actualScreenshot: Uint8Array;
  readonly comparison: ComparisonOutcome;
};

export type DirectVerificationReport = {
  readonly source: string;
  readonly results: readonly DirectVerifiedBreakpoint[];
};

export type DirectVerifyOptions = {
  /** pixelmatch threshold in [0,1]. Default 0.1. */
  readonly threshold?: number;
};

/** Render a `.fig` directly through the WebGL renderer and compare it with captured screenshots. */
export async function verifyFigDirect(
  source: string,
  figBytes: Uint8Array,
  captures: readonly CapturedBreakpoint[],
  options: DirectVerifyOptions = {},
): Promise<DirectVerificationReport> {
  const breakpoints = captures.map((c) => c.breakpoint.name);
  const harness = await startWebglHarness();
  try {
    const rendered = await renderFigViewports(harness, figBytes, { breakpoints });
    const results: DirectVerifiedBreakpoint[] = [];
    for (const cap of captures) {
      const frame = rendered.find((r) => r.breakpoint === cap.breakpoint.name);
      if (!frame) {
        throw new Error(`verifyFigDirect: no rendered frame for breakpoint "${cap.breakpoint.name}"`);
      }
      const screenshot = cap.result.screenshotBytes;
      if (!screenshot) {
        throw new Error(`verifyFigDirect: breakpoint "${cap.breakpoint.name}" has no screenshot — capture with captureScreenshot=true`);
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
    await harness.stop();
  }
}
