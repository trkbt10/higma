/**
 * @file Unified extractor — merge Variables + Styles into one `TokenSet`.
 *
 * Variables-sourced tokens come first in the output (they tend to be
 * the consumer's primary design system); style-sourced tokens follow.
 * No effort is made to deduplicate across the boundary because a
 * variable's mode-keyed value and a style's modeless value are not
 * interchangeable even when they currently resolve to the same colour.
 */

import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { TokenSet } from "../token-set";
import { extractVariableTokens } from "./variables";
import { extractStyleTokens } from "./styles";

/** Build a `TokenSet` from a parsed Kiwi document. */
export function extractTokens(document: FigKiwiDocumentIndex): TokenSet {
  const variableExtraction = extractVariableTokens(document);
  const styleTokens = extractStyleTokens(document);
  return {
    tokens: [...variableExtraction.tokens, ...styleTokens],
    modesBySetSlug: variableExtraction.modesBySetSlug,
  };
}
