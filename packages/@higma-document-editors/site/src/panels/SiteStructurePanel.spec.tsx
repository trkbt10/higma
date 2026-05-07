/**
 * @file Site structure panel operation tests.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { SiteEditorProvider, useSiteEditor } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import { SiteStructurePanel } from "./SiteStructurePanel";

function SelectedUnitProbe() {
  const { selectedUnit } = useSiteEditor();
  return <output aria-label="selected unit">{selectedUnit.id}:{selectedUnit.label}</output>;
}

function renderStructurePanel() {
  const workspace = createSiteEditorWorkspace(createSiteEditorTestDocument());
  return render(
    <SiteEditorProvider workspace={workspace}>
      <SiteStructurePanel />
      <SelectedUnitProbe />
    </SiteEditorProvider>,
  );
}

describe("SiteStructurePanel", () => {
  it("reflects repeated structure selections through editor-kernel backed site selection state", () => {
    renderStructurePanel();

    const pageItem = screen.getByRole("treeitem", { name: /Case Study Page/ });
    const bodyItem = screen.getByRole("treeitem", { name: /Body/ });

    expect(screen.getByLabelText("selected unit").textContent).toBe("0:2:Articles");
    fireEvent.click(bodyItem);

    expect(screen.getByLabelText("selected unit").textContent).toBe("0:3:Body");
    expect(bodyItem.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(pageItem);

    expect(screen.getByLabelText("selected unit").textContent).toBe("0:1:Case Study Page");
    expect(pageItem.getAttribute("aria-selected")).toBe("true");
  });
});
