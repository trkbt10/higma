/**
 * @file SVG render context for Figma nodes
 *
 * This context is consumed only by the standalone text-path functions
 * (`renderTextNodeAsPath`, `renderDerivedPathText`). The full fig scene
 * rendering goes through `SceneGraph` → `resolveRenderTree` → backend
 * formatter (SVG string / React JSX / WebGL) — that pipeline owns ID
 * generation for gradients, masks, filters, clip-paths. See
 * `scene-graph/render/fill.ts` `IdGenerator` for the single source of
 * truth on def-ID namespacing across backends.
 */

import type { FigSvgRenderContext, FigSvgRenderContextConfig } from "../types";
import { EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";

/** Default canvas size */
const DEFAULT_CANVAS_SIZE = { width: 800, height: 600 };

/**
 * Create an SVG render context for the text-path functions.
 */
export function createFigSvgRenderContext(
  config?: FigSvgRenderContextConfig
): FigSvgRenderContext {
  return {
    canvasSize: config?.canvasSize ?? DEFAULT_CANVAS_SIZE,
    blobs: config?.blobs ?? [],
    images: config?.images ?? new Map(),
    showHiddenNodes: config?.showHiddenNodes ?? false,
    fontLoader: config?.fontLoader,
    styleRegistry: config?.styleRegistry ?? EMPTY_FIG_STYLE_REGISTRY,
  };
}

/**
 * Create an empty SVG render context (for testing)
 */
export function createEmptyFigSvgRenderContext(): FigSvgRenderContext {
  return createFigSvgRenderContext();
}
