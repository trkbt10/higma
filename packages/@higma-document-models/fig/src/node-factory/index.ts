/**
 * @file Node-factory: load-bearing Kiwi field SoT for FigNode projection
 *
 * Single source of truth for Kiwi node field defaults and blob
 * encoding.
 */

export { applyNodeTypeDefaults } from "./type-defaults";
export {
  encodeRectangleBlob,
  encodeRoundedRectangleBlob,
  encodeEllipseBlob,
} from "./blob-encoders";
export { encodeSvgPathBlob } from "./svg-path-encoder";
