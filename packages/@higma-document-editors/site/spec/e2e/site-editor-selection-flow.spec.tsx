/**
 * @file Site editor end-to-end selection flow tests.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SiteEditor } from "../../src";
import { createSiteEditorTestDocument } from "../shared/site-editor-test-fixture";

function renderSiteEditor() {
  return render(<SiteEditor initialDocument={createSiteEditorTestDocument()} />);
}

function installCanvasRect(): void {
  const hitArea: Element = screen.getByRole("button", { name: "Canvas item Case Study Page" });
  if (!(hitArea instanceof SVGElement)) {
    throw new Error("Site editor e2e requires an SVG hit area");
  }
  const svg = hitArea?.ownerSVGElement;
  if (!svg) {
    throw new Error("Site editor e2e requires an SVG canvas");
  }
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }),
    configurable: true,
  });
}

function findCanvasHitArea(label: string): Element {
  return screen.getByRole("button", { name: `Canvas item ${label}` });
}

function readGeometryInputValue(label: string): string {
  const input = screen.getByLabelText(label);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Site editor e2e requires ${label} to be an input`);
  }
  return input.value;
}

function dragCanvasUnit(label: string, startX: number, startY: number, endX: number, endY: number): void {
  installCanvasRect();
  const hitArea = findCanvasHitArea(label);
  fireEvent.pointerDown(hitArea, { clientX: startX, clientY: startY, shiftKey: false, metaKey: false, ctrlKey: false });
  fireEvent.pointerMove(window, { clientX: endX, clientY: endY, shiftKey: false, metaKey: false, ctrlKey: false });
  fireEvent.pointerUp(window, { clientX: endX, clientY: endY, shiftKey: false, metaKey: false, ctrlKey: false });
}

describe("SiteEditor selection flow", () => {
  it("reflects multi-turn selection and graphical edits across structure, canvas, CMS, and properties", async () => {
    renderSiteEditor();
    installCanvasRect();

    expect(screen.getAllByText("Case Study Page").length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Site pages" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Site page/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Desktop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tablet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mobile" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /Articles/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("treeitem", { name: /Case Study Page/ }));
    expect(screen.getByText("MATCH_ALL")).toBeTruthy();
    expect(screen.getByText("EQUALS case-study")).toBeTruthy();
    fireEvent.click(screen.getByRole("treeitem", { name: /Articles/ }));
    expect(screen.queryByRole("button", { name: "Canvas item Breakpoint=Desktop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Canvas item Mobile Articles" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));

    expect(screen.getByRole("treeitem", { name: /Tablet Articles/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Canvas item Tablet Articles" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Canvas item Articles" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));

    expect(screen.getByRole("treeitem", { name: /Mobile Articles/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Canvas item Mobile Articles" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Canvas item Tablet Articles" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));

    fireEvent.click(screen.getByRole("treeitem", { name: /Body/ }));

    expect(screen.getByText("CMS_SERIALIZED_RICH_TEXT_DATA")).toBeTruthy();
    expect(screen.getAllByText("collection-1 / body").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("treeitem", { name: /Articles/ }));

    expect(screen.getAllByText("Articles").length).toBeGreaterThan(0);
    expect(screen.getByText("Filters")).toBeTruthy();
    const firstArticlesX = readGeometryInputValue("X");

    dragCanvasUnit("Articles", 200, 200, 260, 230);

    await waitFor(() => {
      expect(readGeometryInputValue("X")).not.toBe(firstArticlesX);
    });
    const movedArticlesX = readGeometryInputValue("X");

    fireEvent.click(screen.getByRole("treeitem", { name: /Body/ }));

    expect(screen.getByText("CMS_SERIALIZED_RICH_TEXT_DATA")).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /Body/ }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("treeitem", { name: /Articles/ }));

    expect(readGeometryInputValue("X")).toBe(movedArticlesX);

    fireEvent.change(screen.getByLabelText("X"), { target: { value: "132" } });

    await waitFor(() => {
      expect(readGeometryInputValue("X")).toBe("132");
    });

    dragCanvasUnit("Articles", 260, 230, 300, 260);

    await waitFor(() => {
      expect(readGeometryInputValue("X")).not.toBe(movedArticlesX);
    });
  });
});
