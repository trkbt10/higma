/**
 * @file Public verify entry — full web → fig → web round-trip
 * verification driving fig-to-web's actual user-visible render.
 */
export type { RenderedPreviewFrame, RenderPreviewOptions } from "./render-preview";
export { renderPreview } from "./render-preview";

export type { StaticPreview } from "./preview-server";
export { startStaticPreview } from "./preview-server";

export type { VerificationReport, VerifiedBreakpoint, VerifyOptions } from "./verify-fidelity";
export { verifyFidelity } from "./verify-fidelity";

export type { FigDirectRenderResult, WebglHarness } from "./render-fig-webgl";
export { renderFigViewports, renderFigFramesByName, startWebglHarness } from "./render-fig-webgl";

export type { DirectVerificationReport, DirectVerifiedBreakpoint, DirectVerifyOptions } from "./verify-fig-direct";
export { verifyFigDirect } from "./verify-fig-direct";
