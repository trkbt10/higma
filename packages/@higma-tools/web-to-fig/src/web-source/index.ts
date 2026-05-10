/**
 * @file Public entry — viewport capture surface.
 */
export type { CaptureOptions, CaptureResult } from "./capture";
export { captureViewport, captureViewportInBrowser, launchBrowser, jsonToSnapshot } from "./capture";

export type { BrowserLike } from "./playwright-shared";

export type { ElementJson, RawSnapshotJson } from "./in-page";
export { captureSnapshot } from "./in-page";

export type { RawAsset, RawElement, RawRect, RawViewportSnapshot } from "./snapshot";

export type { Breakpoint, CapturedBreakpoint, MultiCaptureOptions } from "./multi-capture";
export { DEFAULT_BREAKPOINTS, captureMultiViewport } from "./multi-capture";

export type { CdpExtractOptions, ExtractOptions, ExtractResult, UrlExtractOptions } from "./extract";
export { extractElement } from "./extract";
