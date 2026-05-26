/** @file Text editing lifecycle through human mouse and keyboard operations. */

import { expect, test, type Page } from "@playwright/test";
import {
  HELLO_TEXT,
  RECT,
  STYLED_TEXT,
  canvasTextareaSelection,
  clickNode,
  countCanvasVisibleNodes,
  doubleClickNode,
  focusCanvasTextarea,
  getCanvasTextareaValue,
  isCanvasTextEditActive,
  openEditor,
} from "../shared/fig-editor-harness";

test.describe("fig editor text edit lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test("double-click on text node enters text edit mode on the canvas", async ({ page }) => {
    expect(await isCanvasTextEditActive(page)).toBe(false);

    await doubleClickNode(page, HELLO_TEXT);

    await expect.poll(() => isCanvasTextEditActive(page)).toBe(true);
    await expect.poll(() => getCanvasTextareaValue(page)).toBe("Hello World");
  });

  test("typing into the canvas textarea updates the text", async ({ page }) => {
    await doubleClickNode(page, HELLO_TEXT);
    await expect.poll(() => getCanvasTextareaValue(page)).toBe("Hello World");

    await focusCanvasTextarea(page);
    await page.keyboard.type("!!!");

    await expect.poll(() => getCanvasTextareaValue(page)).toBe("Hello World!!!");
  });

  test("double-click on styled text enters text edit using the document style registry", async ({ page }) => {
    await doubleClickNode(page, STYLED_TEXT);

    await expect.poll(() => isCanvasTextEditActive(page)).toBe(true);
    await expect.poll(() => getCanvasTextareaValue(page)).toBe("Styled text");
  });

  test("Backspace in canvas textarea deletes characters, not the node", async ({ page }) => {
    await doubleClickNode(page, HELLO_TEXT);
    await focusCanvasTextarea(page);
    await expect.poll(() => getCanvasTextareaValue(page)).toBe("Hello World");
    await placeCanvasTextareaCaret(page, "Hello World".length);

    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Backspace");
    }

    await expect.poll(() => getCanvasTextareaValue(page)).toBe("Hello ");
    await expect.poll(() => isCanvasTextEditActive(page)).toBe(true);
  });

  test("Cmd+A in canvas textarea selects all text", async ({ page }) => {
    await doubleClickNode(page, HELLO_TEXT);
    await focusCanvasTextarea(page);

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+a`);

    await expect.poll(() => canvasTextareaSelection(page)).toEqual({ start: 0, end: "Hello World".length });
  });

  test("Escape exits text editing mode", async ({ page }) => {
    await doubleClickNode(page, HELLO_TEXT);
    await expect.poll(() => isCanvasTextEditActive(page)).toBe(true);

    await focusCanvasTextarea(page);
    await page.keyboard.press("Escape");

    await expect.poll(() => isCanvasTextEditActive(page)).toBe(false);
  });

  test("Delete key outside text edit deletes the selected node", async ({ page }) => {
    await clickNode(page, RECT);
    await expect.poll(() => isCanvasTextEditActive(page)).toBe(false);
    const visibleNodesBefore = await countCanvasVisibleNodes(page);

    await page.keyboard.press("Delete");

    await expect.poll(() => countCanvasVisibleNodes(page)).toBeLessThan(visibleNodesBefore);
  });

  test("double-click on rectangle does not enter text edit", async ({ page }) => {
    await doubleClickNode(page, RECT);

    await expect.poll(() => isCanvasTextEditActive(page)).toBe(false);
  });
});

async function placeCanvasTextareaCaret(page: Page, offset: number): Promise<void> {
  await page.evaluate((selectionOffset) => {
    const hidden = Array.from(document.querySelectorAll("textarea")).find((textarea) => {
      return globalThis.getComputedStyle(textarea).opacity === "0";
    });
    if (hidden === undefined) {
      throw new Error("Canvas text edit textarea was not found");
    }
    hidden.focus();
    hidden.setSelectionRange(selectionOffset, selectionOffset);
  }, offset);
}
