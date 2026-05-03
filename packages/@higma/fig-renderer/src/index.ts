/**
 * @file Figma renderer package entry point
 *
 * This package provides SVG rendering for Figma nodes.
 *
 * For parsing .fig files, import from @higma/fig/parser:
 *   import { parseFigFile, parseFigFileSync } from "@higma/fig/parser";
 *
 * For Figma types (FigNodeType, FigMatrix, FigColor, etc.), import from @higma/fig/types:
 *   import type { FigNodeType, FigMatrix, FigColor } from "@higma/fig/types";
 */

// =============================================================================
// Renderer-specific types
// =============================================================================

export type { FigSvgRenderContext, FigSvgRenderContextConfig, FigSvgRenderResult } from "./types";
