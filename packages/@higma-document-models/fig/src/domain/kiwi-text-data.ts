/** @file Kiwi TextData mutation rules shared by editor and SymbolResolver. */

import type { FigKiwiTextData } from "../types";

type MutableFigKiwiTextData = {
  -readonly [K in keyof FigKiwiTextData]: FigKiwiTextData[K];
};

/**
 * Write TEXT characters into a Kiwi TextData payload and discard
 * per-character overrides when their index array no longer matches
 * the new character stream. Keeping stale `characterStyleIDs` would
 * make the text run resolver consume invalid Kiwi state.
 */
export function writeFigKiwiTextDataCharacters(
  existingTextData: FigKiwiTextData | undefined,
  characters: string,
): FigKiwiTextData {
  const next: MutableFigKiwiTextData = {
    ...(existingTextData ?? { characters: "" }),
    characters,
  };
  if (!figKiwiTextDataStyleIDsMatchCharacters(next.characterStyleIDs, characters)) {
    delete next.characterStyleIDs;
    delete next.styleOverrideTable;
  }
  return next;
}

/** Return whether Kiwi per-character style IDs still address the current text stream. */
export function figKiwiTextDataStyleIDsMatchCharacters(
  characterStyleIDs: readonly number[] | undefined,
  characters: string,
): boolean {
  if (characterStyleIDs === undefined || characterStyleIDs.length === 0) {
    return true;
  }
  if (characterStyleIDs.length === characters.length) {
    return true;
  }
  return characterStyleIDs.length === [...characters].length;
}
