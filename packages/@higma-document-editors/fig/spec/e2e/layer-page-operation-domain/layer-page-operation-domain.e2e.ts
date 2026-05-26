/** @file Browser coverage for layer/page panels consuming the operation domain. */

import { expect, test, type Page } from "@playwright/test";
import {
  beginSelectedFigNodeDragTransformViaOperationSurface,
  endSelectedFigNodeDragTransformViaOperationSurface,
  enterFigEditorTextEditByGuid,
  openEditorWithFigEditorOperationSurface,
  selectFigEditorNodeByGuid,
  setFigEditorCreationMode,
  translateFigNodeDuringSelectedFigNodeDragTransformViaOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";

const RECT = { pageX: 50, pageY: 310, width: 150, height: 80 };
const RECT_GUID_KEY = "1:3";
const VECTOR_GUID_KEY = "1:6";
const TEXT_GUID_KEY = "1:2";

test.describe("Fig editor layer and page panels operation domain", () => {
  test.beforeEach(async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=svg&panel=all");
  });

  test("selects and renames layers when select intent allows panel mutations", async ({ page }) => {
    await page.getByRole("treeitem", { name: /Rectangle/ }).click();
    await expect.poll(() => selectionBoxPageBounds(page)).toEqual(RECT);

    await page.getByRole("treeitem", { name: /Rectangle/ }).dblclick();
    const renameInput = page.getByLabel("Rename Rectangle");
    await expect(renameInput).toBeVisible();
    await renameInput.fill("Panel Rect");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("treeitem", { name: /Panel Rect/ })).toBeVisible();
  });

  test("disables page mutation and layer rename during text and vector edit intents", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, TEXT_GUID_KEY);
    await enterFigEditorTextEditByGuid(page, TEXT_GUID_KEY);

    await expect(page.getByRole("button", { name: "Add Page" })).toBeDisabled();
    await page.getByRole("treeitem", { name: /Rectangle/ }).dblclick();
    await expect(page.getByLabel("Rename Rectangle")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await selectFigEditorNodeByGuid(page, VECTOR_GUID_KEY);
    await setFigEditorCreationMode(page, "pen");

    await expect(page.getByRole("button", { name: "Add Page" })).toBeDisabled();
    await page.getByRole("treeitem", { name: /Rectangle/ }).dblclick();
    await expect(page.getByLabel("Rename Rectangle")).toHaveCount(0);
  });

  test("keeps page mutation disabled while a canvas transform is active", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await expect(page.getByRole("button", { name: "Add Page" })).toBeEnabled();

    await beginSelectedFigNodeDragTransformViaOperationSurface(page);
    await translateFigNodeDuringSelectedFigNodeDragTransformViaOperationSurface(page, RECT_GUID_KEY, { dx: 12, dy: 4 });

    await expect(page.getByRole("button", { name: "Add Page" })).toBeDisabled();

    await endSelectedFigNodeDragTransformViaOperationSurface(page);
    await expect(page.getByRole("button", { name: "Add Page" })).toBeEnabled();
  });
});

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
