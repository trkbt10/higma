/**
 * @file Capture the same URL at multiple viewport breakpoints.
 *
 * Each breakpoint is a fresh Playwright context so the page genuinely
 * re-renders with the requested viewport size — `getComputedStyle`
 * values then reflect the media-query state for that breakpoint, not
 * the desktop layout reflowed.
 */
import { captureViewport, type CaptureOptions, type CaptureResult } from "./capture";

export type Breakpoint = {
  /** Stable label used as the breakpoint id in IR/Fig output. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio?: number;
};

export type MultiCaptureOptions = {
  readonly url: string;
  readonly breakpoints: readonly Breakpoint[];
  readonly waitUntil?: CaptureOptions["waitUntil"];
  readonly timeoutMs?: number;
  readonly captureScreenshot?: boolean;
};

export type CapturedBreakpoint = {
  readonly breakpoint: Breakpoint;
  readonly result: CaptureResult;
};

/** Capture a URL at every breakpoint sequentially and return the bundle. */
export async function captureMultiViewport(
  options: MultiCaptureOptions,
): Promise<readonly CapturedBreakpoint[]> {
  const captured: CapturedBreakpoint[] = [];
  for (const bp of options.breakpoints) {
    const result = await captureViewport({
      url: options.url,
      viewport: { width: bp.width, height: bp.height },
      devicePixelRatio: bp.devicePixelRatio ?? 1,
      waitUntil: options.waitUntil,
      timeoutMs: options.timeoutMs,
      captureScreenshot: options.captureScreenshot,
    });
    captured.push({ breakpoint: bp, result });
  }
  return captured;
}

/** Default mobile / tablet / desktop trio used by the CLI and verifiers. */
export const DEFAULT_BREAKPOINTS: readonly Breakpoint[] = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];
