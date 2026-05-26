/**
 * @file Hook for reading resources from the editor's Kiwi document context.
 */
import type { FigDocumentResources } from "@higma-document-io/fig";
import { useFigEditorSelector, type FigEditorContextValue } from "../context/FigEditorContext";

function selectFigDocumentResources(editor: FigEditorContextValue): FigDocumentResources {
  return editor.resources;
}

/**
 * Return resources derived from the immutable editor document context.
 */
export function useFigDocumentResources(): FigDocumentResources {
  return useFigEditorSelector(selectFigDocumentResources);
}
