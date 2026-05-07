/**
 * @file Site pages panel operation tests.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { SiteEditorProvider, useSiteEditor } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import { SitePagesPanel } from "./SitePagesPanel";

function ActiveSurfaceProbe() {
  const { activeSurface } = useSiteEditor();
  return <output aria-label="active site page">{activeSurface.id}</output>;
}

function renderPagesPanel() {
  const workspace = createSiteEditorWorkspace(createSiteEditorTestDocument());
  return render(
    <SiteEditorProvider workspace={workspace}>
      <SitePagesPanel />
      <ActiveSurfaceProbe />
    </SiteEditorProvider>,
  );
}

describe("SitePagesPanel", () => {
  it("uses visible page buttons for the edited site surface", () => {
    renderPagesPanel();

    const pageButtons = screen.getAllByRole("button", { name: /Site page/ });
    const firstPageButton = pageButtons[0];
    if (!firstPageButton) {
      throw new Error("SitePagesPanel test requires a page button");
    }

    expect(pageButtons.length).toBeGreaterThan(0);
    expect(firstPageButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(firstPageButton);

    expect(screen.getByLabelText("active site page").textContent).toBe("0:1");
  });
});
