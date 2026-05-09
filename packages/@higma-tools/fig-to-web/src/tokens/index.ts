/**
 * @file Public entry for design-token extraction.
 */
export type {
  ColorToken,
  RadiusToken,
  ShadowToken,
  SpacingToken,
  TokenColor,
  TokenIndex,
  TokenSet,
  TypographyToken,
} from "./types";

export { buildTokensFromFrames } from "./extract";
export type { TokenBuildResult } from "./extract";
export { tokensToCss } from "./css";
export { effectsToBoxShadow } from "./effect";
