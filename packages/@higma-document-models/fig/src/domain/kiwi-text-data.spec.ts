/** @file Spec for Kiwi TextData character mutation rules. */

import { writeFigKiwiTextDataCharacters } from "./kiwi-text-data";

describe("writeFigKiwiTextDataCharacters", () => {
  it("keeps per-character style overrides when the character count stays aligned", () => {
    const result = writeFigKiwiTextDataCharacters({
      characters: "AB",
      characterStyleIDs: [0, 1],
      styleOverrideTable: [{ styleID: 1, fontSize: 18 }],
    }, "CD");

    expect(result.characterStyleIDs).toEqual([0, 1]);
    expect(result.styleOverrideTable).toEqual([{ styleID: 1, fontSize: 18 }]);
  });

  it("removes stale per-character style overrides when the new text length differs", () => {
    const result = writeFigKiwiTextDataCharacters({
      characters: "Headline",
      characterStyleIDs: [0, 0, 0, 0, 0, 0, 0, 0],
      styleOverrideTable: [{ styleID: 1, fontSize: 18 }],
    }, "Headline edited");

    expect(result.characters).toBe("Headline edited");
    expect(result.characterStyleIDs).toBeUndefined();
    expect(result.styleOverrideTable).toBeUndefined();
  });

  it("accepts logical character counts for non-BMP characters", () => {
    const result = writeFigKiwiTextDataCharacters({
      characters: "😀",
      characterStyleIDs: [0],
      styleOverrideTable: [{ styleID: 1, fontSize: 18 }],
    }, "😁");

    expect(result.characterStyleIDs).toEqual([0]);
  });
});
