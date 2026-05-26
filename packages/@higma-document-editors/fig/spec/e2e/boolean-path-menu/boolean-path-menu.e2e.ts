/** @file Browser coverage for fig boolean path operations from the context menu. */

import { expect, test } from "@playwright/test";
import {
  clickNode,
  contextMenuNode,
  ELLIPSE,
  openEditor,
  RECT,
  renderedSvgMarkup,
  selectionBoxPageBounds,
  shiftClickNode,
} from "../shared/fig-editor-harness";

test.describe("Fig editor boolean path context menu", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page, "?renderer=svg");
  });

  test("creates a live union node and renders the evaluated boolean path", async ({ page }) => {
    await clickNode(page, RECT);
    await shiftClickNode(page, ELLIPSE);
    await contextMenuNode(page, ELLIPSE);
    await expect(page.getByRole("menuitem", { name: "Union Selection" })).toHaveCSS("opacity", "1");
    await page.getByRole("menuitem", { name: "Union Selection" }).click();
    await expect.poll(() => renderedSvgMarkup(page)).toContain("<path");
    await expect.poll(() => renderedSvgMarkup(page)).not.toContain(">Rectangle<");
    await expect.poll(() => selectionBoxPageBounds(page)).toMatchObject({
      pageX: 50,
      pageY: 310,
      width: 200,
      height: 100,
    });
  });
});
