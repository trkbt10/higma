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
  readonly schemaDefinitionCount: number;
  readonly metadataKeys: readonly string[];
  readonly clientMetaKeys: readonly string[];
  readonly domainSummary: BuzzDomainSummary;
};

export type BuzzEditorWorkspace = {
  readonly session: BuzzEditorSession;
  readonly renderPlan: BuzzRenderPlan;
  readonly overview: BuzzEditorOverview;
};

function createBuzzEditorOverview(document: BuzzDocument): BuzzEditorOverview {
  return {
    nodeCount: document.summary.totalNodes,
    schemaDefinitionCount: document.insights.schema.definitionCount,
    metadataKeys: document.insights.metadata.rawKeys,
    clientMetaKeys: document.insights.metadata.clientMetaKeys,
    domainSummary: createBuzzDomainSummary(document),
  };
}

/** Create a buzz editor session from a buzz document model. */
export function createBuzzEditorSession(document: BuzzDocument): BuzzEditorSession {
  return createEditorSession("buzz", document, document.insights);
}

/** Create the editor-facing buzz workspace from a decoded product document. */
export function createBuzzEditorWorkspace(document: BuzzDocument): BuzzEditorWorkspace {
  return {
    session: createBuzzEditorSession(document),
    renderPlan: createBuzzRenderPlan(document),
    overview: createBuzzEditorOverview(document),
  };
}

/** Open packaged or raw buzz bytes as an editor workspace. */
export async function openBuzzEditor(data: Uint8Array): Promise<BuzzEditorWorkspace> {
  const result = await loadBuzzDocumentResult(data);
  return createBuzzEditorWorkspace(result.document);
}
