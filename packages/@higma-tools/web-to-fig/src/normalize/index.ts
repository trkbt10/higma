/**
 * @file DOM snapshot → ViewportIR normaliser.
 */
export { normalizeViewport, resolveFontFamily } from "./normalize";
export type { NormalizeViewportOptions } from "./normalize";
export {
  parseFontStack,
  UnresolvedFontStackError,
} from "./font-resolver";
export type { FontResolver, FontStackCandidate, GenericFamily } from "./font-resolver";
export {
  parseBackgroundImage,
  parseBoxShadow,
  parseColor,
  parseFontWeight,
  parsePx,
} from "./parse-css";
