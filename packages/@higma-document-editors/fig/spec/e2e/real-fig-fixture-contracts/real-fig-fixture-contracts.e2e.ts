/** @file Real .fig editor contracts for image/text/symbol renderer inputs. */

import { expect, test, type Page } from "@playwright/test";
import {
  figEditorWebGLSurfaces,
  figEditorNodeViewportPointByGuid,
  waitForFigEditorOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";
import type { FigEditorOperationSurfaceGlobalThis } from "../../../src/operation-surface/fig-editor-operation-surface-types";
import {
  discoverStandaloneFixtures,
  fixtureExists,
  resolveFixture,
} from "../shared/real-fig-fixture-discovery";

const fixtures = discoverStandaloneFixtures();

type ContractTargets = {
  readonly textGuid: string | undefined;
  readonly instanceGuid: string | undefined;
  readonly instanceSymbolGuid: string | undefined;
};

test.describe("real fig fixture editor contracts", () => {
  for (const [index, figFile] of fixtures.entries()) {
    test.skip(!fixtureExists(figFile), `fixture ${index + 1} not available`);

    for (const renderer of ["svg", "webgl"] as const) {
      test(`fixture ${index + 1} exposes image/text/symbol contracts in ${renderer}`, async ({ page }) => {
        test.setTimeout(90_000);
        const errors = collectPageErrors(page);
        const consoleErrors = collectConsoleErrors(page);

        await openFixture(page, figFile, renderer, errors, consoleErrors);

        const targets = await discoverContractTargets(page);

        if (targets.textGuid !== undefined) {
          await expectVisibleCanvasNode(page, targets.textGuid);
          await enterTextEdit(page, targets.textGuid);
          await expect.poll(() => isCanvasTextEditActive(page)).toBe(true);
          await page.keyboard.press("Escape");
          await expect.poll(() => isCanvasTextEditActive(page)).toBe(false);
        }
        if (renderer === "svg") {
          await expect.poll(() => renderedSvgImageCount(page), { timeout: 45_000 }).toBeGreaterThan(0);
        } else {
          await waitForWebGLReady(page, errors);
          await expectWebGLRenderedFixtureContent(page, index);
        }
        if (targets.instanceGuid !== undefined && targets.instanceSymbolGuid !== undefined) {
          await expect.poll(() => selectedInstanceSymbolResolution(page, targets.instanceGuid!)).toEqual({
            instanceType: "INSTANCE",
            effectiveSymbolGuidKey: targets.instanceSymbolGuid,
          });
        }
        expect(errors).toEqual([]);
        expect(consoleErrors).toEqual([]);
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
  figFile: string,
  renderer: "svg" | "webgl",
  pageErrors: readonly string[],
  consoleErrors: readonly string[],
): Promise<void> {
  const params = new URLSearchParams({
    renderer,
    panel: "property",
    figUrl: fileUrl(resolveFixture(figFile)),
  });
  await page.goto(`/?${params.toString()}`);
  try {
    await page.getByRole("region", { name: "Fig editor canvas", exact: true }).waitFor({ timeout: 45_000 });
    await waitForFigEditorOperationSurface(page);
  } catch (error) {
    const status = await readHarnessStatus(page);
    throw new Error(
      `Real fixture editor canvas did not appear for fixture ${figFile} ${renderer}: ${JSON.stringify(status)} pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`,
      { cause: error },
    );
  }
  if (renderer === "webgl") {
    await waitForWebGLReady(page, pageErrors);
    return;
  }
  await expect(page.locator("[role='group'][aria-label='Fig editor viewport surface'] svg[aria-hidden='true']").first()).toBeVisible({ timeout: 45_000 });
}

async function discoverContractTargets(page: Page): Promise<ContractTargets> {
  return page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("API not published");
    }
    const activePage = api.document.activePage();
    const descendants = api.document.descendants(activePage.guidKey);
    let textGuid: string | undefined;
    let instanceGuid: string | undefined;
    let instanceSymbolGuid: string | undefined;
    for (const node of descendants) {
      if (textGuid === undefined && node.type === "TEXT") {
        textGuid = node.guidKey;
      }
      if (instanceGuid === undefined && node.type === "INSTANCE") {
        const resolution = api.document.symbolResolution(node.guidKey);
        if (resolution.effectiveSymbolGuidKey !== undefined) {
          instanceGuid = node.guidKey;
          instanceSymbolGuid = resolution.effectiveSymbolGuidKey;
        }
      }
    }
    return { textGuid, instanceGuid, instanceSymbolGuid };
  });
}

type HarnessStatus = {
  readonly harnessState?: string;
  readonly fontPreload?: string;
  readonly canvasCount: number;
  readonly bodyText: string;
};

async function readHarnessStatus(page: Page): Promise<HarnessStatus> {
  return page.evaluate(() => {
    const harnessState = document.querySelector<HTMLElement>("[role='status'][aria-label='E2E harness loading']");
    const fontPreload = document.querySelector<HTMLElement>("[role='status'][aria-label='Browser font preload pending']");
    return {
      harnessState: harnessState?.getAttribute("aria-label") ?? undefined,
      fontPreload: fontPreload?.getAttribute("aria-label") ?? undefined,
      canvasCount: document.querySelectorAll("[role='region'][aria-label='Fig editor canvas']").length,
      bodyText: document.body.innerText.slice(0, 2_000),
    };
  });
}

function fileUrl(path: string): string {
  return `/@fs${path}`;
}

async function expectVisibleCanvasNode(page: Page, guid: string): Promise<void> {
  await expect.poll(() => page.evaluate((targetGuid) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const bounds = api.canvas.nodeBounds(targetGuid);
    return bounds.width > 0 && bounds.height > 0;
  }, guid)).toBe(true);
}

async function enterTextEdit(page: Page, guid: string): Promise<void> {
  const point = await nodeScreenPointByGuid(page, guid);
  await page.mouse.dblclick(point.x, point.y);
}

async function nodeScreenPointByGuid(page: Page, guid: string): Promise<{ readonly x: number; readonly y: number }> {
  const point = await figEditorNodeViewportPointByGuid(page, guid, { x: 0.5, y: 0.5 });
  const viewport = await page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.canvas.viewport();
  });
  const canvas = page.locator("svg[aria-label='Editor canvas viewport']");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("Editor canvas viewport has no visible bounding box");
  }
  return {
    x: box.x + viewport.rulerThickness + point.viewportX,
    y: box.y + viewport.rulerThickness + point.viewportY,
  };
}

async function selectedInstanceSymbolResolution(
  page: Page,
  guid: string | undefined,
): Promise<{ readonly instanceType: string; readonly effectiveSymbolGuidKey: string | undefined }> {
  return page.evaluate((targetGuid) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const node = api.document.requireNode(targetGuid!);
    const symbol = api.document.symbolResolution(targetGuid!);
    return {
      instanceType: node.type,
      effectiveSymbolGuidKey: symbol.effectiveSymbolGuidKey,
    };
  }, guid);
}

async function isCanvasTextEditActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("textarea")).some((textarea) => {
      return globalThis.getComputedStyle(textarea).opacity === "0";
    });
  });
}

async function renderedSvgImageCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>("[role='group'][aria-label='Fig editor viewport surface'] svg[aria-hidden='true']"));
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

type WebGLRenderedFixtureContent = {
  readonly loadingSurfaceCount: number;
  readonly readySurfaceCount: number;
  readonly renderRevisionTotal: number;
  readonly renderedNodeCount: number;
  readonly renderedTextCount: number;
  readonly textGlyphRunDrawCount: number;
  readonly imageDrawCount: number;
  readonly visibleTexturePreparationCount: number;
  readonly missingVisibleTexturePreparationCount: number;
};

async function expectWebGLRenderedFixtureContent(page: Page, fixtureIndex: number): Promise<void> {
  const label = `fixture ${fixtureIndex + 1}`;
  try {
    await expect.poll(async () => {
      const stats = await readWebGLRenderedFixtureContent(page);
      return webGLRenderedFixtureContentIsComplete(stats);
    }, {
      timeout: 45_000,
      message: `${label} WebGL must render image, text glyphs, and prepared visible textures`,
    }).toBe(true);
  } catch (error) {
    const stats = await readWebGLRenderedFixtureContent(page);
    throw new Error(`${label} WebGL content stats did not satisfy fixture contract: ${JSON.stringify(stats)}`, { cause: error });
  }
  const stats = await readWebGLRenderedFixtureContent(page);
  expect(stats.readySurfaceCount).toBeGreaterThan(0);
  expect(stats.renderRevisionTotal).toBeGreaterThan(0);
  expect(stats.renderedNodeCount).toBeGreaterThan(0);
  expect(stats.renderedTextCount).toBeGreaterThan(0);
  expect(stats.textGlyphRunDrawCount).toBeGreaterThan(0);
  expect(stats.imageDrawCount).toBeGreaterThan(0);
  expect(stats.visibleTexturePreparationCount).toBeGreaterThan(0);
  expect(stats.missingVisibleTexturePreparationCount).toBe(0);
}

function webGLRenderedFixtureContentIsComplete(stats: WebGLRenderedFixtureContent): boolean {
  return stats.loadingSurfaceCount === 0 &&
    stats.readySurfaceCount > 0 &&
    stats.renderRevisionTotal > 0 &&
    stats.renderedNodeCount > 0 &&
    stats.renderedTextCount > 0 &&
    stats.textGlyphRunDrawCount > 0 &&
    stats.imageDrawCount > 0 &&
    stats.visibleTexturePreparationCount > 0 &&
    stats.missingVisibleTexturePreparationCount === 0;
}

async function readWebGLRenderedFixtureContent(page: Page): Promise<WebGLRenderedFixtureContent> {
  const surfaces = await figEditorWebGLSurfaces(page);
  const metrics = surfaces.flatMap((surface) => {
    if (surface.metrics === undefined) {
      return [];
    }
    return [surface.metrics];
  });
  return {
    loadingSurfaceCount: surfaces.filter((surface) => !surface.ready).length,
    readySurfaceCount: surfaces.filter((surface) => surface.ready).length,
    renderRevisionTotal: surfaces.reduce((sum, surface) => sum + surface.renderRevision, 0),
    renderedNodeCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedNodeCount, 0),
    renderedTextCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedTextCount, 0),
    textGlyphRunDrawCount: metrics.reduce((sum, metric) => sum + metric.lastTextGlyphRunDrawCount, 0),
    imageDrawCount: metrics.reduce((sum, metric) => sum + metric.lastImageDrawCount, 0),
    visibleTexturePreparationCount: metrics.reduce((sum, metric) => sum + metric.lastVisibleTexturePreparationCount, 0),
    missingVisibleTexturePreparationCount: metrics.reduce((sum, metric) => sum + metric.lastMissingVisibleTexturePreparationCount, 0),
  };
}

async function allWebGLSurfacesReady(page: Page): Promise<boolean> {
  const surfaces = await figEditorWebGLSurfaces(page);
  return surfaces.length > 0 && surfaces.every((surface) => (
    surface.ready &&
    surface.canvasWidth > 0 &&
    surface.canvasHeight > 0
  ));
}

type WebGLStatus = {
  readonly harnessState?: string;
  readonly fontPreload?: string;
  readonly surfaces: Awaited<ReturnType<typeof figEditorWebGLSurfaces>>;
  readonly bodyText: string;
};

async function readWebGLStatus(page: Page): Promise<WebGLStatus> {
  const [surfaces, domStatus] = await Promise.all([
    figEditorWebGLSurfaces(page),
    page.evaluate(() => {
      const harnessState = document.querySelector<HTMLElement>("[role='status'][aria-label='E2E harness loading']");
      const fontPreload = document.querySelector<HTMLElement>("[role='status'][aria-label='Browser font preload pending']");
      return {
        harnessState: harnessState?.getAttribute("aria-label") ?? undefined,
        fontPreload: fontPreload?.getAttribute("aria-label") ?? undefined,
        bodyText: document.body.innerText.slice(0, 2_000),
      };
    }),
  ]);
  return { ...domStatus, surfaces };
}
