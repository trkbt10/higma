/**
 * @file Site document editor boundary.
 */

import type { SiteDocument } from "@higma-document-models/site";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type SiteEditorSession = EditorSession<SiteDocument, "site", SiteDocument["insights"]>;

/** Create a site editor session from a site document model. */
export function createSiteEditorSession(document: SiteDocument): SiteEditorSession {
  return createEditorSession("site", document, document.insights);
}
