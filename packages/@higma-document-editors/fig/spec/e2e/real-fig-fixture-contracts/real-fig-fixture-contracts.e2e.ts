/** @file Real .fig editor contracts for image/text/symbol renderer inputs. */

import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../../../dev/public/fig-fixtures.tmp");

type FixtureContract = {
  readonly name: string;
  readonly figFile: string;
  readonly activePageGuid: string;
  readonly imageGuid: string;
  readonly textGuid: string;
  readonly textEditHitGuid?: string;
  readonly instanceGuid?: string;
  readonly expectedSymbolGuid?: string;
};

const FIXTURES: readonly FixtureContract[] = [
  {
    name: "E-Commerce Plant Shop Website",
    figFile: "e-commerce-plant-shop.fig",
    activePageGuid: "0:1",
    imageGuid: "9:57",
    textGuid: "9:37",
  },
  {
    name: "Youtube Mobile App UIKit",
    figFile: "youtube-mobile-app-uikit.fig",
    activePageGuid: "7:101",
    imageGuid: "13:137",
    textGuid: "17:365",
    instanceGuid: "18:899",
    expectedSymbolGuid: "7:61",
  },
  {
    name: "E Learning Site",
    figFile: "e-learning-site.fig",
    activePageGuid: "0:1",
    imageGuid: "10:387",
    textGuid: "78:293",
    textEditHitGuid: "77:247",
    instanceGuid: "10:1466",
    expectedSymbolGuid: "8:964",
  },
];

test.describe("real fig fixture editor contracts", () => {
  for (const fixture of FIXTURES) {
    test.skip(!existsSync(resolve(FIXTURE_DIR, fixture.figFile)), `requires ${fixture.figFile}`);

    for (const renderer of ["svg", "webgl"] as const) {
      test(`${fixture.name} exposes image/text/symbol contracts in ${renderer}`, async ({ page }) => {
        test.setTimeout(90_000);
        const errors = collectPageErrors(page);
        const consoleErrors = collectConsoleErrors(page);

        await openFixture(page, fixture, renderer, errors, consoleErrors);

        await expect(canvasNode(page, fixture.imageGuid)).toBeVisible();
        const textNode = canvasNode(page, fixture.textGuid);
        await expect(textNode).toBeVisible();
        await enterTextEdit(page, canvasNode(page, fixture.textEditHitGuid ?? fixture.textGuid));
        await expect.poll(() => isCanvasTextEditActive(page)).toBe(true);
        await page.keyboard.press("Escape");
        await expect.poll(() => isCanvasTextEditActive(page)).toBe(false);
        if (renderer === "svg") {
          await expect.poll(() => renderedSvgImageCount(page), { timeout: 45_000 }).toBeGreaterThan(0);
        } else {
          await waitForWebGLReady(page, errors);
        }
        if (fixture.instanceGuid !== undefined && fixture.expectedSymbolGuid !== undefined) {
          const diagnostics = page.locator(`[data-e2e-selected-guid="${fixture.instanceGuid}"]`);
          await expect(diagnostics).toHaveAttribute("data-e2e-selected-type", "INSTANCE");
          await expect(diagnostics).toHaveAttribute("data-e2e-effective-symbol-guid", fixture.expectedSymbolGuid);
        }
        expect(errors).toEqual([]);
      });
    }
  }
});

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

async function openFixture(
  page: Page,
  fixture: FixtureContract,
  renderer: "svg" | "webgl",
  pageErrors: readonly string[],
  consoleErrors: readonly string[],
): Promise<void> {
  const params = new URLSearchParams({
    renderer,
    panel: "property",
    figUrl: fileUrl(resolve(FIXTURE_DIR, fixture.figFile)),
    activePageGuid: fixture.activePageGuid,
  });
  if (fixture.instanceGuid !== undefined) {
    params.set("selectGuid", fixture.instanceGuid);
  }
  await page.goto(`/?${params.toString()}`);
  try {
    await page.waitForSelector("[data-fig-editor-canvas]", { timeout: 45_000 });
  } catch (error) {
    const status = await readHarnessStatus(page);
    throw new Error(
      `Real fixture editor canvas did not appear for ${fixture.name} ${renderer}: ${JSON.stringify(status)} pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`,
      { cause: error },
    );
  }
  if (renderer === "webgl") {
    await waitForWebGLReady(page, pageErrors);
    return;
  }
  await expect(page.locator("svg[data-fig-family-page-renderer]").first()).toBeVisible({ timeout: 45_000 });
}

type HarnessStatus = {
  readonly harnessState?: string;
  readonly fontPreload?: string;
  readonly canvasCount: number;
  readonly webglLayerCount: number;
  readonly bodyText: string;
};

async function readHarnessStatus(page: Page): Promise<HarnessStatus> {
  return page.evaluate(() => {
    const harnessState = document.querySelector<HTMLElement>("[data-e2e-harness-state]");
    const fontPreload = document.querySelector<HTMLElement>("[data-browser-font-preload]");
    return {
      harnessState: harnessState?.getAttribute("data-e2e-harness-state") ?? undefined,
      fontPreload: fontPreload?.getAttribute("data-browser-font-preload") ?? undefined,
      canvasCount: document.querySelectorAll("[data-fig-editor-canvas]").length,
      webglLayerCount: document.querySelectorAll("[data-fig-editor-webgl-layer]").length,
      bodyText: document.body.innerText.slice(0, 2_000),
    };
  });
}

function fileUrl(path: string): string {
  return `/@fs${path}`;
}

function canvasNode(page: Page, guid: string) {
  return page.getByRole("button", { name: `Canvas node ${guid}` });
}

async function enterTextEdit(page: Page, node: ReturnType<typeof canvasNode>): Promise<void> {
  const box = await node.boundingBox();
  if (box === null) {
    throw new Error("Real fixture text edit target has no bounding box");
  }
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

async function isCanvasTextEditActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("textarea")).some((textarea) => {
      return window.getComputedStyle(textarea).opacity === "0";
    });
  });
}

async function renderedSvgImageCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>("svg[data-fig-family-page-renderer]"));
    if (svgs.length === 0) {
      throw new Error("Rendered SVG trees were not found");
    }
    return svgs.flatMap((svg) => Array.from(svg.querySelectorAll<SVGImageElement>("image"))).filter((image) => {
      const href = image.getAttribute("href") ?? image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      return href?.startsWith("data:image/") === true;
    }).length;
  });
}

async function waitForWebGLReady(page: Page, pageErrors: readonly string[]): Promise<void> {
  try {
    await expect.poll(() => allWebGLSurfacesReady(page), { timeout: 45_000 }).toBe(true);
  } catch (error) {
    const status = await readWebGLStatus(page);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`WebGL renderer did not reach ready state: ${JSON.stringify(status)} pageErrors=${JSON.stringify(pageErrors)}\n${message}`, { cause: error });
  }
}

async function allWebGLSurfacesReady(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>("[data-fig-editor-webgl-layer] canvas"));
    if (canvases.length === 0) {
      return false;
    }
    return canvases.every((canvas) => {
      if (canvas.getAttribute("data-webgl-ready") !== "true") {
        return false;
      }
      return canvas.offsetWidth > 0 && canvas.offsetHeight > 0;
    });
  });
}

type WebGLStatus = {
  readonly canvasCount: number;
  readonly webglLayerCount: number;
  readonly pageRendererSvgCount: number;
  readonly harnessState?: string;
  readonly fontPreload?: string;
  readonly canvasReady?: string;
  readonly loadingPhase?: string;
  readonly completedSteps?: string;
  readonly totalSteps?: string;
  readonly prepareCount?: string;
  readonly renderCount?: string;
  readonly lastPrepareMs?: string;
  readonly lastRenderMs?: string;
  readonly bodyText: string;
};

async function readWebGLStatus(page: Page): Promise<WebGLStatus> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-webgl-ready]");
    const loading = document.querySelector<HTMLElement>("[data-webgl-loading='true']");
    const progress = loading?.querySelector<HTMLProgressElement>("progress");
    const harnessState = document.querySelector<HTMLElement>("[data-e2e-harness-state]");
    const fontPreload = document.querySelector<HTMLElement>("[data-browser-font-preload]");
    return {
      canvasCount: document.querySelectorAll("canvas").length,
      webglLayerCount: document.querySelectorAll("[data-fig-editor-webgl-layer]").length,
      pageRendererSvgCount: document.querySelectorAll("svg[data-fig-family-page-renderer]").length,
      harnessState: harnessState?.getAttribute("data-e2e-harness-state") ?? undefined,
      fontPreload: fontPreload?.getAttribute("data-browser-font-preload") ?? undefined,
      canvasReady: canvas?.getAttribute("data-webgl-ready") ?? undefined,
      loadingPhase: loading?.getAttribute("data-webgl-loading-phase") ?? undefined,
      completedSteps: progress?.getAttribute("aria-valuenow") ?? undefined,
      totalSteps: progress?.getAttribute("aria-valuemax") ?? undefined,
      prepareCount: canvas?.getAttribute("data-webgl-prepare-count") ?? undefined,
      renderCount: canvas?.getAttribute("data-webgl-render-count") ?? undefined,
      lastPrepareMs: canvas?.getAttribute("data-webgl-last-prepare-ms") ?? undefined,
      lastRenderMs: canvas?.getAttribute("data-webgl-last-render-ms") ?? undefined,
      bodyText: document.body.innerText.slice(0, 2_000),
    };
  });
}
