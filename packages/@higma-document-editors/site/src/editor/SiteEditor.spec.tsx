/**
 * @file Site editor UI smoke tests.
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { SiteEditorProvider } from "../context/SiteEditorContext";
import { SiteCmsPanel } from "../panels/SiteCmsPanel";
import { SitePagesPanel } from "../panels/SitePagesPanel";
import { SitePropertiesPanel } from "../panels/SitePropertiesPanel";
import { SiteStructurePanel } from "../panels/SiteStructurePanel";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";

function renderWithSiteProvider(children: ReactNode): string {
  const workspace = createSiteEditorWorkspace(createSiteEditorTestDocument());
  return renderToStaticMarkup(<SiteEditorProvider workspace={workspace}>{children}</SiteEditorProvider>);
}

describe("site editor panels", () => {
  it("renders structure, CMS bindings, and selected properties from the site workspace", () => {
    const markup = renderWithSiteProvider(
      <>
        <SitePagesPanel />
        <SiteStructurePanel />
        <SiteCmsPanel />
        <SitePropertiesPanel />
      </>,
    );

    expect(markup).toContain("Articles");
    expect(markup).toContain("Pages");
    expect(markup).toContain("collection-1");
    expect(markup).toContain("CMS Bindings");
    expect(markup).toContain("Render coordinates");
  });
});
