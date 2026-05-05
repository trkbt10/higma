/**
 * @file Deck document editor boundary.
 */

import type { DeckDocument } from "@higma-document-models/deck";
import { loadDeckDocumentResult } from "@higma-document-io/deck";
import { createDeckRenderPlan, type DeckRenderPlan } from "@higma-document-renderers/deck";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type DeckEditorSession = EditorSession<DeckDocument, "deck", DeckDocument["insights"]>;

export type DeckEditorOverview = {
  readonly nodeCount: number;
  readonly schemaDefinitionCount: number;
  readonly metadataKeys: readonly string[];
  readonly clientMetaKeys: readonly string[];
};

export type DeckEditorWorkspace = {
  readonly session: DeckEditorSession;
  readonly renderPlan: DeckRenderPlan;
  readonly overview: DeckEditorOverview;
};

function createDeckEditorOverview(document: DeckDocument): DeckEditorOverview {
  return {
    nodeCount: document.summary.totalNodes,
    schemaDefinitionCount: document.insights.schema.definitionCount,
    metadataKeys: document.insights.metadata.rawKeys,
    clientMetaKeys: document.insights.metadata.clientMetaKeys,
  };
}

/** Create a deck editor session from a deck document model. */
export function createDeckEditorSession(document: DeckDocument): DeckEditorSession {
  return createEditorSession("deck", document, document.insights);
}

/** Create the editor-facing deck workspace from a decoded product document. */
export function createDeckEditorWorkspace(document: DeckDocument): DeckEditorWorkspace {
  return {
    session: createDeckEditorSession(document),
    renderPlan: createDeckRenderPlan(document),
    overview: createDeckEditorOverview(document),
  };
}

/** Open packaged or raw deck bytes as an editor workspace. */
export async function openDeckEditor(data: Uint8Array): Promise<DeckEditorWorkspace> {
  const result = await loadDeckDocumentResult(data);
  return createDeckEditorWorkspace(result.document);
}
