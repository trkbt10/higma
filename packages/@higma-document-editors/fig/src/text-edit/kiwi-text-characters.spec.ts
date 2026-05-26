/** @file Kiwi TEXT character mutation tests. */
import { sectionNode, sectionTextData } from "../panels/sections/section-specimen";
import { readKiwiTextCharacters, writeKiwiTextCharacters } from "./kiwi-text-characters";

describe("Kiwi TEXT character mutation", () => {
  it("reads and writes textData characters", () => {
    const node = sectionNode("TEXT", {
      textData: sectionTextData("Before"),
      derivedTextData: {
        baselines: [{ position: { x: 1, y: 2 }, width: 20 }],
        fontMetaData: [],
      },
    });

    const updated = writeKiwiTextCharacters(node, "After");

    expect(readKiwiTextCharacters(updated)).toBe("After");
    expect(updated.textData?.characters).toBe("After");
    expect(updated.derivedTextData?.baselines[0]?.position).toBeUndefined();
  });

  it("removes stale per-character style overrides when editing changes text length", () => {
    const node = sectionNode("TEXT", {
      textData: {
        ...sectionTextData("Headline"),
        characterStyleIDs: [0, 0, 0, 0, 0, 0, 0, 0],
        styleOverrideTable: [{ styleID: 1, fontSize: 18 }],
      },
    });

    const updated = writeKiwiTextCharacters(node, "Headline edited");

    expect(updated.textData?.characterStyleIDs).toBeUndefined();
    expect(updated.textData?.styleOverrideTable).toBeUndefined();
  });

  it("updates root characters when the Kiwi node stores characters outside textData", () => {
    const node = { ...sectionNode("TEXT"), characters: "Before" };

    const updated = writeKiwiTextCharacters(node, "After");

    expect(updated.characters).toBe("After");
  });

  it("throws when no character storage is present", () => {
    const node = sectionNode("TEXT");

    expect(() => writeKiwiTextCharacters(node, "After")).toThrow(
      "writeKiwiTextCharacters cannot update a TEXT node without characters storage",
    );
  });
});
