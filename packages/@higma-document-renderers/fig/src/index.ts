/**
 * @file Figma renderer package entry point
 *
 * This package provides SVG rendering for Figma nodes.
 *
 * For parsing .fig files, import from @higma-document-models/fig/domain:
 *   import { parseFigFile, parseFigFileSync } from "@higma-document-models/fig/domain";
 *
 * For Figma types (FigNodeType, FigMatrix, FigColor, etc.), import from @higma-document-models/fig/types:
 *   import type { FigNodeType, FigMatrix, FigColor } from "@higma-document-models/fig/types";
 */

// =============================================================================
// Renderer-specific types
// =============================================================================

export type { FigSvgRenderContext, FigSvgRenderContextConfig, FigSvgRenderResult } from "./types";
