/**
 * @file Deck document editor boundary.
 */

import type { DeckDocument } from "@higma-document-models/deck";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type DeckEditorSession = EditorSession<DeckDocument, "deck", DeckDocument["insights"]>;

/** Create a deck editor session from a deck document model. */
export function createDeckEditorSession(document: DeckDocument): DeckEditorSession {
  return createEditorSession("deck", document, document.insights);
}
