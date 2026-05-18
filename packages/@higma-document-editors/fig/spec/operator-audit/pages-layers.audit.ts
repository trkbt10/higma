/**
 * @file Pages + Layers panel operator audits.
 *
 * Locators are deliberately based on the same accessibility surface a
 * keyboard or screen-reader user has — roles, accessible names, and
 * visible text. No `data-testid`: if a control isn't reachable by ARIA
 * role + accessible name, it's not reachable by a human either, and
 * that's an operability bug rather than a test-harness problem.
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

async function openEmpty(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Document" }).click();
  await expect(page.getByRole("button", { name: /Rectangle \(R\)/ })).toBeVisible({ timeout: 5_000 });
}

async function createRectangle(page: Page) {
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
}

test.describe("operator audit — Pages panel", () => {
  test("each page row is reachable as a single listbox option", async ({ page }) => {
    await openEmpty(page);
    // The Pages list exposes role="listbox"; the active page is the
    // selected option. The previous markup put role="button" on the row
    // div, which collided with the inner InlineRenameInput's button
    // and broke `getByRole('button', { name })` lookups.
    const pages = page.getByRole("listbox", { name: "Pages" });
    await expect(pages.getByRole("option")).toHaveCount(1);
    await expect(pages.getByRole("option", { name: "Page 1" })).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: resolve(RESULTS_DIR, "pages-listbox.png"), fullPage: false });
  });

  test("Add page creates a new page and selects it", async ({ page }) => {
    await openEmpty(page);
    await page.getByRole("button", { name: "Add page" }).click();
    const pages = page.getByRole("listbox", { name: "Pages" });
    await expect(pages.getByRole("option")).toHaveCount(2);
    await expect(pages.getByRole("option", { name: "Page 2" })).toBeVisible();
    await page.screenshot({ path: resolve(RESULTS_DIR, "pages-add-second.png"), fullPage: false });
  });

  test("Double-clicking a page name opens the inline rename input", async ({ page }) => {
    await openEmpty(page);
    const display = page.getByRole("button", { name: "Rename page Page 1" });
    await expect(display).toBeVisible();
    await display.dblclick();
    const input = page.getByRole("textbox", { name: "Rename page Page 1" });
    await expect(input).toBeVisible({ timeout: 2_000 });
    await page.screenshot({ path: resolve(RESULTS_DIR, "pages-rename-active.png"), fullPage: false });
  });

  test("Right-clicking a page opens the row context menu", async ({ page }) => {
    await openEmpty(page);
    await page.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByRole("option", { name: "Page 2" })).toBeVisible();
    await page.getByRole("option", { name: "Page 2" }).click({ button: "right" });
    await expect(page.getByText("Rename", { exact: true })).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText("Move up", { exact: true })).toBeVisible();
    await expect(page.getByText("Delete", { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(RESULTS_DIR, "pages-context-menu.png"), fullPage: false });
  });
});

test.describe("operator audit — Layers panel", () => {
  test("New rectangle shows up as a treeitem and is selectable by name", async ({ page }) => {
    await openEmpty(page);
    await createRectangle(page);
    const rectangleRow = page.getByRole("treeitem", { name: /Rectangle/ });
    await expect(rectangleRow).toBeVisible();
    await rectangleRow.click();
    await page.getByRole("tab", { name: "Properties" }).click();
    await expect(page.getByLabel("X").first()).toBeVisible();
    await page.screenshot({ path: resolve(RESULTS_DIR, "layers-select-from-panel.png"), fullPage: false });
  });

  test("Hovering a layer row reveals the visibility toggle (aria-label = Hide layer)", async ({ page }) => {
    await openEmpty(page);
    await createRectangle(page);
    const rectangleRow = page.getByRole("treeitem", { name: /Rectangle/ });
    await rectangleRow.hover();
    // react-editor-ui's LayerActionButtons assigns aria-label="Hide layer"
    // when the layer is visible (clicking would hide it). Reaching this
    // button is the operator's only way to toggle visibility, so it must
    // be present after a hover.
    const visibilityToggle = page.getByRole("button", { name: /Hide layer|Show layer/ });
    await expect(visibilityToggle).toBeVisible({ timeout: 2_000 });
    await page.screenshot({ path: resolve(RESULTS_DIR, "layers-row-hovered.png"), fullPage: false });
  });

  test("Right-clicking a layer opens its context menu", async ({ page }) => {
    await openEmpty(page);
    await createRectangle(page);
    const rectangleRow = page.getByRole("treeitem", { name: /Rectangle/ });
    await rectangleRow.click({ button: "right" });
    await expect(page.getByText("Rename", { exact: true })).toBeVisible({ timeout: 2_000 });
    await page.screenshot({ path: resolve(RESULTS_DIR, "layers-context-menu.png"), fullPage: false });
  });
});
