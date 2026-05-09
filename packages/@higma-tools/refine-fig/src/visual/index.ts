/**
 * @file Public entry — visual.
 */
export { createNodeRenderer } from "./render-node";
export type { NodeRenderContext, RenderedNode, RenderOptions, NodeRenderer } from "./render-node";
export { perceptualHash, combinedDistance } from "./perceptual-hash";
export type { PerceptualHash } from "./perceptual-hash";
export { renderFrames } from "./render-frames";
export type { RenderedFrame, RenderFramesOptions } from "./render-frames";
export { renderFramesViaWorker } from "./render-frames-worker";
export type { WorkerRenderedFrame, RenderFramesViaWorkerOptions } from "./render-frames-worker";
export { comparePng } from "./compare-png";
export type { ComparisonOutcome, CompareOptions } from "./compare-png";
