/**
 * @file Public entry point for raw fig-family canvas mechanics
 */

export {
  DEFAULT_FIG_CANVAS_MAGIC,
  FIG_CANVAS_HEADER_SIZE,
  buildFigCanvasFile,
  buildFigCanvasHeader,
  getFigCanvasPayload,
  isFigCanvas,
  parseFigCanvasHeader,
  type FigCanvasHeader,
} from "./header";
