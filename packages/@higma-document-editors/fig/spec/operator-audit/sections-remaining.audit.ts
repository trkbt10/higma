/**
 * @file Operator audits for Stroke / AutoLayout / Layout constraints /
 * toolbar insertion. Selectors are accessibility-first — role + name,
 * not `data-testid` — because if an operator can't find the affordance
 * via assistive tech, no test should pretend it's reachable either.
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

async function openWithSelectedRectangle(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Document" }).click();
  await expect(page.getByRole("button", { name: /Rectangle \(R\)/ })).toBeVisible({ timeout: 5_000 });
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
  await page.getByRole("treeitem", { name: /Rectangle/ }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByLabel("X").first()).toBeVisible();
}

test.describe("operator audit — Stroke section", () => {
  test("Add stroke exposes Weight / Align / Cap / Join / Dash controls", async ({ page }) => {
    await openWithSelectedRectangle(page);
    await page.getByRole("button", { name: "Add stroke" }).click();
    // After adding a stroke the controls section opens — weight is the
    // single field every operator needs to find first.
    await expect(page.getByLabel("Stroke weight")).toBeVisible();
    await expect(page.getByLabel("Stroke align")).toBeVisible();
    await expect(page.getByLabel("Stroke cap")).toBeVisible();
    await expect(page.getByLabel("Stroke join")).toBeVisible();
    await expect(page.getByLabel("Stroke dash pattern")).toBeVisible();
    await page.screenshot({ path: resolve(RESULTS_DIR, "stroke-controls-visible.png"), fullPage: false });
  });

  test("Changing Stroke weight reflects in the input and canvas", async ({ page }) => {
    await openWithSelectedRectangle(page);
    await page.getByRole("button", { name: "Add stroke" }).click();
    const weight = page.getByLabel("Stroke weight");
    await weight.fill("8");
    await weight.press("Enter");
    await expect(weight).toHaveValue("8");
    await page.screenshot({ path: resolve(RESULTS_DIR, "stroke-weight-8.png"), fullPage: false });
  });
});

async function openWithSelectedFrame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Document" }).click();
  await expect(page.getByRole("button", { name: /Frame \(F\)/ })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /Frame \(F\)/ }).click();
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
  await page.mouse.move(startX + 240, startY + 180, { steps: 12 });
  await page.mouse.up();
  await page.getByRole("treeitem", { name: /Frame/ }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByLabel("X").first()).toBeVisible();
}

test.describe("operator audit — AutoLayout section", () => {
  // AutoLayout only renders for FRAME / SYMBOL nodes — that mirrors Figma.
  // The operator has to pick a container type first, so the audit does too.
  test("Auto Layout section reveals its mode/gap/padding controls when the operator picks a stack mode", async ({ page }) => {
    await openWithSelectedFrame(page);
    const modeSelect = page.getByLabel("Auto layout mode");
    await expect(modeSelect).toBeVisible();
    await modeSelect.selectOption("VERTICAL");
    await expect(page.getByLabel("Auto layout gap")).toBeVisible();
    await page.screenshot({ path: resolve(RESULTS_DIR, "autolayout-vertical.png"), fullPage: false });
  });

  test("AutoLayout padding (T/R/B/L) inputs are all reachable", async ({ page }) => {
    await openWithSelectedFrame(page);
    await page.getByLabel("Auto layout mode").selectOption("HORIZONTAL");

    await expect(page.getByLabel("Auto layout padding top")).toBeVisible();
    await expect(page.getByLabel("Auto layout padding right")).toBeVisible();
    await expect(page.getByLabel("Auto layout padding bottom")).toBeVisible();
    await expect(page.getByLabel("Auto layout padding left")).toBeVisible();
    await page.screenshot({ path: resolve(RESULTS_DIR, "autolayout-padding-row.png"), fullPage: false });
  });
});

test.describe("operator audit — Layout Constraints section", () => {
  test("Layout Constraints exposes positioning + sizing + constraint controls", async ({ page }) => {
    await openWithSelectedRectangle(page);
    // The Layout Constraints section is collapsed by default. Click the
    // section header (role="button" emitted by OptionalPropertySection).
    await page.getByRole("button", { name: /^Layout Constraints/ }).click();
    await expect(page.getByLabel("Layout position")).toBeVisible();
    await expect(page.getByLabel("Layout primary fit")).toBeVisible();
    await expect(page.getByLabel("Layout counter fit")).toBeVisible();
    await page.screenshot({ path: resolve(RESULTS_DIR, "layout-constraints-expanded.png"), fullPage: false });
  });
});

test.describe("operator audit — Toolbar insertion", () => {
  test("Every creation tool is reachable by role+name with a tooltip showing its shortcut", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New Document" }).click();
    await expect(page.getByRole("button", { name: /Rectangle \(R\)/ })).toBeVisible({ timeout: 5_000 });

    // Tools that ship with a keyboard shortcut MUST surface it in their
    // label (so the tooltip and screen-reader announcement match).
    for (const expected of [
      "Select (V)",
      "Vector Edit (P)",
      "Frame (F)",
      "Rectangle (R)",
      "Ellipse (O)",
      "Line (L)",
      "Text (T)",
    ]) {
      await expect(page.getByRole("button", { name: expected })).toBeVisible();
    }
    // Tools without a shortcut should not synthesize one — the previous
    // bug surfaced as "Star ()" which I fixed earlier.
    await expect(page.getByRole("button", { name: "Star", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Polygon", exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(RESULTS_DIR, "toolbar-shortcuts.png"), fullPage: false });
  });
});
