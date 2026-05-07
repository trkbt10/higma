/**
 * @file CMS workspace tests covering CRUD on collections / fields / items.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import { SiteEditorProvider } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import { SiteCmsCollectionView } from "./SiteCmsCollectionView";
import { SiteCmsCollectionsPanel } from "./SiteCmsCollectionsPanel";
import { SiteCmsProvider, useSiteCms } from "./SiteCmsContext";

function FieldEditsProbe() {
  const { fieldEdits } = useSiteCms();
  return (
    <output aria-label="field edits">
      {fieldEdits.map((edit) => `${edit.collectionId}/${edit.itemId}/${edit.fieldId}=${edit.text}`).join("|")}
    </output>
  );
}

function CollectionsProbe() {
  const { collections } = useSiteCms();
  return (
    <output aria-label="collections">
      {collections.map((collection) => `${collection.id}:items=${collection.items.length}:fields=${collection.fields.length}`).join("|")}
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
        <FieldEditsProbe />
        <CollectionsProbe />
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
    expect(within(sidebar).getByRole("option", { name: /Case Study Page/ })).toBeTruthy();
  });

  it("auto-creates a Collection N draft when the + button is clicked, no prompt", () => {
    renderCmsWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Add collection" }));

    const sidebar = screen.getByLabelText("Collections sidebar");
    expect(within(sidebar).getByText("Collection 2")).toBeTruthy();

    const probe = screen.getByLabelText("collections");
    expect(probe.textContent).toContain("draft-collection-1");
  });

  it("deletes a draft collection via the trash button", () => {
    renderCmsWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Add collection" }));

    const sidebar = screen.getByLabelText("Collections sidebar");
    fireEvent.click(within(sidebar).getByRole("button", { name: "Delete collection Collection 2" }));

    expect(within(sidebar).queryByText("Collection 2")).toBeNull();
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

  it("adds a draft item via the New item header button and opens the editor on it", () => {
    renderCmsWorkspace();
    const view = screen.getByLabelText("Collection Case Study Page");
    const headerNewItem = within(view).getAllByRole("button", { name: /New item/ })[0];
    if (!headerNewItem) {
      throw new Error("Expected the header New item button");
    }
    fireEvent.click(headerNewItem);

    expect(screen.getByLabelText(/Editing draft-item-1/)).toBeTruthy();
    const probe = screen.getByLabelText("collections");
    expect(probe.textContent).toContain("collection-1:items=2");
  });

  it("opens the fields editor and adds an auto-named draft field of the picked kind", () => {
    renderCmsWorkspace();
    const view = screen.getByLabelText("Collection Case Study Page");
    fireEvent.click(within(view).getByRole("button", { name: /Edit fields/ }));
    fireEvent.click(within(view).getByRole("button", { name: /Add field/ }));

    const probe = screen.getByLabelText("collections");
    expect(probe.textContent).toContain("collection-1:items=1:fields=2");
  });

  it("deletes a draft field via the trash button", () => {
    renderCmsWorkspace();
    const view = screen.getByLabelText("Collection Case Study Page");
    fireEvent.click(within(view).getByRole("button", { name: /Edit fields/ }));
    fireEvent.click(within(view).getByRole("button", { name: /Add field/ }));

    fireEvent.click(within(view).getByRole("button", { name: /Delete field Text 2/ }));

    const probe = screen.getByLabelText("collections");
    expect(probe.textContent).toContain("collection-1:items=1:fields=1");
  });

  it("deletes a draft item row via the trash button", () => {
    renderCmsWorkspace();
    const view = screen.getByLabelText("Collection Case Study Page");
    const headerNewItem = within(view).getAllByRole("button", { name: /New item/ })[0];
    if (!headerNewItem) {
      throw new Error("Expected the header New item button");
    }
    fireEvent.click(headerNewItem);
    // Close the editor so we can click the row trash icon without overlay interference
    fireEvent.click(screen.getByRole("button", { name: "Close item editor" }));

    fireEvent.click(within(view).getByRole("button", { name: /Delete item draft-item-1/ }));

    const probe = screen.getByLabelText("collections");
    expect(probe.textContent).toContain("collection-1:items=1");
  });
});

describe("SiteCmsItemEditor overlay", () => {
  it("opens when an item row is clicked and exposes Close + nav controls", () => {
    renderCmsWorkspace();
    openContextItem();

    const editor = screen.getByLabelText("Editing Untitled item");
    expect(within(editor).getByRole("button", { name: "Close item editor" })).toBeTruthy();
    expect((within(editor).getByRole("button", { name: "Previous item" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(editor).getByRole("button", { name: "Next item" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is not mounted when no item is selected", () => {
    renderCmsWorkspace();
    expect(screen.queryByLabelText(/Editing /)).toBeNull();
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
