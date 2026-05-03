/**
 * @file Figma renderer package entry point
 *
 * This package provides SVG rendering for Figma nodes.
 *
 * For parsing .fig files, import from @higuma/fig/parser:
 *   import { parseFigFile, parseFigFileSync } from "@higuma/fig/parser";
 *
 * For Figma types (FigNodeType, FigMatrix, FigColor, etc.), import from @higuma/fig/types:
 *   import type { FigNodeType, FigMatrix, FigColor } from "@higuma/fig/types";
 */

// =============================================================================
// Renderer-specific types
// =============================================================================

export type { FigSvgRenderContext, FigSvgRenderContextConfig, FigSvgRenderResult } from "./types";
