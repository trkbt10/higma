/**
 * @file Visual-fidelity verification entry — render emitted .fig back
 * to PNG via the document-renderers pipeline and pixel-diff against
 * the original Playwright screenshot.
 */
export type { ComparisonOutcome, CompareOptions } from "./compare";
export { comparePng } from "./compare";

export type { RenderedFrame, RenderFigOptions } from "./render-fig";
export { renderFigBytes } from "./render-fig";

export type { VerificationReport, VerifiedBreakpoint, VerifyOptions } from "./verify-fidelity";
export { verifyFidelity } from "./verify-fidelity";
