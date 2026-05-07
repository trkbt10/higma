/**
 * @file Site CMS panel operation tests.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { SiteEditorProvider, useSiteEditor } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import { SiteCmsPanel } from "./SiteCmsPanel";
import { SitePropertiesPanel } from "./SitePropertiesPanel";

function SelectedUnitProbe() {
  const { selectedUnit } = useSiteEditor();
  return <output aria-label="selected unit">{selectedUnit.id}:{selectedUnit.label}</output>;
}

function renderCmsPanelWithProperties() {
  const workspace = createSiteEditorWorkspace(createSiteEditorTestDocument());
  return render(
    <SiteEditorProvider workspace={workspace}>
      <SiteCmsPanel />
      <SitePropertiesPanel />
      <SelectedUnitProbe />
    </SiteEditorProvider>,
  );
}

describe("SiteCmsPanel", () => {
  it("selects a CMS rich text binding and updates the properties panel", () => {
    renderCmsPanelWithProperties();

    fireEvent.click(screen.getByRole("button", { name: /Body collection-1 \/ body/ }));

    expect(screen.getByLabelText("selected unit").textContent).toBe("0:3:Body");
    expect(screen.getByText("CMS_SERIALIZED_RICH_TEXT_DATA")).toBeTruthy();
    expect(screen.getAllByText("collection-1 / body").length).toBeGreaterThan(0);
  });
});
