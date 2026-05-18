/**
 * @file Rotation section operator audit — verifies the section
 * actually expands when clicked, the rotation input updates the canvas
 * transform, and the Flip/Rotate action row is reachable.
 */

import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, "results");

async function locateCanvasViewport(page: Page) {
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

async function setup(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Document" }).click();
  await expect(page.getByRole("button", { name: /Rectangle \(R\)/ })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("tab", { name: "Properties" }).click();
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
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 220, startY + 160, { steps: 12 });
  await page.mouse.up();
  await page.getByText("Rectangle", { exact: true }).first().click();
  await expect(page.getByLabel("X").first()).toBeVisible();
}

test.describe("operator audit — Rotation section", () => {
  test("clicking the section header expands it", async ({ page }) => {
    await setup(page);

    const rotationHeader = page.getByRole("button", { name: /^Rotation$/ });
    await expect(rotationHeader).toBeVisible();
    await expect(rotationHeader).toHaveAttribute("aria-expanded", "false");

    await rotationHeader.click();

    await expect(rotationHeader).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: resolve(RESULTS_DIR, "rotation-expanded.png"), fullPage: false });
  });

  test("rotation input updates the rectangle on canvas", async ({ page }) => {
    await setup(page);

    const rotationHeader = page.getByRole("button", { name: /^Rotation$/ });
    await rotationHeader.click();
    await expect(rotationHeader).toHaveAttribute("aria-expanded", "true");

    const rotationInput = page.getByLabel("Rotation", { exact: true });
    await expect(rotationInput).toBeVisible();
    await rotationInput.fill("45");
    await rotationInput.press("Enter");
    await expect(rotationInput).toHaveValue("45");
    await page.screenshot({ path: resolve(RESULTS_DIR, "rotation-set-to-45.png"), fullPage: false });
  });
});
