/**
 * @file Viewport module - Format-agnostic viewport transform management
 *
 * Provides types and pure functions for SVG canvas viewport operations:
 * pan, zoom, coordinate conversion, and fit-to-view calculations.
 *
 * Format-agnostic SoT for SVG viewport operations.
 */

// Types
export type { ViewportTransform, ViewportSize, SlideSize } from "./types";
export { INITIAL_VIEWPORT } from "./types";

// Coordinate conversion
export {
  screenToSlideCoords,
  slideToScreenCoords,
  screenToCanvasCoords,
  isPointInCanvasArea,
  isPointInRulerArea,
} from "./coords";

// Transform utilities
export {
  getTransformString,
  ZOOM_LEVELS,
  getNextZoomValue,
  getCenteredViewport,
  getFitScale,
  zoomTowardCursor,
  panViewport,
  clampViewport,
  createFittedViewport,
} from "./transform";
