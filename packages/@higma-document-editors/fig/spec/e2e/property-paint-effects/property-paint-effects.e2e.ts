/** @file Browser coverage for paint/effect property operations. */

import { expect, test, type Page } from "@playwright/test";
import { readPng } from "@higma-codecs/png";
import {
  figEditorNodeViewportPointByGuid,
  openEditorWithFigEditorOperationSurface,
  selectFigEditorNodeByGuid,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";

const RECT_GUID_KEY = "1:3";
const VECTOR_GUID_KEY = "1:6";

test.describe("Fig editor paint and effect property operations", () => {
  test.beforeEach(async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=svg&panel=property");
  });

  test("edits fill gradient stops through the property panel and persists across selection turns", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    const svgBefore = await decodedSvgImage(page);

    await page.getByLabel("Fill paint type 1").selectOption("GRADIENT_LINEAR");
    await page.getByLabel("Fill gradient stop 1 color 1").fill("#00ff00");
    await page.getByLabel("Fill gradient stop 2 color 1").fill("#0000ff");
    await page.getByLabel("Fill gradient stop 1 opacity 1").fill("50");
    await page.getByLabel("Fill gradient stop 2 position 1").fill("75");
    await page.getByLabel("Fill gradient handle 1 x 1").fill("10");
    await page.getByLabel("Fill gradient handle 1 y 1").fill("20");
    await page.getByLabel("Fill gradient add stop 1").click();
    await page.getByLabel("Fill gradient stop 2 color 1").fill("#ffffff");
    await page.getByLabel("Fill gradient remove stop 2 1").click();

    await expect.poll(() => gradientStopColors(decodedSvgImage(page))).toEqual(["#00ff00", "#0000ff"]);
    await expect.poll(() => gradientStopOpacities(decodedSvgImage(page))).toContain("0.5");

    await page.getByLabel("Fill gradient stop 1 color 1").fill("#ff0000");
    await expect.poll(() => gradientStopColors(decodedSvgImage(page))).toEqual(["#ff0000", "#0000ff"]);
    await expect.poll(() => decodedSvgImage(page)).not.toBe(svgBefore);

    await selectFigEditorNodeByGuid(page, VECTOR_GUID_KEY);
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);

    await expect(page.getByLabel("Fill paint type 1")).toHaveValue("GRADIENT_LINEAR");
    await expect(page.getByLabel("Fill gradient stop 1 color 1")).toHaveValue("#ff0000");
    await expect(page.getByLabel("Fill gradient stop 1 opacity 1")).toHaveValue("50");
    await expect(page.getByLabel("Fill gradient stop 2 color 1")).toHaveValue("#0000ff");
    await expect(page.getByLabel("Fill gradient stop 2 position 1")).toHaveValue("75");
    await expect(page.getByLabel("Fill gradient handle 1 x 1")).toHaveValue("10");
    await expect(page.getByLabel("Fill gradient handle 1 y 1")).toHaveValue("20");
  });

  test("edits stroke gradient and effect fields through labeled controls over multiple turns", async ({ page }) => {
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);

    await page.getByRole("button", { name: "Add stroke" }).click();
    await page.getByLabel("Stroke weight").fill("6");
    await page.getByLabel("Stroke align").selectOption("OUTSIDE");
    await page.getByLabel("Stroke cap").selectOption("ROUND");
    await page.getByLabel("Stroke join").selectOption("BEVEL");
    await page.getByLabel("Stroke dash pattern").fill("4 2");
    await page.getByLabel("Stroke paint type 1").selectOption("GRADIENT_LINEAR");
    await page.getByLabel("Stroke gradient stop 1 color 1").fill("#ffff00");
    await page.getByLabel("Stroke gradient stop 2 color 1").fill("#000000");
    await page.getByLabel("Stroke gradient stop 2 opacity 1").fill("70");
    await page.getByLabel("Stroke gradient stop 1 position 1").fill("10");
    await page.getByLabel("Stroke gradient handle 2 x 1").fill("90");

    await expect.poll(() => decodedSvgImage(page)).toContain("stroke=\"url(#");
    await expect.poll(() => gradientStopColors(decodedSvgImage(page))).toEqual(["#ffff00", "#000000"]);

    await page.getByRole("button", { name: "Add effect" }).click();
    const svgBeforeEffectEdit = await decodedSvgImage(page);
    await page.getByLabel("Effect visible 1").click();
    await page.getByLabel("Effect visible 1").click();
    await page.getByLabel("Drop Shadow blend mode").selectOption("MULTIPLY");
    await page.getByLabel("Drop Shadow radius").fill("14");
    await page.getByLabel("Drop Shadow offset x").fill("7");
    await page.getByLabel("Drop Shadow offset y").fill("9");
    await page.getByLabel("Drop Shadow spread").fill("3");
    await page.getByLabel("Drop Shadow color").fill("#ff00ff");
    await page.getByLabel("Drop Shadow opacity").fill("60");
    await page.getByLabel("Drop Shadow show behind node").click();

    await expect.poll(() => decodedSvgImage(page)).not.toBe(svgBeforeEffectEdit);

    await selectFigEditorNodeByGuid(page, VECTOR_GUID_KEY);
    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);

    await expect(page.getByLabel("Stroke weight")).toHaveValue("6");
    await expect(page.getByLabel("Stroke align")).toHaveValue("OUTSIDE");
    await expect(page.getByLabel("Stroke cap")).toHaveValue("ROUND");
    await expect(page.getByLabel("Stroke join")).toHaveValue("BEVEL");
    await expect(page.getByLabel("Stroke dash pattern")).toHaveValue("4 2");
    await expect(page.getByLabel("Stroke paint type 1")).toHaveValue("GRADIENT_LINEAR");
    await expect(page.getByLabel("Stroke gradient stop 1 color 1")).toHaveValue("#ffff00");
    await expect(page.getByLabel("Stroke gradient stop 1 position 1")).toHaveValue("10");
    await expect(page.getByLabel("Stroke gradient stop 2 color 1")).toHaveValue("#000000");
    await expect(page.getByLabel("Stroke gradient stop 2 opacity 1")).toHaveValue("70");
    await expect(page.getByLabel("Stroke gradient handle 2 x 1")).toHaveValue("90");
    await expect(page.getByLabel("Drop Shadow blend mode")).toHaveValue("MULTIPLY");
    await expect(page.getByLabel("Drop Shadow radius")).toHaveValue("14");
    await expect(page.getByLabel("Drop Shadow offset x")).toHaveValue("7");
    await expect(page.getByLabel("Drop Shadow offset y")).toHaveValue("9");
    await expect(page.getByLabel("Drop Shadow spread")).toHaveValue("3");
    await expect(page.getByLabel("Drop Shadow color")).toHaveValue("#ff00ff");
    await expect(page.getByLabel("Drop Shadow opacity")).toHaveValue("60");
    await expect(page.getByLabel("Drop Shadow show behind node")).toHaveAttribute("aria-checked", "false");
  });

  test("renders stroke gradient decoration through the WebGL renderer instead of a flat stroke color", async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=webgl&panel=property");

    await selectFigEditorNodeByGuid(page, RECT_GUID_KEY);
    await page.getByRole("button", { name: "Add stroke" }).click();
    await page.getByLabel("Stroke weight").fill("18");
    await page.getByLabel("Stroke align").selectOption("CENTER");
    await page.getByLabel("Stroke paint type 1").selectOption("GRADIENT_LINEAR");
    await page.getByLabel("Stroke gradient stop 1 color 1").fill("#ff0000");
    await page.getByLabel("Stroke gradient stop 2 color 1").fill("#0000ff");

    await expect.poll(() => webglStrokeGradientSample(page, RECT_GUID_KEY)).toMatchObject({
      leftDominant: "red",
      rightDominant: "blue",
    });
  });
});

async function decodedSvgImage(page: Page): Promise<string> {
  await page.waitForSelector("svg[aria-hidden='true']", { timeout: 10_000 });
  return page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>("svg[aria-hidden='true']"));
    if (svgs.length === 0) {
      throw new Error("Rendered SVG trees were not found");
    }
    return svgs.map((svg) => svg.outerHTML).join("\n");
  });
}

async function gradientStopColors(svgPromise: Promise<string>): Promise<readonly string[]> {
  const svg = await svgPromise;
  const gradient = svg.match(/<(linearGradient|radialGradient)\b[\s\S]*?<\/\1>/)?.[0] ?? "";
  return Array.from(gradient.matchAll(/stop-color="([^"]+)"/g)).map((match) => match[1] ?? "");
}

async function gradientStopOpacities(svgPromise: Promise<string>): Promise<readonly string[]> {
  const svg = await svgPromise;
  const gradient = svg.match(/<(linearGradient|radialGradient)\b[\s\S]*?<\/\1>/)?.[0] ?? "";
  return Array.from(gradient.matchAll(/stop-opacity="([^"]+)"/g)).map((match) => match[1] ?? "");
}

async function webglStrokeGradientSample(
  page: Page,
  guidKey: string,
): Promise<{
  readonly leftDominant: "red" | "blue" | "other";
  readonly rightDominant: "red" | "blue" | "other";
}> {
  const left = await screenshotPixelAtNodeViewportRatio(page, guidKey, { x: 0.12, y: 0.03 });
  const right = await screenshotPixelAtNodeViewportRatio(page, guidKey, { x: 0.88, y: 0.03 });
  return {
    leftDominant: dominantPixelColor(left),
    rightDominant: dominantPixelColor(right),
  };
}

async function screenshotPixelAtNodeViewportRatio(
  page: Page,
  guidKey: string,
  ratio: { readonly x: number; readonly y: number },
): Promise<readonly number[]> {
  const point = await figEditorNodeViewportPointByGuid(page, guidKey, ratio);
  const canvasBox = await page.locator("canvas").boundingBox();
  if (canvasBox === null) {
    throw new Error("WebGL canvas bounding box was not available");
  }
  const png = readPng(await page.screenshot({
    clip: {
      x: Math.floor(canvasBox.x + point.viewportX),
      y: Math.floor(canvasBox.y + point.viewportY),
      width: 1,
      height: 1,
    },
  }));
  return Array.from(png.data);
}

function dominantPixelColor(pixel: readonly number[]): "red" | "blue" | "other" {
  const [red, green, blue, alpha] = pixel;
  if ((alpha ?? 0) < 180) {
    return "other";
  }
  if ((red ?? 0) > (blue ?? 0) + 35 && (red ?? 0) > (green ?? 0) + 35) {
    return "red";
  }
  if ((blue ?? 0) > (red ?? 0) + 35 && (blue ?? 0) > (green ?? 0) + 35) {
    return "blue";
  }
  return "other";
}
