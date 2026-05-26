/** @file Browser coverage for Kiwi-backed component and section operations. */

import { expect, test, type Page } from "@playwright/test";
import {
  openEditorWithFigEditorOperationSurface,
  selectFigEditorNodeByGuid,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";

const COMPONENT_INSTANCE_GUID_KEY = "1:18";
const SECTION_GUID_KEY = "1:19";
const VARIANT_COMPONENT_GUID_KEY = "1:20";
const COMPONENT_SET_GUID_KEY = "30:1";
const RECT_GUID_KEY = "1:3";

test.describe("Fig editor Kiwi-backed component and section operations", () => {
  test.beforeEach(async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=svg&panel=property");
  });

  test("edits component text and instance-swap properties and reflects them in the rendered instance", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, COMPONENT_INSTANCE_GUID_KEY);

    await expect(page.getByLabel("Component property Label")).toHaveValue("Default label");
    const svgBeforeLabelEdit = await decodedSvgImage(page);
    await page.getByLabel("Component property Label").fill("Edited label");
    await expect.poll(() => decodedSvgImage(page)).not.toBe(svgBeforeLabelEdit);

    await page.getByLabel("Component property Icon").selectOption("21:2");
    await expect.poll(() => renderedGreenFillCount(page)).toBeGreaterThan(0);

    await page.getByLabel("Component property Show icon").uncheck();
    await expect.poll(() => renderedGreenFillCount(page)).toBe(0);

    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await selectFigEditorNodeByGuid(page, COMPONENT_INSTANCE_GUID_KEY);

    await expect(page.getByLabel("Component property Label")).toHaveValue("Edited label");
    await expect(page.getByLabel("Component property Icon")).toHaveValue("21:2");
    await expect(page.getByLabel("Component property Show icon")).not.toBeChecked();
  });

  test("edits instance self override opacity and reflects it in the rendered instance", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, COMPONENT_INSTANCE_GUID_KEY);
    const svgBefore = await decodedSvgImage(page);

    await page.getByLabel("Instance override opacity").fill("50");
    await expect(page.getByLabel("Instance override opacity")).toHaveValue("50");

    await expect.poll(() => decodedSvgImage(page)).not.toBe(svgBefore);
    await expect.poll(() => decodedSvgImage(page)).toContain('opacity="0.5"');

    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await selectFigEditorNodeByGuid(page, COMPONENT_INSTANCE_GUID_KEY);

    await expect(page.getByLabel("Instance override opacity")).toHaveValue("50");
  });

  test("edits descendant override opacity and reflects the override path in render", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, COMPONENT_INSTANCE_GUID_KEY);
    const svgBefore = await decodedSvgImage(page);

    await page.getByLabel("Override Button Label opacity").fill("40");
    await expect(page.getByLabel("Override Button Label opacity")).toHaveValue("40");

    await expect.poll(() => decodedSvgImage(page)).not.toBe(svgBefore);
    await expect.poll(() => decodedSvgImage(page)).toContain('opacity="0.4"');

    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await selectFigEditorNodeByGuid(page, COMPONENT_INSTANCE_GUID_KEY);

    await expect(page.getByLabel("Override Button Label opacity")).toHaveValue("40");
  });

  test("edits sectionContentsHidden through the property panel and persists across selection turns", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, SECTION_GUID_KEY);
    const toggle = page.getByRole("switch", { name: "Hide section contents" });

    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await selectFigEditorNodeByGuid(page, SECTION_GUID_KEY);

    await expect(page.getByRole("switch", { name: "Hide section contents" })).toHaveAttribute("aria-checked", "true");
  });

  test("edits component variant metadata and persists across selection turns", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, VARIANT_COMPONENT_GUID_KEY);

    await expect(page.getByLabel("Variant value 1")).toHaveValue("Default");
    await page.getByLabel("Variant value 1").fill("Pressed");

    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await selectFigEditorNodeByGuid(page, VARIANT_COMPONENT_GUID_KEY);

    await expect(page.getByLabel("Variant value 1")).toHaveValue("Pressed");
  });

  test("edits component set variant definitions and child values", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, COMPONENT_SET_GUID_KEY);

    await expect(page.getByLabel("Variant property name 1")).toHaveValue("State");
    await page.getByLabel("Variant property name 1").fill("Mode");
    await page.getByLabel("Variant Primary value 1").fill("Rest");

    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await selectFigEditorNodeByGuid(page, COMPONENT_SET_GUID_KEY);

    await expect(page.getByLabel("Variant property name 1")).toHaveValue("Mode");
    await expect(page.getByLabel("Variant Primary value 1")).toHaveValue("Rest");
  });
});

async function decodedSvgImage(page: Page): Promise<string> {
  await page.waitForSelector("svg[aria-hidden='true']", { timeout: 5_000 });
  return page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>("svg[aria-hidden='true']"));
    if (svgs.length === 0) {
      throw new Error("Rendered SVG trees were not found");
    }
    return svgs.map((svg) => svg.outerHTML).join("\n");
  });
}

async function renderedGreenFillCount(page: Page): Promise<number> {
  const svg = await decodedSvgImage(page);
  return Array.from(svg.matchAll(/fill="([^"]+)"/g)).filter((match) => {
    const fill = match[1]?.replace(/\s+/g, "").toLowerCase();
    return fill === "rgb(0,255,0)" || fill === "rgba(0,255,0,1)" || fill === "#00ff00";
  }).length;
}
