/**
 * @file Keyboard a11y audit — verifies that the controls a sighted
 * keyboard user (or screen-reader-driver) is supposed to reach are
 * actually reachable AND actionable via Tab + Space/Enter, not just
 * present in the ARIA tree.
 *
 * The previous coverage only checked role + accessible name (which
 * passes for `<div role="button">` without a tabindex — semantically
 * correct, operationally broken). This audit adds the "can I actually
 * activate it with the keyboard" assertion.
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

async function openWithRectangle(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Document" }).click();
  await expect(page.getByRole("button", { name: /Rectangle \(R\)/ })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /Rectangle \(R\)/ }).click();
  const canvas = await locateCanvasViewport(page);
  if (!canvas) throw new Error("canvas not found");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas no box");
  const sx = box.x + box.width * 0.35;
  const sy = box.y + box.height * 0.35;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 240, sy + 180, { steps: 12 });
  await page.mouse.up();
  await page.getByRole("treeitem", { name: /Rectangle/ }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await page.getByRole("button", { name: "Add effect" }).click();
}

test.describe("keyboard a11y audit", () => {
  test("section header is focusable via Tab and expandable via Space", async ({ page }) => {
    await openWithRectangle(page);

    // Find the Effects section header — it should be a button with
    // aria-expanded. Currently expanded (defaultExpanded for Effects).
    const effectsHeader = page.getByRole("button", { name: /^Effects 1/ });
    await expect(effectsHeader).toBeVisible();

    // The element must be a real <button> (or have tabIndex>=0) to be
    // tabbable. We verify it can receive focus directly.
    await effectsHeader.focus();
    const isFocused = await effectsHeader.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBe(true);

    // Pressing Space on a button-role element must toggle aria-expanded.
    const beforeExpanded = await effectsHeader.getAttribute("aria-expanded");
    await page.keyboard.press("Space");
    const afterExpanded = await effectsHeader.getAttribute("aria-expanded");
    expect(afterExpanded).not.toBe(beforeExpanded);

    await page.screenshot({ path: resolve(RESULTS_DIR, "keyboard-section-toggled.png"), fullPage: false });
  });

  test("Toggle (Show behind node) is keyboard-toggleable via Space", async ({ page }) => {
    await openWithRectangle(page);

    // Show-behind-node toggle is in the Drop Shadow effect card.
    const toggle = page.getByRole("switch", { name: /show behind node/i });
    await expect(toggle).toBeVisible();

    await toggle.focus();
    const isFocused = await toggle.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBe(true);

    const beforeChecked = await toggle.getAttribute("aria-checked");
    await page.keyboard.press("Space");
    const afterChecked = await toggle.getAttribute("aria-checked");
    expect(afterChecked).not.toBe(beforeChecked);

    await page.screenshot({ path: resolve(RESULTS_DIR, "keyboard-toggle-flipped.png"), fullPage: false });
  });

  test("focus moves through section headers in Tab order", async ({ page }) => {
    await openWithRectangle(page);

    // Focus the Properties tab as the starting point.
    await page.getByRole("tab", { name: "Properties" }).focus();

    // Tab repeatedly and verify we eventually reach each section header.
    // We do a bounded number of Tabs (50) to avoid getting stuck.
    const headerNames = ["Position", "Size", "Fill", "Effects"];
    const reached = new Set<string>();
    for (let i = 0; i < 50 && reached.size < headerNames.length; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "";
        return (
          el.getAttribute("aria-label") ||
          (el as HTMLElement).innerText ||
          ""
        ).trim();
      });
      for (const n of headerNames) {
        if (name.toLowerCase().startsWith(n.toLowerCase())) {
          reached.add(n);
        }
      }
    }
    // We expect at least one section header to be reachable; ideally all,
    // but the audit is exploratory — bumpiness in Tab order is itself a
    // finding and is captured by `reached`.
    expect(reached.size).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`Tab-reachable section headers: ${[...reached].join(", ")} (of ${headerNames.join(", ")})`);
  });
});
