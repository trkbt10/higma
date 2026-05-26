/** @file Browser coverage for property panel operation-domain gating and edits. */

import { expect, test, type Page } from "@playwright/test";
import {
  addFigEditorNodeToSelectionByGuid,
  beginSelectedFigNodeDragTransformViaOperationSurface,
  endSelectedFigNodeDragTransformViaOperationSurface,
  enterFigEditorTextEditByGuid,
  openEditorWithFigEditorOperationSurface,
  selectFigEditorNodeByGuid,
  setFigEditorCreationMode,
  translateFigNodeDuringSelectedFigNodeDragTransformViaOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";

const RECT_GUID_KEY = "1:3";
const VECTOR_GUID_KEY = "1:6";
const TEXT_GUID_KEY = "1:2";

test.describe("Fig editor property panel operation domain", () => {
  test.beforeEach(async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=svg&panel=property");
  });

  test("edits transform fields when select intent allows property mutation", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    const xInput = page.getByRole("spinbutton", { name: "X", exact: true });

    await expect(xInput).toBeEnabled();
    await xInput.fill("70");
    await expect.poll(() => selectionBoxPageBounds(page)).toMatchObject({ pageX: 70, pageY: 310, width: 150, height: 80 });
  });

  test("applies fill color edits to every selected node, not only the primary node", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await addFigEditorNodeToSelectionByGuid(page, VECTOR_GUID_KEY);

    await page.getByLabel("Fill color 1").fill("#ff0000");
    await page.keyboard.press("Tab");

    await expect.poll(() => countRenderedRedFills(page)).toBeGreaterThanOrEqual(2);
  });

  test("disables inspector property mutation during text and vector edit intents", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, TEXT_GUID_KEY);
    await enterFigEditorTextEditByGuid(page, TEXT_GUID_KEY);
    await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toBeDisabled();

    await page.keyboard.press("Escape");
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toBeEnabled();

    await setFigEditorCreationMode(page, "pen");
    await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toBeDisabled();
  });

  test("disables inspector property mutation while a canvas transform is active", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    const xInput = page.getByRole("spinbutton", { name: "X", exact: true });
    await expect(xInput).toBeEnabled();

    await beginSelectedFigNodeDragTransformViaOperationSurface(page);
    await translateFigNodeDuringSelectedFigNodeDragTransformViaOperationSurface(page, RECT_GUID_KEY, { dx: 14, dy: 6 });

    await expect(xInput).toBeDisabled();

    await endSelectedFigNodeDragTransformViaOperationSurface(page);
    await expect(xInput).toBeEnabled();
  });
});

async function countRenderedRedFills(page: Page): Promise<number> {
  return page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>("svg[aria-hidden='true']"));
    if (svgs.length === 0) {
      throw new Error("SVG renderer tree was not found");
    }
    const svg = svgs.map((candidate) => candidate.outerHTML).join("\n");
    const fills = Array.from(svg.matchAll(/fill="([^"]+)"/g)).map((match) => match[1]?.replace(/\s+/g, "").toLowerCase());
    return fills.filter((fill) => fill === "rgb(255,0,0)" || fill === "rgba(255,0,0,1)" || fill === "#ff0000").length;
  });
}

async function selectionBoxPageBounds(page: Page): Promise<{
  readonly pageX: number;
  readonly pageY: number;
  readonly width: number;
  readonly height: number;
}> {
  return page.evaluate(() => {
    const rect = Array.from(document.querySelectorAll<SVGRectElement>("rect[vector-effect='non-scaling-stroke']")).find((candidate) => {
      return candidate.getAttribute("fill") === "none" && candidate.getAttribute("stroke") !== "transparent";
    }) ?? null;
    if (!rect) {
      throw new Error("Selection box was not found");
    }
    return {
      pageX: Number(rect.getAttribute("x")),
      pageY: Number(rect.getAttribute("y")),
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height")),
    };
  });
}
