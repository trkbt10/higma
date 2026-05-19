/**
 * @file Hook for reading resources from the editor's Kiwi document context.
 */
import type { FigDocumentResources } from "@higma-document-io/fig";
import { useFigEditor } from "../context/FigEditorContext";

/**
 * Return resources derived from the immutable editor document context.
 */
export function useFigDocumentResources(): FigDocumentResources {
  return useFigEditor().resources;
}
