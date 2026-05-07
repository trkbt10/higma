/**
 * @file CMS workspace tests covering the sidebar, items table, item editor, and edit roundtrip.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import { SiteEditorProvider } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import { SiteCmsCollectionView } from "./SiteCmsCollectionView";
import { SiteCmsCollectionsPanel } from "./SiteCmsCollectionsPanel";
import { SiteCmsItemEditor } from "./SiteCmsItemEditor";
import { SiteCmsProvider, useSiteCms } from "./SiteCmsContext";

function FieldEditsProbe() {
  const { fieldEdits } = useSiteCms();
  return (
    <output aria-label="field edits">
      {fieldEdits.map((edit) => `${edit.collectionId}/${edit.itemId}/${edit.fieldId}=${edit.text}`).join("|")}
    </output>
  );
}

function renderCmsWorkspace() {
  const workspace = createSiteEditorWorkspace(createSiteEditorTestDocument());
  return render(
    <SiteEditorProvider workspace={workspace}>
      <SiteCmsProvider>
        <SiteCmsCollectionsPanel />
        <SiteCmsCollectionView />
        <SiteCmsItemEditor />
        <FieldEditsProbe />
      </SiteCmsProvider>
    </SiteEditorProvider>,
  );
}

function openContextItem() {
  const row = screen.getByRole("button", { name: "Open item Untitled item" });
  fireEvent.click(row);
}

describe("SiteCmsCollectionsPanel", () => {
  it("renders the Edit / Connect tabs and lists the document collections", () => {
    renderCmsWorkspace();
    const sidebar = screen.getByLabelText("Collections sidebar");
    expect(within(sidebar).getByRole("tab", { name: "Edit" })).toBeTruthy();
    expect(within(sidebar).getByRole("tab", { name: "Connect" })).toBeTruthy();
    expect(within(sidebar).getByRole("option", { name: "Case Study Page" })).toBeTruthy();
  });

  it("ignores Connect tab activation and disables the Add collection button", () => {
    renderCmsWorkspace();
    const connectTab = screen.getByRole("tab", { name: "Connect" });
    fireEvent.click(connectTab);
    expect(screen.getByRole("tab", { name: "Edit" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("button", { name: "Add collection" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("SiteCmsCollectionView", () => {
  it("auto-selects the first collection and renders its items table with field-typed columns", () => {
    renderCmsWorkspace();
    const view = screen.getByLabelText("Collection Case Study Page");
    const table = within(view).getByRole("table", { name: "Items of Case Study Page" });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim() ?? "");
    expect(headers.some((header) => header.includes("Rich Text 1"))).toBe(true);
  });

  it("disables New item, Edit fields and surfaces the back button", () => {
    renderCmsWorkspace();
    expect((screen.getByRole("button", { name: /New item/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Edit fields/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Back to collections" })).toBeTruthy();
  });
});

describe("SiteCmsItemEditor", () => {
  it("opens when an item row is clicked and exposes Close + nav controls", () => {
    renderCmsWorkspace();
    openContextItem();

    const editor = screen.getByLabelText("Editing Untitled item");
    expect(within(editor).getByRole("button", { name: "Close item editor" })).toBeTruthy();
    expect((within(editor).getByRole("button", { name: "Previous item" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(editor).getByRole("button", { name: "Next item" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes the item editor when Close is pressed", () => {
    renderCmsWorkspace();
    openContextItem();
    fireEvent.click(screen.getByRole("button", { name: "Close item editor" }));
    expect(screen.queryByLabelText(/Editing /)).toBeNull();
  });

  it("propagates edits typed in the rich-text editor through the context", () => {
    renderCmsWorkspace();
    openContextItem();

    const editor = screen.getByLabelText("Editing Untitled item");
    const textarea = within(editor).getByLabelText("Rich Text 1") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "New body content" } });

    expect(screen.getByLabelText("field edits").textContent).toBe("collection-1//body=New body content");
  });
});
