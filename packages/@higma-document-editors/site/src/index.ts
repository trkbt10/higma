/**
 * @file Site document editor boundary.
 */

import { createSiteDomainSummary, type SiteDocument, type SiteDomainSummary } from "@higma-document-models/site";
import { loadSiteDocumentResult } from "@higma-document-io/site";
import { createSiteRenderPlan, type SiteRenderPlan } from "@higma-document-renderers/site";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type SiteEditorSession = EditorSession<SiteDocument, "site", SiteDocument["insights"]>;

export type SiteEditorOverview = {
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
  readonly domainSummary: SiteDomainSummary;
};

export type SiteEditorWorkspace = {
  readonly session: SiteEditorSession;
  readonly renderPlan: SiteRenderPlan;
  readonly overview: SiteEditorOverview;
};

function createSiteEditorOverview(document: SiteDocument, renderPlan: SiteRenderPlan): SiteEditorOverview {
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
    domainSummary: createSiteDomainSummary(document),
  };
}

/** Create a site editor session from a site document model. */
export function createSiteEditorSession(document: SiteDocument): SiteEditorSession {
  return createEditorSession("site", document, document.insights);
}

/** Create the editor-facing site workspace from a decoded product document. */
export function createSiteEditorWorkspace(document: SiteDocument): SiteEditorWorkspace {
  const renderPlan = createSiteRenderPlan(document);
  return {
    session: createSiteEditorSession(document),
    renderPlan,
    overview: createSiteEditorOverview(document, renderPlan),
  };
}

/** Open packaged or raw site bytes as an editor workspace. */
export async function openSiteEditor(data: Uint8Array): Promise<SiteEditorWorkspace> {
  const result = await loadSiteDocumentResult(data);
  return createSiteEditorWorkspace(result.document);
}
