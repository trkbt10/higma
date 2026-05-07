/**
 * @file CMS workspace navigation tests covering list, table, and detail pages.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import { SiteEditorProvider, useSiteEditor } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import { SiteCmsWorkspace } from "./SiteCmsWorkspace";

function SelectedUnitProbe() {
  const { selectedUnit } = useSiteEditor();
  return <output aria-label="selected unit">{selectedUnit.id}:{selectedUnit.label}</output>;
}

function renderWorkspace() {
  const workspace = createSiteEditorWorkspace(createSiteEditorTestDocument());
  return render(
    <SiteEditorProvider workspace={workspace}>
      <SiteCmsWorkspace />
      <SelectedUnitProbe />
    </SiteEditorProvider>,
  );
}

describe("SiteCmsWorkspace", () => {
  it("lists the collections referenced by the document", () => {
    renderWorkspace();
    const list = screen.getByRole("region", { name: "Site CMS collections" });
    expect(within(list).getByText("collection-1")).toBeTruthy();
    expect(within(list).getAllByText("1")[0]).toBeTruthy();
  });

  function openCollection() {
    const region = screen.getByRole("region", { name: "Site CMS collections" });
    const row = within(region).getByText("collection-1").closest("tr");
    if (!row) {
      throw new Error("Expected a row for collection-1");
    }
    fireEvent.click(row);
  }

  it("opens a collection table view when a row is clicked and shows fields by default", () => {
    renderWorkspace();
    openCollection();

    const fieldsTable = screen.getByRole("region", { name: "Fields of collection collection-1" });
    expect(within(fieldsTable).getByText("body")).toBeTruthy();
    expect(within(fieldsTable).getByText("CMS_SERIALIZED_RICH_TEXT_DATA")).toBeTruthy();
  });

  it("switches to the items tab and lists context-bound bindings", () => {
    renderWorkspace();
    openCollection();
    fireEvent.click(screen.getByRole("tab", { name: /Items \(/ }));

    const itemsTable = screen.getByRole("region", { name: "Items of collection collection-1" });
    expect(within(itemsTable).getByText("<context-bound>")).toBeTruthy();
  });

  it("switches to the selectors tab and lists the responsive-set selector", () => {
    renderWorkspace();
    openCollection();
    fireEvent.click(screen.getByRole("tab", { name: /Selectors \(/ }));

    const selectorsTable = screen.getByRole("region", { name: "Selectors targeting collection collection-1" });
    expect(within(selectorsTable).getByText("Case Study Page")).toBeTruthy();
    expect(within(selectorsTable).getByText("slug EQUALS case-study")).toBeTruthy();
  });

  it("navigates from a field row to the field detail page and selects the consumer unit", () => {
    renderWorkspace();
    openCollection();
    const fieldsTable = screen.getByRole("region", { name: "Fields of collection collection-1" });
    const fieldRow = within(fieldsTable).getByText("body").closest("tr");
    if (!fieldRow) {
      throw new Error("Expected a row for body field");
    }
    fireEvent.click(fieldRow);

    const usagesTable = screen.getByRole("region", { name: "Usages of field body" });
    expect(within(usagesTable).getByText("Body")).toBeTruthy();
    expect(within(usagesTable).getByText("Mobile Body")).toBeTruthy();

    const bodyUsageRow = within(usagesTable).getByText("Body").closest("tr");
    if (!bodyUsageRow) {
      throw new Error("Expected a usage row for Body");
    }
    fireEvent.click(bodyUsageRow);
    expect(screen.getByLabelText("selected unit").textContent).toBe("0:3:Body");
  });

  it("navigates back to the list via the breadcrumb root", () => {
    renderWorkspace();
    openCollection();
    const breadcrumbRoot = screen.getAllByRole("button", { name: "Collections" })[0];
    if (!breadcrumbRoot) {
      throw new Error("Expected Collections breadcrumb root");
    }
    fireEvent.click(breadcrumbRoot);

    expect(screen.getByRole("region", { name: "Site CMS collections" })).toBeTruthy();
  });
});
