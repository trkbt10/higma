/**
 * @file Visual-fidelity verifier.
 *
 * Inputs:
 *   - the `.fig` bytes produced by web-to-fig
 *   - the original Playwright PNG screenshots, keyed by breakpoint
 *
 * Pipeline per breakpoint:
 *   1. Render the breakpoint's frame in the `.fig` to SVG via the
 *      authoritative `@higma-document-renderers/fig` SVG pipeline.
 *   2. Rasterise the SVG to PNG via resvg.
 *   3. Pixel-diff the rasterised PNG against the original screenshot.
 *
 * The output is a structured report — diff count + percentage per
 * breakpoint, plus the raw SVG / actual PNG / diff PNG so a caller can
 * write everything to disk for visual inspection.
 *
 * Frame discovery: the verifier matches frames by name. The writer
 * names each top-level frame `<breakpoint> / <w>×<h>`, so the
 * leading `<breakpoint>` token is the join key. If a breakpoint has
 * no matching frame the verifier throws; it never compares against
 * the wrong frame.
 */
import { renderFigBytes, type RenderedFrame } from "./render-fig";
import { comparePng, type ComparisonOutcome } from "./compare";
import type { CapturedBreakpoint } from "../web-source";

export type VerifiedBreakpoint = {
  readonly breakpoint: string;
  readonly frame: RenderedFrame;
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
  /** Device pixel ratio applied while rasterising the SVG. */
  readonly devicePixelRatio?: number;
};

/** Render the emitted .fig and pixel-diff each frame against its source breakpoint screenshot. */
export async function verifyFidelity(
  source: string,
  figBytes: Uint8Array,
  captures: readonly CapturedBreakpoint[],
  options: VerifyOptions = {},
): Promise<VerificationReport> {
  const frames = await renderFigBytes(figBytes, { devicePixelRatio: options.devicePixelRatio });
  const byBreakpoint = new Map<string, RenderedFrame>();
  for (const frame of frames) {
    const key = frame.name.split("/")[0]?.trim() ?? frame.name;
    byBreakpoint.set(key, frame);
  }
  const results: VerifiedBreakpoint[] = [];
  for (const cap of captures) {
    const frame = byBreakpoint.get(cap.breakpoint.name);
    if (!frame) {
      throw new Error(`verifyFidelity: no rendered frame matched breakpoint "${cap.breakpoint.name}"`);
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
}
