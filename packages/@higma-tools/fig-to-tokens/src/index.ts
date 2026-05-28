/**
 * @file Public API for `@higma-tools/fig-to-tokens`.
 *
 * Two entry points:
 *
 *   - `extractTokens(document)` — read Variables + Styles out of a
 *     parsed Kiwi document into the source-agnostic `TokenSet`.
 *   - `tokensToJson(tokens)` / `tokensToCss(tokens)` — render the set
 *     to DTCG JSON or CSS custom properties.
 *
 * Consumers that want raw building blocks (e.g. only the variable
 * extractor) can drill into `./extract` directly; this index keeps
 * the high-traffic surface tight.
 */

export type {
  ColorValue,
  NumberValue,
  BooleanValue,
  StringValue,
  TypographyValue,
  ShadowValue,
  RawCssValue,
  TokenValue,
  TokenSource,
  Token,
  TokenSet,
} from "./token-set";
export { extractTokens } from "./extract";
export { extractVariableTokens } from "./extract/variables";
export { extractStyleTokens } from "./extract/styles";
export { tokensToJson, type TokensToJsonOptions } from "./emit/json";
export { tokensToCss, type TokensToCssOptions } from "./emit/css";
