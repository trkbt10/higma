/** @file Real .fig editor regressions for external SymbolResolver sources. */

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createPngImage, readPng, writePng } from "@higma-codecs/png";
import pixelmatch from "pixelmatch";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  figEditorWebGLSurfaces,
  figEditorNodeViewportPointByGuid,
  waitForFigEditorOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";
import type { FigEditorOperationSurfaceGlobalThis } from "../../../src/operation-surface/fig-editor-operation-surface-types";
import {
  hasMacOsSfProLocalFontFiles,
  installMacOsSfProLocalFontAccess,
} from "../shared/macos-sf-pro-local-font-access";
import { discoverSourceBackedPair, resolveFixture, FIXTURE_DIR, loadExportArtifactEnv } from "../shared/real-fig-fixture-discovery";

const SOURCE_BACKED_PAIR = discoverSourceBackedPair();
const EXPORT_ARTIFACT_ENV = loadExportArtifactEnv();
const EXPORT_SVG_PATH = EXPORT_ARTIFACT_ENV.framedExportSvgPath !== undefined
  ? resolve(FIXTURE_DIR, EXPORT_ARTIFACT_ENV.framedExportSvgPath)
  : undefined;
const DEEP_BLUE_INSTANCE_GUID = "2316:9650";
const DEEP_BLUE_SYMBOL_GUID = "2316:20463";
const DARK_FRAMED_GUID = "2316:9644";
const MAX_DARK_FRAMED_EXPORT_DIFF_RATIO = 0;
const REAL_FIG_VISUAL_TEST_TIMEOUT_MS = 120_000;

test.describe("real fig symbol resolution in the editor", () => {
  test.skip(
    SOURCE_BACKED_PAIR === undefined ||
      !existsSync(resolveFixture(SOURCE_BACKED_PAIR.primary)) ||
      !existsSync(resolveFixture(SOURCE_BACKED_PAIR.source)),
    "requires a source-backed fixture pair under dev/public/fig-fixtures.tmp",
  );
  test.skip(
    !hasMacOsSfProLocalFontFiles(),
    "requires macOS SFNS.ttf and SFNSRounded.ttf for source-backed reference export visual comparison",
  );

  for (const renderer of ["svg", "webgl"] as const) {
    test(`resolves instance through source document in ${renderer}`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
      });

      await openFixtureTemplate(page, renderer);

      await expect.poll(() => selectedSymbolResolution(page, DEEP_BLUE_INSTANCE_GUID)).toMatchObject({
        instanceType: "INSTANCE",
        effectiveSymbolGuidKey: DEEP_BLUE_SYMBOL_GUID,
        hasResolvedDescendants: true,
      });
      await expect(page.getByText(`INSTANCE · ${DEEP_BLUE_INSTANCE_GUID}`)).toBeVisible();

      expect(errors).toEqual([]);
    });
  }

  test("keeps the real-file layer tree collapsed and expands descendants on demand", async ({ page }) => {
    test.setTimeout(60_000);

    await openFixtureTemplate(page, "svg", { panel: "all", selectGuid: undefined });

    const layers = page.getByRole("tree", { name: "Layers" });
    const expandButton = layers.getByRole("button", { name: /^Expand / }).first();
    await expect(expandButton).toBeVisible({ timeout: 10_000 });
    const treeitemCountBefore = await layers.getByRole("treeitem").count();
    await expandButton.click();
    await expect.poll(() => layers.getByRole("treeitem").count(), { timeout: 10_000 }).toBeGreaterThan(treeitemCountBefore);
  });

  test("renders source-backed framed pixels in the editor SVG viewport", async ({ page }) => {
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openFixtureTemplate(page, "svg", { panel: "none", selectGuid: DARK_FRAMED_GUID });

    const sourceBackedRatio = await selectedFrameDarkPixelRatio(page, DARK_FRAMED_GUID);
    expect(sourceBackedRatio).toBeGreaterThan(0.75);
  });

  test("keeps source-backed frame renderer pixels near the reference export", async ({ page }, testInfo) => {
    test.skip(EXPORT_SVG_PATH === undefined || !existsSync(EXPORT_SVG_PATH), "requires a framed export SVG artifact");
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openFixtureFrame(page, "svg", DARK_FRAMED_GUID);

    const frame = page.getByRole("region", {
      name: `E2E frame renderer ${DARK_FRAMED_GUID}`,
      exact: true,
    }).locator("svg[aria-hidden='true']");
    const actualSvg = await frame.evaluate((element) => element.outerHTML);
    const expectedSvg = readFileSync(EXPORT_SVG_PATH!, "utf8");
    const actual = readPng(await frame.screenshot({ scale: "css" }));
    const expected = await svgFixtureToBrowserScreenshotPng(page, {
      path: EXPORT_SVG_PATH!,
      width: actual.width,
      height: actual.height,
    });
    const diff = comparePngs(actual, expected);

    await attachVisualDiffIfNeeded(testInfo, {
      actual,
      expected,
      diff,
      maxRatio: MAX_DARK_FRAMED_EXPORT_DIFF_RATIO,
      actualSvg,
      expectedSvg,
    });
    expect(diff.ratio).toBeLessThanOrEqual(MAX_DARK_FRAMED_EXPORT_DIFF_RATIO);
  });

  test("keeps source-backed editor pixels near the reference export", async ({ page }, testInfo) => {
    test.skip(EXPORT_SVG_PATH === undefined || !existsSync(EXPORT_SVG_PATH), "requires a framed export SVG artifact");
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openFixtureTemplate(page, "svg", { panel: "none", selectGuid: undefined });

    const editorSurface = page.getByRole("group", {
      name: "Fig editor viewport surface",
      exact: true,
    });
    const editorSvg = editorSurface.locator("svg[aria-hidden='true']");
    const actualSvg = await editorSvg.evaluate((element) => element.outerHTML);
    const expectedSvg = readFileSync(EXPORT_SVG_PATH!, "utf8");
    const nodeScreenBox = await nodeScreenBoxByGuid(page, DARK_FRAMED_GUID);
    const viewportSurfaceBox = await requireLocatorBox(editorSurface, "editor viewport surface");
    const clip = roundedClipForBox(nodeScreenBox, `editor surface ${DARK_FRAMED_GUID}`);
    const editorPng = readPng(await page.screenshot({ clip }));
    const exportPng = await svgFixtureToProjectedEditorScreenshotPng(page, {
      path: EXPORT_SVG_PATH!,
      surfaceBox: nodeScreenBox,
      clip,
    });
    const projectedActualPng = await svgMarkupToProjectedEditorScreenshotPng(page, {
      svg: actualSvg,
      surfaceBox: viewportSurfaceBox,
      clip,
    });
    const projectedActualToExportDiff = comparePngs(projectedActualPng, exportPng);
    const editorToProjectedActualDiff = comparePngs(editorPng, projectedActualPng);
    const diff = comparePngs(editorPng, exportPng);

    await attachVisualDiffIfNeeded(testInfo, {
      actual: editorPng,
      expected: exportPng,
      diff,
      maxRatio: MAX_DARK_FRAMED_EXPORT_DIFF_RATIO,
      actualSvg,
      expectedSvg,
      diagnostics: {
        viewportSurfaceBox,
        nodeScreenBox,
        clip,
        projectedActualToExportDiff: {
          diffPixels: projectedActualToExportDiff.diffPixels,
          totalPixels: projectedActualToExportDiff.totalPixels,
          ratio: projectedActualToExportDiff.ratio,
        },
        editorToProjectedActualDiff: {
          diffPixels: editorToProjectedActualDiff.diffPixels,
          totalPixels: editorToProjectedActualDiff.totalPixels,
          ratio: editorToProjectedActualDiff.ratio,
        },
      },
    });
    expect(diff.ratio).toBeLessThanOrEqual(MAX_DARK_FRAMED_EXPORT_DIFF_RATIO);
  });

  test("keeps source-backed editor WebGL pixels near the reference export", async ({ page }, testInfo) => {
    test.skip(EXPORT_SVG_PATH === undefined || !existsSync(EXPORT_SVG_PATH), "requires a framed export SVG artifact");
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openFixtureTemplate(page, "webgl", { panel: "none", selectGuid: undefined });

    const nodeScreenBox = await nodeScreenBoxByGuid(page, DARK_FRAMED_GUID);
    const surfaceBox = nodeScreenBox;
    const clip = roundedClipForBox(surfaceBox, `editor WebGL surface ${DARK_FRAMED_GUID}`);
    const editorPng = readPng(await page.screenshot({ clip }));
    const exportPng = await svgFixtureToProjectedEditorScreenshotPng(page, {
      path: EXPORT_SVG_PATH!,
      surfaceBox,
      clip,
    });
    const diff = comparePngs(editorPng, exportPng);

    await attachVisualDiffIfNeeded(testInfo, {
      actual: editorPng,
      expected: exportPng,
      diff,
      maxRatio: MAX_DARK_FRAMED_EXPORT_DIFF_RATIO,
      expectedSvg: readFileSync(EXPORT_SVG_PATH!, "utf8"),
      diagnostics: {
        surfaceBox,
        nodeScreenBox,
        clip,
        webglStats: await readWebGLVisualStats(page),
      },
    });
    expect(diff.ratio).toBeLessThanOrEqual(MAX_DARK_FRAMED_EXPORT_DIFF_RATIO);
  });

  test("exposes the primary-only external source gap as a visual regression", async ({ page }) => {
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openFixtureTemplate(page, "svg", {
      panel: "none",
      selectGuid: DARK_FRAMED_GUID,
      source: "primary-only",
    });

    const primaryOnlyRatio = await selectedFrameDarkPixelRatio(page, DARK_FRAMED_GUID);
    expect(primaryOnlyRatio).toBeLessThan(0.25);
  });
});

type OpenFixtureTemplateOptions = {
  readonly panel?: "property" | "all" | "none";
  readonly selectGuid?: string;
  readonly source?: "with-source" | "primary-only";
};

async function openFixtureTemplate(
  page: Page,
  renderer: "svg" | "webgl",
  options: OpenFixtureTemplateOptions = {},
): Promise<void> {
  await installMacOsSfProLocalFontAccess(page);
  const panel = options.panel ?? "property";
  const selectGuid = selectedGuidOption(options);
  const params = new URLSearchParams({
    renderer,
    panel,
    fontMode: "browser-real",
    figUrl: fileUrl(resolveFixture(SOURCE_BACKED_PAIR!.primary)),
  });
  if ((options.source ?? "with-source") === "with-source") {
    params.set("sourceUrl", fileUrl(resolveFixture(SOURCE_BACKED_PAIR!.source)));
  }
  if (selectGuid !== undefined) {
    params.set("selectGuid", selectGuid);
  }
  await page.goto(`/?${params.toString()}`);
  await page.getByRole("region", { name: "Fig editor canvas", exact: true }).waitFor({ timeout: 45_000 });
  await waitForFigEditorOperationSurface(page);
  if (renderer === "webgl") {
    await expect.poll(() => allWebGLSurfacesSettled(page), { timeout: 45_000 }).toBe(true);
    return;
  }
  await expect(page.locator("[role='group'][aria-label='Fig editor viewport surface'] svg[aria-hidden='true']").first()).toBeVisible({ timeout: 45_000 });
}

async function openFixtureFrame(page: Page, renderer: "svg" | "webgl", frameGuid: string): Promise<void> {
  await installMacOsSfProLocalFontAccess(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  const params = new URLSearchParams({
    view: "frame",
    renderer,
    fontMode: "browser-real",
    figUrl: fileUrl(resolveFixture(SOURCE_BACKED_PAIR!.primary)),
    sourceUrl: fileUrl(resolveFixture(SOURCE_BACKED_PAIR!.source)),
    frameGuid,
  });
  await page.goto(`/?${params.toString()}`);
  try {
    await page.getByRole("region", { name: `E2E frame renderer ${frameGuid}`, exact: true }).waitFor({ timeout: 45_000 });
  } catch (error) {
    const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    throw new Error(
      `E2E frame view did not render. body=${bodyText} pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`,
      { cause: error },
    );
  }
  if (renderer === "webgl") {
    await expect.poll(() => allWebGLSurfacesSettled(page), { timeout: 45_000 }).toBe(true);
    return;
  }
  try {
    await page.waitForFunction(() => {
      const frame = document.querySelector("[role='region'][aria-label^='E2E frame renderer ']");
      const box = frame?.getBoundingClientRect();
      return box !== undefined && box.width > 0 && box.height > 0;
    }, null, { timeout: 45_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const frame = document.querySelector("[role='region'][aria-label^='E2E frame renderer ']");
      const box = frame?.getBoundingClientRect();
      return {
        bodyText: document.body.innerText,
        frameHtml: frame?.outerHTML.slice(0, 1_000) ?? "",
        frameBox: box === undefined ? null : { width: box.width, height: box.height },
      };
    }).catch((reason: unknown) => ({
      bodyText: "",
      frameHtml: "",
      frameBox: null,
      evalError: reason instanceof Error ? reason.message : String(reason),
    }));
    throw new Error(
      `E2E frame view stayed zero-sized. diagnostics=${JSON.stringify(diagnostics)} pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`,
      { cause: error },
    );
  }
}

async function allWebGLSurfacesSettled(page: Page): Promise<boolean> {
  const surfaces = await figEditorWebGLSurfaces(page);
  return surfaces.length > 0 && surfaces.every((surface) => (
    surface.ready &&
    surface.metrics !== undefined &&
    surface.metrics.lastRenderFrameReason === "settled" &&
    surface.canvasWidth > 0 &&
    surface.canvasHeight > 0
  ));
}

async function readWebGLVisualStats(page: Page): Promise<Record<string, boolean | number | string>> {
  const surface = (await figEditorWebGLSurfaces(page))[0];
  if (surface === undefined) {
    throw new Error("readWebGLVisualStats requires a registered WebGL surface");
  }
  const metrics = surface.metrics;
  if (metrics === undefined) {
    throw new Error(`readWebGLVisualStats requires renderer metrics for ${surface.surfaceKey}`);
  }
  return {
    surfaceKey: surface.surfaceKey,
    ready: surface.ready,
    statusPhase: surface.status.phase,
    frameReason: metrics.lastRenderFrameReason,
    prepareCount: metrics.prepareCount,
    renderCount: metrics.renderCount,
    renderedNodeCount: metrics.lastRenderedNodeCount,
    renderedFrameCount: metrics.lastRenderedFrameCount,
    renderedTextCount: metrics.lastRenderedTextCount,
    renderedImageCount: metrics.lastRenderedImageCount,
    imageDrawCount: metrics.lastImageDrawCount,
    imageFillDrawCount: metrics.lastImageFillDrawCount,
    imageNodeDrawCount: metrics.lastImageNodeDrawCount,
    effectNodeCount: metrics.lastEffectNodeCount,
    groupOpacityNodeCount: metrics.lastGroupOpacityNodeCount,
    inheritedGroupOpacityNodeCount: metrics.lastInheritedGroupOpacityNodeCount,
  };
}

function fileUrl(path: string): string {
  return `/@fs${path}`;
}

function selectedGuidOption(options: OpenFixtureTemplateOptions): string | undefined {
  if ("selectGuid" in options) {
    return options.selectGuid;
  }
  return DEEP_BLUE_INSTANCE_GUID;
}

async function selectedFrameDarkPixelRatio(page: Page, guid: string): Promise<number> {
  const box = await nodeScreenBoxByGuid(page, guid);
  const clip = {
    x: box.x + box.width * 0.1,
    y: box.y + box.height * 0.03,
    width: box.width * 0.8,
    height: box.height * 0.05,
  };
  const png = readPng(await page.screenshot({ clip }));
  return darkPixelRatio(png);
}

function roundedClipForBox(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  label: string,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  if (width <= 0 || height <= 0) {
    throw new Error(`${label} has invalid clip ${width}x${height}`);
  }
  return { x, y, width, height };
}

async function selectedSymbolResolution(
  page: Page,
  guid: string,
): Promise<{
  readonly instanceType: string;
  readonly effectiveSymbolGuidKey: string | undefined;
  readonly hasResolvedDescendants: boolean;
}> {
  return page.evaluate((targetGuid) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const node = api.document.requireNode(targetGuid);
    const resolution = api.document.symbolResolution(targetGuid);
    return {
      instanceType: node.type,
      effectiveSymbolGuidKey: resolution.effectiveSymbolGuidKey,
      hasResolvedDescendants: resolution.resolvedDescendantNames.length > 0,
    };
  }, guid);
}

async function nodeScreenBoxByGuid(
  page: Page,
  guid: string,
): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
  const topLeft = await nodeScreenPointByGuid(page, guid, { x: 0, y: 0 });
  const bottomRight = await nodeScreenPointByGuid(page, guid, { x: 1, y: 1 });
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  return {
    x,
    y,
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y),
  };
}

async function nodeScreenPointByGuid(
  page: Page,
  guid: string,
  ratio: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  const point = await figEditorNodeViewportPointByGuid(page, guid, ratio);
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

async function requireLocatorBox(
  locator: Locator,
  label: string,
): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${label} has no bounding box`);
  }
  return box;
}

function darkPixelRatio(png: ReturnType<typeof readPng>): number {
  const totalPixels = png.width * png.height;
  const darkPixels = Array.from({ length: totalPixels }, (_, pixelIndex) => pixelIndex)
    .reduce((count, pixelIndex) => {
      const i = pixelIndex * 4;
      if (isDarkPixel(png.data, i)) {
        return count + 1;
      }
      return count;
    }, 0);
  return darkPixels / totalPixels;
}

function isDarkPixel(data: Uint8Array, i: number): boolean {
  const alpha = data[i + 3] ?? 0;
  if (alpha === 0) {
    return false;
  }
  const red = data[i] ?? 255;
  const green = data[i + 1] ?? 255;
  const blue = data[i + 2] ?? 255;
  return red < 24 && green < 24 && blue < 24;
}

type PngImage = ReturnType<typeof readPng>;

type PngDiff = {
  readonly diffPixels: number;
  readonly totalPixels: number;
  readonly ratio: number;
  readonly image: PngImage;
};

function comparePngs(actual: PngImage, expected: PngImage): PngDiff {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `PNG dimensions differ: actual ${actual.width}x${actual.height}, expected ${expected.width}x${expected.height}`,
    );
  }
  const diff = createPngImage({ width: actual.width, height: actual.height });
  const diffPixels = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, {
    threshold: 0.1,
    includeAA: false,
  });
  const totalPixels = actual.width * actual.height;
  return { diffPixels, totalPixels, ratio: diffPixels / totalPixels, image: diff };
}

async function svgFixtureToBrowserScreenshotPng(
  page: Page,
  input: { readonly path: string; readonly width: number; readonly height: number },
): Promise<PngImage> {
  const svg = readFileSync(input.path, "utf8");
  const exportPage = await page.context().newPage();
  try {
    await exportPage.setViewportSize({ width: input.width, height: input.height });
    await exportPage.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            html, body {
              margin: 0;
              padding: 0;
              background: transparent;
              width: ${input.width}px;
              height: ${input.height}px;
              overflow: hidden;
            }
            svg {
              display: block;
              width: ${input.width}px;
              height: ${input.height}px;
            }
          </style>
        </head>
        <body>${svg}</body>
      </html>
    `);
    const svgElement = exportPage.locator("svg").first();
    await expect(svgElement).toBeVisible();
    await waitForProjectedSvgPaint(exportPage);
    return readPng(await svgElement.screenshot({ scale: "css" }));
  } finally {
    await exportPage.close();
  }
}

async function svgFixtureToProjectedEditorScreenshotPng(
  page: Page,
  input: {
    readonly path: string;
    readonly surfaceBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly clip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  },
): Promise<PngImage> {
  return svgMarkupToProjectedEditorScreenshotPng(page, {
    svg: readFileSync(input.path, "utf8"),
    surfaceBox: input.surfaceBox,
    clip: input.clip,
  });
}

async function svgMarkupToProjectedEditorScreenshotPng(
  page: Page,
  input: {
    readonly svg: string;
    readonly surfaceBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly clip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  },
): Promise<PngImage> {
  const viewportSize = page.viewportSize();
  if (viewportSize === null) {
    throw new Error("Projected editor SVG comparison requires a fixed viewport size");
  }
  const exportPage = await page.context().newPage();
  try {
    await exportPage.setViewportSize(viewportSize);
    await exportPage.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            html, body {
              margin: 0;
              padding: 0;
              background: transparent;
              width: ${viewportSize.width}px;
              height: ${viewportSize.height}px;
              overflow: hidden;
            }
            [data-export-surface] {
              position: absolute;
              left: ${input.surfaceBox.x}px;
              top: ${input.surfaceBox.y}px;
              width: ${input.surfaceBox.width}px;
              height: ${input.surfaceBox.height}px;
              line-height: 0;
            }
            [data-export-surface] svg {
              display: block;
              width: ${input.surfaceBox.width}px;
              height: ${input.surfaceBox.height}px;
            }
          </style>
        </head>
        <body><div data-export-surface="">${input.svg}</div></body>
      </html>
    `);
    const svgElement = exportPage.locator("svg").first();
    await expect(svgElement).toBeVisible();
    await waitForProjectedSvgPaint(exportPage);
    return readPng(await exportPage.screenshot({ clip: input.clip }));
  } finally {
    await exportPage.close();
  }
}

async function waitForProjectedSvgPaint(page: Page): Promise<void> {
  await page.waitForFunction(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function attachVisualDiffIfNeeded(
  testInfo: TestInfo,
  input: {
    readonly actual: PngImage;
    readonly expected: PngImage;
    readonly diff: PngDiff;
    readonly maxRatio: number;
    readonly actualSvg?: string;
    readonly expectedSvg?: string;
    readonly diagnostics?: Record<string, unknown>;
  },
): Promise<void> {
  const metadata = {
    diffPixels: input.diff.diffPixels,
    totalPixels: input.diff.totalPixels,
    ratio: input.diff.ratio,
    maxRatio: input.maxRatio,
    diagnostics: input.diagnostics,
  };
  const metadataJson = JSON.stringify(metadata, null, 2);
  writeFileSync(testInfo.outputPath("visual-diff.json"), metadataJson);
  writeFileSync(testInfo.outputPath("actual-editor.png"), writePng(input.actual));
  writeFileSync(testInfo.outputPath("expected-reference-export.png"), writePng(input.expected));
  writeFileSync(testInfo.outputPath("diff.png"), writePng(input.diff.image));
  if (input.actualSvg !== undefined) {
    writeFileSync(testInfo.outputPath("actual-editor.svg"), input.actualSvg);
  }
  if (input.expectedSvg !== undefined) {
    writeFileSync(testInfo.outputPath("expected-reference-export.svg"), input.expectedSvg);
  }
  await testInfo.attach("visual-diff.json", { body: metadataJson, contentType: "application/json" });
  if (input.diff.ratio <= input.maxRatio) {
    return;
  }
  await Promise.all([
    testInfo.attach("actual-editor.png", { body: writePng(input.actual), contentType: "image/png" }),
    testInfo.attach("expected-reference-export.png", { body: writePng(input.expected), contentType: "image/png" }),
    testInfo.attach("diff.png", { body: writePng(input.diff.image), contentType: "image/png" }),
  ]);
}
