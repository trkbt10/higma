/**
 * @file Canvas-rendering audits — for property sections whose written
 * value MUST be reflected on the canvas. Setting cornerRadius=16 but
 * keeping the canvas rectangle sharp is the kind of bug the previous
 * "input value persisted" assertions silently allowed.
 *
 * We inspect the rendered SVG output directly: after editing the
 * property the corresponding shape attribute (rx, filter, etc.) must
 * change.
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

async function setupRectangle(page: Page) {
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

/**
 * Find the canvas-rendered shape's main path/rect element. The fig
 * renderer (SVG backend) draws shapes as <path>/<rect> elements with
 * a `data-fig-node-id` attribute on the path, OR — for plain
 * RECTANGLE — emits a stroked `<rect>` carrying width/height/x/y plus
 * `rx`/`ry` when corner radius is non-zero.
 */
async function readRenderedRectangleRx(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    // The visible canvas svg has the editor's render output AND the
    // overlay (selection chrome) layers. We want any rect/path inside
    // the page-coordinate group that has a fill attribute (not the
    // overlay's transparent hit-areas).
    const candidates = Array.from(document.querySelectorAll<SVGElement>(
      "svg [data-fig-node-id], svg path[fill]:not([fill='transparent']), svg rect[fill]:not([fill='transparent'])",
    ));
    for (const el of candidates) {
      const tag = el.tagName.toLowerCase();
      if (tag === "rect") {
        const rx = Number(el.getAttribute("rx") ?? "0");
        if (Number.isFinite(rx)) {
          return rx;
        }
      }
      if (tag === "path") {
        // Rounded-rect paths from the fig renderer use cubic/quadratic
        // segments at the corners. The radius isn't exposed
        // numerically — the test inspects path command count as a
        // proxy: a sharp rect path uses ~4 line segments (5 commands);
        // a rounded one uses many more (curves at corners).
        const d = el.getAttribute("d") ?? "";
        return d.length;
      }
    }
    return undefined;
  });
}

test.describe("operator audit — canvas reflects property changes", () => {
  test("Setting Corner Radius to 24 px changes the rendered rectangle path", async ({ page }) => {
    await setupRectangle(page);
    const before = await readRenderedRectangleRx(page);
    const radius = page.getByLabel("Corner radius").first();
    await radius.fill("24");
    await radius.press("Enter");
    await expect(radius).toHaveValue("24");
    await page.waitForTimeout(120);  // allow the renderer's animation frame to commit
    const after = await readRenderedRectangleRx(page);
    await page.screenshot({ path: resolve(RESULTS_DIR, "canvas-corner-radius-24.png"), fullPage: false });
    expect(after).not.toBe(before);
  });

  test("Adding a Drop Shadow injects a filter or shadow primitive into the rendered svg", async ({ page }) => {
    await setupRectangle(page);
    const before = await page.evaluate(() =>
      document.querySelectorAll("svg filter, svg feDropShadow, svg feGaussianBlur").length
    );
    await page.getByRole("button", { name: "Add effect" }).click();
    await expect(page.getByLabel(/Drop Shadow offset x/i)).toBeVisible();
    // Bump the offset / opacity to a value that should clearly render.
    await page.getByLabel(/Drop Shadow offset y/i).fill("16");
    await page.getByLabel(/Drop Shadow offset y/i).press("Enter");
    await page.getByLabel(/Drop Shadow opacity/i).fill("75");
    await page.getByLabel(/Drop Shadow opacity/i).press("Enter");
    await page.waitForTimeout(120);
    const after = await page.evaluate(() =>
      document.querySelectorAll("svg filter, svg feDropShadow, svg feGaussianBlur").length
    );
    await page.screenshot({ path: resolve(RESULTS_DIR, "canvas-drop-shadow.png"), fullPage: false });
    expect(after).toBeGreaterThan(before);
  });
});
