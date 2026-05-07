/**
 * @file Site editor canvas operation tests.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SiteEditorProvider, useSiteEditor } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import { SiteEditorCanvas } from "./SiteEditorCanvas";

function SelectedUnitProbe() {
  const { selectedUnit } = useSiteEditor();
  return <output aria-label="selected unit">{selectedUnit.id}:{selectedUnit.label}</output>;
}

function SelectedBoundsProbe() {
  const { selectedUnitBounds } = useSiteEditor();
  return <output aria-label="selected bounds">{Math.round(selectedUnitBounds.x)}:{Math.round(selectedUnitBounds.y)}</output>;
}

function RenderSurfaceProbe() {
  const { figRenderSurface } = useSiteEditor();
  return <output aria-label="render surface revision">{JSON.stringify(figRenderSurface.page)}</output>;
}

function renderCanvas() {
  const workspace = createSiteEditorWorkspace(createSiteEditorTestDocument());
  return render(
    <SiteEditorProvider workspace={workspace}>
      <SiteEditorCanvas />
      <SelectedUnitProbe />
      <SelectedBoundsProbe />
      <RenderSurfaceProbe />
    </SiteEditorProvider>,
  );
}

function installCanvasRect(): void {
  const hitArea: Element = screen.getByRole("button", { name: "Canvas item Case Study Page" });
  if (!(hitArea instanceof SVGElement)) {
    throw new Error("SiteEditorCanvas test requires an SVG hit area");
  }
  const svg = hitArea?.ownerSVGElement;
  if (!svg) {
    throw new Error("SiteEditorCanvas test requires an SVG canvas");
  }
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }),
    configurable: true,
  });
}

function findCanvasHitArea(label: string): Element {
  return screen.getByRole("button", { name: `Canvas item ${label}` });
}

describe("SiteEditorCanvas", () => {
  it("uses the shared fig page renderer as the site visual layer", () => {
    renderCanvas();

    expect(screen.getByRole("button", { name: "Canvas item Articles" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Canvas item Breakpoint=Desktop" })).toBeNull();
  });

  it("updates shared site selection when a graphical canvas unit is clicked", () => {
    renderCanvas();
    installCanvasRect();

    fireEvent.click(findCanvasHitArea("Articles"), { clientX: 200, clientY: 200 });

    expect(screen.getByLabelText("selected unit").textContent).toBe("0:2:Articles");
  });

  it("reflects a graphical move operation in selected unit bounds", async () => {
    renderCanvas();
    installCanvasRect();
    const hitArea = findCanvasHitArea("Articles");

    fireEvent.pointerDown(hitArea, { clientX: 200, clientY: 200, shiftKey: false, metaKey: false, ctrlKey: false });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 260, shiftKey: false, metaKey: false, ctrlKey: false });
    fireEvent.pointerUp(window, { clientX: 240, clientY: 260, shiftKey: false, metaKey: false, ctrlKey: false });

    await waitFor(() => {
      expect(screen.getByLabelText("selected unit").textContent).toBe("0:2:Articles");
      expect(screen.getByLabelText("selected bounds").textContent).not.toBe("48:96");
    });
  });

  it("reflects a graphical move operation in the rendered fig layer", async () => {
    renderCanvas();
    installCanvasRect();
    const before = screen.getByLabelText("render surface revision").textContent;
    const hitArea = findCanvasHitArea("Articles");

    fireEvent.pointerDown(hitArea, { clientX: 200, clientY: 200, shiftKey: false, metaKey: false, ctrlKey: false });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 260, shiftKey: false, metaKey: false, ctrlKey: false });
    fireEvent.pointerUp(window, { clientX: 240, clientY: 260, shiftKey: false, metaKey: false, ctrlKey: false });

    await waitFor(() => {
      expect(screen.getByLabelText("render surface revision").textContent).not.toBe(before);
    });
  });
});
