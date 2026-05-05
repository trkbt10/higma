/**
 * @file Buzz document editor boundary.
 */

import { createBuzzDomainSummary, type BuzzDocument, type BuzzDomainSummary } from "@higma-document-models/buzz";
import { loadBuzzDocumentResult } from "@higma-document-io/buzz";
import { createBuzzRenderPlan, type BuzzRenderPlan } from "@higma-document-renderers/buzz";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type BuzzEditorSession = EditorSession<BuzzDocument, "buzz", BuzzDocument["insights"]>;

export type BuzzEditorOverview = {
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
  readonly domainSummary: BuzzDomainSummary;
};

export type BuzzEditorWorkspace = {
  readonly session: BuzzEditorSession;
  readonly renderPlan: BuzzRenderPlan;
  readonly overview: BuzzEditorOverview;
};

function createBuzzEditorOverview(document: BuzzDocument, renderPlan: BuzzRenderPlan): BuzzEditorOverview {
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
    domainSummary: createBuzzDomainSummary(document),
  };
}

/** Create a buzz editor session from a buzz document model. */
export function createBuzzEditorSession(document: BuzzDocument): BuzzEditorSession {
  return createEditorSession("buzz", document, document.insights);
}

/** Create the editor-facing buzz workspace from a decoded product document. */
export function createBuzzEditorWorkspace(document: BuzzDocument): BuzzEditorWorkspace {
  const renderPlan = createBuzzRenderPlan(document);
  return {
    session: createBuzzEditorSession(document),
    renderPlan,
    overview: createBuzzEditorOverview(document, renderPlan),
  };
}

/** Open packaged or raw buzz bytes as an editor workspace. */
export async function openBuzzEditor(data: Uint8Array): Promise<BuzzEditorWorkspace> {
  const result = await loadBuzzDocumentResult(data);
  return createBuzzEditorWorkspace(result.document);
}
