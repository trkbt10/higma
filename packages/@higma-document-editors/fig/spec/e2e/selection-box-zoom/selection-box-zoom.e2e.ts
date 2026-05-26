/** @file E2E tests for selection chrome under zoom. */

import { expect, test, type Page } from "@playwright/test";
import {
  clickNode,
  openEditor,
  RECT,
} from "../shared/fig-editor-harness";

test.describe("Fig editor selection box zoom invariance", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page, "?renderer=svg");
  });

  test("keeps selection stroke screen-sized while zooming", async ({ page }) => {
    await clickNode(page, RECT);
    const before = await selectionChromeMetrics(page);

    await zoomAtCanvasCenter(page, 5);
    const after = await selectionChromeMetrics(page);

    expect(before.strokeWidth).toBe("2");
    expect(after.strokeWidth).toBe("2");
    expect(after.selectionRectWidth).toBeGreaterThan(before.selectionRectWidth * 1.2);
  });
});

async function selectionChromeMetrics(page: Page): Promise<{
  readonly strokeWidth: string | null;
  readonly selectionRectWidth: number;
}> {
  return page.evaluate(() => {
    const selectionRect = Array.from(document.querySelectorAll<SVGRectElement>("rect[vector-effect='non-scaling-stroke']")).find((rect) => {
      return rect.getAttribute("fill") === "none" && rect.getAttribute("stroke") !== "transparent";
    }) ?? null;
    if (!selectionRect) {
      throw new Error("Selection rect was not found");
    }
    const selectionBounds = selectionRect.getBoundingClientRect();
    return {
      strokeWidth: selectionRect.getAttribute("stroke-width"),
      selectionRectWidth: selectionBounds.width,
    };
  });
}

async function zoomAtCanvasCenter(page: Page, steps: number): Promise<void> {
  const point = await page.evaluate(() => {
    const canvas = document.querySelector<SVGSVGElement>("svg[aria-label='Editor canvas viewport']");
    if (canvas === null) {
      throw new Error("Editor canvas viewport SVG was not found");
    }
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.move(point.x, point.y);
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(modifier);
    await page.mouse.wheel(0, -240);
    await page.keyboard.up(modifier);
  }
}
