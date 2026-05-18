/**
 * @file Smoke-level audit — verifies that the dev fig-editor reaches the
 * "Properties tab selected, rectangle present and selected" state that
 * every other section audit depends on. If anything in this file fails,
 * the subsequent property-section audits cannot be trusted.
 */

import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, "results");

async function openEmptyDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Document" }).click();
  await expect(page.getByRole("button", { name: /Rectangle \(R\)/ })).toBeVisible({ timeout: 5_000 });
}

async function activatePropertiesTab(page: Page) {
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByText("Select a layer to edit its properties")).toBeVisible();
}

async function locateCanvasViewport(page: Page) {
  // The fig canvas is the largest SVG in the document — toolbar icons are
  // much smaller. We locate it by sorting all svgs by client area.
  const handle = await page.evaluateHandle(() => {
    const svgs = Array.from(document.querySelectorAll("svg"));
    let best: { el: SVGSVGElement; area: number } | null = null;
    for (const el of svgs) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (!best || area > best.area) {
        best = { el, area };
      }
    }
    return best?.el ?? null;
  });
  return handle.asElement();
}

async function createRectangleAndSelect(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Rectangle \(R\)/ }).click();
  const canvas = await locateCanvasViewport(page);
  if (!canvas) {
    throw new Error("canvas svg not found");
  }
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("canvas svg has no layout box");
  }
  const startX = box.x + box.width * 0.35;
  const startY = box.y + box.height * 0.35;
  const endX = startX + 220;
  const endY = startY + 160;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 40, startY + 30, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 16 });
  await page.mouse.up();

  // After creation Figma flips back to Select mode and clears the
  // creation-time selection — re-acquire the node by clicking its label
  // in the Layers panel so subsequent property-panel checks have a
  // stable selection target.
  await page.getByText("Rectangle", { exact: true }).first().click();
}

test.describe("operator audit — initial load", () => {
  test("reaches Properties tab + selected rectangle state", async ({ page }) => {
    await openEmptyDocument(page);
    await activatePropertiesTab(page);
    await createRectangleAndSelect(page);

    await expect(page.getByText("Select a layer to edit its properties")).toHaveCount(0, { timeout: 5_000 });
    // Property panel rendered: the Position section is always shown for a
    // selected node, so its X label is the most reliable smoke check.
    await expect(page.getByLabel("X").first()).toBeVisible();

    const png = await page.screenshot({ fullPage: false });
    writeFileSync(resolve(RESULTS_DIR, "initial-load.png"), png);
  });
});
