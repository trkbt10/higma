/**
 * @file Buzz document editor boundary.
 */

import type { BuzzDocument } from "@higma-document-models/buzz";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type BuzzEditorSession = EditorSession<BuzzDocument, "buzz", BuzzDocument["insights"]>;

/** Create a buzz editor session from a buzz document model. */
export function createBuzzEditorSession(document: BuzzDocument): BuzzEditorSession {
  return createEditorSession("buzz", document, document.insights);
}
