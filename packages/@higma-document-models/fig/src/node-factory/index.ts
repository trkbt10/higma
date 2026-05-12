/**
 * @file Node-factory: load-bearing Kiwi field SoT for FigNode projection
 *
 * Single source of truth for the per-type defaults, derived data, and
 * blob encoding that the `FigDesignDocument → FigNode[]` projection
 * (`document-to-tree`) and editor reducer actions both consume.
 */

export { applyNodeTypeDefaults } from "./type-defaults";
export { computeDerivedSymbolData } from "./derived-symbol-data";
export {
  encodeRectangleBlob,
  encodeRoundedRectangleBlob,
  encodeEllipseBlob,
} from "./blob-encoders";
export { encodeSvgPathBlob } from "./svg-path-encoder";
