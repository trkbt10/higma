/**
 * @file Deck document editor boundary.
 */

import { createDeckDomainSummary, type DeckDocument, type DeckDomainSummary } from "@higma-document-models/deck";
import { loadDeckDocumentResult } from "@higma-document-io/deck";
import { createDeckRenderPlan, type DeckRenderPlan } from "@higma-document-renderers/deck";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type DeckEditorSession = EditorSession<DeckDocument, "deck", DeckDocument["insights"]>;

export type DeckEditorOverview = {
  readonly nodeCount: number;
  readonly renderUnitCount: number;
  readonly schemaDefinitionCount: number;
  readonly schemaDefinitionNames: readonly string[];
  readonly nodeTypeNames: readonly string[];
  readonly metadataKeys: readonly string[];
  readonly clientMetaKeys: readonly string[];
  readonly metadataFlags: {
    readonly hasRenderCoordinates: boolean;
    readonly hasThumbnailSize: boolean;
    readonly hasDeveloperRelatedLinks: boolean;
    readonly hasExportTimestamp: boolean;
  };
  readonly domainSummary: DeckDomainSummary;
};

export type DeckEditorWorkspace = {
  readonly session: DeckEditorSession;
  readonly renderPlan: DeckRenderPlan;
  readonly overview: DeckEditorOverview;
};

function createDeckEditorOverview(document: DeckDocument, renderPlan: DeckRenderPlan): DeckEditorOverview {
  return {
    nodeCount: document.summary.totalNodes,
    renderUnitCount: renderPlan.renderOutline.entries.length,
    schemaDefinitionCount: document.insights.schema.definitionCount,
    schemaDefinitionNames: document.insights.schema.definitionNames,
    nodeTypeNames: [...document.summary.nodeTypes.keys()].sort(),
    metadataKeys: document.insights.metadata.rawKeys,
    clientMetaKeys: document.insights.metadata.clientMetaKeys,
    metadataFlags: {
      hasRenderCoordinates: document.insights.metadata.hasRenderCoordinates,
      hasThumbnailSize: document.insights.metadata.hasThumbnailSize,
      hasDeveloperRelatedLinks: document.insights.metadata.hasDeveloperRelatedLinks,
      hasExportTimestamp: document.insights.metadata.hasExportTimestamp,
    },
    domainSummary: createDeckDomainSummary(document),
  };
}

/** Create a deck editor session from a deck document model. */
export function createDeckEditorSession(document: DeckDocument): DeckEditorSession {
  return createEditorSession("deck", document, document.insights);
}

/** Create the editor-facing deck workspace from a decoded product document. */
export function createDeckEditorWorkspace(document: DeckDocument): DeckEditorWorkspace {
  const renderPlan = createDeckRenderPlan(document);
  return {
    session: createDeckEditorSession(document),
    renderPlan,
    overview: createDeckEditorOverview(document, renderPlan),
  };
}

/** Open packaged or raw deck bytes as an editor workspace. */
export async function openDeckEditor(data: Uint8Array): Promise<DeckEditorWorkspace> {
  const result = await loadDeckDocumentResult(data);
  return createDeckEditorWorkspace(result.document);
}
