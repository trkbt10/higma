/**
 * @file Operator audit — walk the property panel section-by-section and
 * snapshot each state so a human can confirm the affordances actually
 * look usable. Where automation can assert observable state (input
 * values, dispatched values reflected back into the field) it does.
 *
 * Each scenario:
 *   1. Names what the operator is trying to achieve (in a test title)
 *   2. Performs the actual sequence (no pretend interactions)
 *   3. Saves a screenshot to results/ named after the scenario
 *   4. Asserts on observable outcomes — not on inline styles
 */

import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, "results");

type Scenario = {
  readonly id: string;
  readonly run: (page: Page) => Promise<void>;
};

async function screenshot(page: Page, id: string) {
  await page.screenshot({ path: resolve(RESULTS_DIR, `${id}.png`), fullPage: false });
}

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

const SCENARIOS: readonly Scenario[] = [
  {
    id: "01-initial-rectangle-selected",
    run: async () => {
      // Only setup — capture default panel state.
    },
  },
  {
    id: "02-position-x-changed-to-100",
    run: async (page) => {
      const x = page.getByLabel("X").first();
      await x.fill("100");
      await x.press("Enter");
      await expect(x).toHaveValue("100");
    },
  },
  {
    id: "03-size-width-changed-to-300",
    run: async (page) => {
      const w = page.getByLabel("Width").first();
      await w.fill("300");
      await w.press("Enter");
      await expect(w).toHaveValue("300");
    },
  },
  {
    id: "04-rotation-section-expanded",
    run: async (page) => {
      await page.getByText("Rotation", { exact: true }).click();
      await expect(page.getByLabel(/^Rotation/).first()).toBeVisible();
    },
  },
  {
    id: "05-opacity-changed-to-50",
    run: async (page) => {
      const opacity = page.getByLabel("Opacity").first();
      await opacity.fill("50");
      await opacity.press("Enter");
      await expect(opacity).toHaveValue("50");
    },
  },
  {
    id: "06-corner-radius-set-to-16",
    run: async (page) => {
      // Corner Radius is `defaultExpanded` for editable nodes — the
      // R input is already visible from the smoke state. Drive it.
      const radius = page.getByLabel("Corner radius").first();
      await radius.fill("16");
      await radius.press("Enter");
      await expect(radius).toHaveValue("16");
    },
  },
  {
    id: "07-fill-changed-to-linear-gradient",
    run: async (page) => {
      const select = page.getByLabel("Fill paint type 1");
      await select.selectOption("GRADIENT_LINEAR");
      // After switching to linear, the gradient handle rows render —
      // confirm the Start/End handle labels exist (operator-visible).
      await expect(page.getByText("Start", { exact: true })).toBeVisible();
      await expect(page.getByText("End", { exact: true })).toBeVisible();
    },
  },
  {
    id: "08-effects-add-drop-shadow",
    run: async (page) => {
      await page.getByRole("button", { name: "Add effect" }).click();
      // First effect defaults to DROP_SHADOW per the kernel adapter.
      // After adding, the X / Y / R / S inputs become visible.
      await expect(page.getByLabel(/Drop Shadow offset x/i)).toBeVisible();
      await expect(page.getByLabel(/Drop Shadow opacity/i)).toBeVisible();
    },
  },
  {
    id: "09-effects-two-shadows-card-separator",
    run: async (page) => {
      const addEffect = page.getByRole("button", { name: "Add effect" });
      await addEffect.click();
      await expect(page.getByLabel(/Drop Shadow offset x/i)).toHaveCount(1);
      await addEffect.click();
      // Two cards rendered: a 1px separator between them is the
      // operator-visible signal that the cards are distinct.
      await expect(page.getByLabel(/Drop Shadow offset x/i)).toHaveCount(2);
    },
  },
  {
    id: "10-scroll-to-bottom-of-properties",
    run: async (page) => {
      // The Properties tab content is the dev/main.tsx-owned wrapper
      // with overflow-y:auto. Scrolling it must move the lowest
      // section into view — Layout Constraints sits below Effects.
      const tabpanel = page.getByRole("tabpanel").last();
      await tabpanel.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(page.getByText("Layout Constraints", { exact: true })).toBeVisible();
    },
  },
];

test.describe("operator audit — property panel walkthrough", () => {
  for (const scenario of SCENARIOS) {
    test(scenario.id, async ({ page }) => {
      await setup(page);
      await scenario.run(page);
      await screenshot(page, scenario.id);
    });
  }
});
