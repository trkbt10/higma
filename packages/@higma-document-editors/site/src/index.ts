/**
 * @file Site document editor boundary.
 */

import type { SiteDocument } from "@higma-document-models/site";
import { loadSiteDocumentResult } from "@higma-document-io/site";
import { createSiteRenderPlan, type SiteRenderPlan } from "@higma-document-renderers/site";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type SiteEditorSession = EditorSession<SiteDocument, "site", SiteDocument["insights"]>;

export type SiteEditorOverview = {
  readonly nodeCount: number;
  readonly schemaDefinitionCount: number;
  readonly metadataKeys: readonly string[];
  readonly clientMetaKeys: readonly string[];
};

export type SiteEditorWorkspace = {
  readonly session: SiteEditorSession;
  readonly renderPlan: SiteRenderPlan;
  readonly overview: SiteEditorOverview;
};

function createSiteEditorOverview(document: SiteDocument): SiteEditorOverview {
  return {
    nodeCount: document.summary.totalNodes,
    schemaDefinitionCount: document.insights.schema.definitionCount,
    metadataKeys: document.insights.metadata.rawKeys,
    clientMetaKeys: document.insights.metadata.clientMetaKeys,
  };
}

/** Create a site editor session from a site document model. */
export function createSiteEditorSession(document: SiteDocument): SiteEditorSession {
  return createEditorSession("site", document, document.insights);
}

/** Create the editor-facing site workspace from a decoded product document. */
export function createSiteEditorWorkspace(document: SiteDocument): SiteEditorWorkspace {
  return {
    session: createSiteEditorSession(document),
    renderPlan: createSiteRenderPlan(document),
    overview: createSiteEditorOverview(document),
  };
}

/** Open packaged or raw site bytes as an editor workspace. */
export async function openSiteEditor(data: Uint8Array): Promise<SiteEditorWorkspace> {
  const result = await loadSiteDocumentResult(data);
  return createSiteEditorWorkspace(result.document);
}
