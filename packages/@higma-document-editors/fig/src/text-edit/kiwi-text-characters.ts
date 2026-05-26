/** @file Kiwi TEXT character mutation for editor and automation surfaces. */
import {
  derivedTextDataWithoutVisualPayload,
  writeFigKiwiTextDataCharacters,
} from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";

/** Read characters from the Kiwi TEXT fields used by the loaded document. */
export function readKiwiTextCharacters(node: FigNode): string {
  if (typeof node.textData?.characters === "string") {
    return node.textData.characters;
  }
  if (typeof node.characters === "string") {
    return node.characters;
  }
  throw new Error("readKiwiTextCharacters requires Kiwi TEXT characters");
}

/** Write characters while invalidating derived visual text payload carried by Kiwi. */
export function writeKiwiTextCharacters(node: FigNode, characters: string): FigNode {
  const hasTextData = node.textData !== undefined;
  const hasRootCharacters = typeof node.characters === "string";
  if (!hasTextData && !hasRootCharacters) {
    throw new Error("writeKiwiTextCharacters cannot update a TEXT node without characters storage");
  }
  return {
    ...node,
    characters: hasRootCharacters ? characters : node.characters,
    textData: hasTextData ? writeFigKiwiTextDataCharacters(node.textData, characters) : node.textData,
    derivedTextData: derivedTextDataWithoutVisualPayload(node.derivedTextData),
  };
}
