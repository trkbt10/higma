/** @file Real .fig editor regressions for external SymbolResolver sources. */

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createPngImage, readPng, writePng } from "@higma-codecs/png";
import pixelmatch from "pixelmatch";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../../../dev/public/fig-fixtures.tmp");
const IOS_PRIMARY = resolve(FIXTURE_DIR, "ios-app-store-template.fig");
const IOS_SOURCE = resolve(FIXTURE_DIR, "ios-app-store-template-source.fig");
const IOS_EXPORT_DARK_FRAMED = resolve(FIXTURE_DIR, "ios-export/iPhone/Framed-1.svg");
const MACOS_SFNS_FONT = "/System/Library/Fonts/SFNS.ttf";
const DEEP_BLUE_INSTANCE_GUID = "2316:9650";
const DEEP_BLUE_SYMBOL_GUID = "2316:20463";
const DARK_FRAMED_GUID = "2316:9644";
const MAX_DARK_FRAMED_EXPORT_DIFF_RATIO = 0;
const REAL_FIG_VISUAL_TEST_TIMEOUT_MS = 120_000;

test.describe("real fig symbol resolution in the editor", () => {
  test.skip(
    !existsSync(IOS_PRIMARY) || !existsSync(IOS_SOURCE) || !existsSync(IOS_EXPORT_DARK_FRAMED),
    "requires local iOS fixture and export copies under dev/public/fig-fixtures.tmp",
  );
  test.skip(
    !existsSync(MACOS_SFNS_FONT),
    "requires macOS SFNS.ttf for source-backed Figma export visual comparison",
  );

  for (const renderer of ["svg", "webgl"] as const) {
    test(`resolves iPhone 17 Pro Deep Blue instance through source document in ${renderer}`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
      });

      await openIosTemplate(page, renderer);

      const diagnostics = page.locator(`[data-e2e-selected-guid="${DEEP_BLUE_INSTANCE_GUID}"]`);
      await expect(diagnostics).toHaveAttribute("data-e2e-selected-type", "INSTANCE");
      await expect(diagnostics).toHaveAttribute("data-e2e-effective-symbol-guid", DEEP_BLUE_SYMBOL_GUID);
      await expect(diagnostics).toHaveAttribute("data-e2e-resolved-descendant-names", /Phone/);
      await expect(diagnostics).toHaveAttribute("data-e2e-resolved-descendant-names", /Rim \+ Shading/);
      await expect(page.getByText(`INSTANCE · ${DEEP_BLUE_INSTANCE_GUID}`)).toBeVisible();

      expect(errors).toEqual([]);
    });
  }

  test("keeps the real-file layer tree collapsed and expands descendants on demand", async ({ page }) => {
    test.setTimeout(60_000);

    await openIosTemplate(page, "svg", { panel: "all", selectGuid: undefined });

    const layers = page.getByRole("tree", { name: "Layers" });
    await expect(layers.getByRole("treeitem", { name: /Framed/ }).first()).toBeVisible();
    await expect(layers.getByRole("treeitem", { name: /iPhone 17 Pro Silver/ })).toHaveCount(0);

    await layers.getByRole("button", { name: "Expand Framed" }).first().click();
    await expect(layers.getByRole("treeitem", { name: /iPhone 17 Pro Silver/ }).first()).toBeVisible();
  });

  test("renders source-backed dark Framed pixels in the editor SVG viewport", async ({ page }) => {
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openIosTemplate(page, "svg", { panel: "none", selectGuid: DARK_FRAMED_GUID });

    const sourceBackedRatio = await selectedFrameDarkPixelRatio(page, DARK_FRAMED_GUID);
    expect(sourceBackedRatio).toBeGreaterThan(0.75);
  });

  test("keeps source-backed dark Framed frame renderer pixels near the Figma export", async ({ page }, testInfo) => {
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openIosFrame(page, "svg", DARK_FRAMED_GUID);

    const frame = page.locator("[data-e2e-frame-renderer] svg[data-fig-family-page-renderer]");
    const actualSvg = await frame.evaluate((element) => element.outerHTML);
    const expectedSvg = readFileSync(IOS_EXPORT_DARK_FRAMED, "utf8");
    const actual = readPng(await frame.screenshot({ scale: "css" }));
    const expected = await svgFixtureToBrowserScreenshotPng(page, {
      path: IOS_EXPORT_DARK_FRAMED,
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

  test("keeps source-backed dark Framed editor pixels near the Figma export", async ({ page }, testInfo) => {
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openIosTemplate(page, "svg", { panel: "none", selectGuid: undefined });

    const editorSurface = page.locator(`[data-fig-editor-root-surface-content-guid="${DARK_FRAMED_GUID}"]`);
    const editorSvg = editorSurface.locator("svg[data-fig-family-page-renderer]");
    const actualSvg = await editorSvg.evaluate((element) => element.outerHTML);
    const expectedSvg = readFileSync(IOS_EXPORT_DARK_FRAMED, "utf8");
    const hitAreaBox = await nodeHitAreaBox(page, DARK_FRAMED_GUID);
    const surfaceBox = await requireLocatorBox(editorSurface, `editor surface ${DARK_FRAMED_GUID}`);
    expectBoxPairNear(surfaceBox, hitAreaBox, DARK_FRAMED_GUID);
    const clip = roundedClipForBox(surfaceBox, `editor surface ${DARK_FRAMED_GUID}`);
    const editorPng = readPng(await page.screenshot({ clip }));
    const exportPng = await svgFixtureToProjectedEditorScreenshotPng(page, {
      path: IOS_EXPORT_DARK_FRAMED,
      surfaceBox,
      clip,
    });
    const projectedActualPng = await svgMarkupToProjectedEditorScreenshotPng(page, {
      svg: actualSvg,
      surfaceBox,
      clip,
    });
    const editorElementPng = readPng(await editorSurface.screenshot({ scale: "css" }));
    const exportElementPng = await svgFixtureToBrowserScreenshotPng(page, {
      path: IOS_EXPORT_DARK_FRAMED,
      width: editorElementPng.width,
      height: editorElementPng.height,
    });
    const elementDiff = comparePngs(editorElementPng, exportElementPng);
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
        surfaceBox,
        hitAreaBox,
        clip,
        elementDiff: {
          diffPixels: elementDiff.diffPixels,
          totalPixels: elementDiff.totalPixels,
          ratio: elementDiff.ratio,
        },
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

  test("exposes the primary-only external source gap as a visual regression", async ({ page }) => {
    test.setTimeout(REAL_FIG_VISUAL_TEST_TIMEOUT_MS);
    await page.setViewportSize({ width: 3600, height: 1400 });

    await openIosTemplate(page, "svg", {
      panel: "none",
      selectGuid: DARK_FRAMED_GUID,
      source: "primary-only",
    });

    const primaryOnlyRatio = await selectedFrameDarkPixelRatio(page, DARK_FRAMED_GUID);
    expect(primaryOnlyRatio).toBeLessThan(0.25);
  });
});

type OpenIosTemplateOptions = {
  readonly panel?: "property" | "all" | "none";
  readonly selectGuid?: string;
  readonly source?: "with-source" | "primary-only";
};

async function openIosTemplate(
  page: Page,
  renderer: "svg" | "webgl",
  options: OpenIosTemplateOptions = {},
): Promise<void> {
  await installMacOsSfProFontAccess(page);
  const panel = options.panel ?? "property";
  const selectGuid = selectedGuidOption(options);
  const params = new URLSearchParams({
    renderer,
    panel,
    fontMode: "browser-real",
    figUrl: fileUrl(IOS_PRIMARY),
  });
  if ((options.source ?? "with-source") === "with-source") {
    params.set("sourceUrl", fileUrl(IOS_SOURCE));
  }
  if (selectGuid !== undefined) {
    params.set("selectGuid", selectGuid);
  }
  await page.goto(`/?${params.toString()}`);
  await page.waitForSelector("[data-fig-editor-canvas]", { timeout: 45_000 });
  if (renderer === "webgl") {
    await expect.poll(() => allWebGLSurfacesReady(page), { timeout: 45_000 }).toBe(true);
    return;
  }
  await expect(page.locator("svg[data-fig-family-page-renderer]").first()).toBeVisible({ timeout: 45_000 });
}

async function openIosFrame(page: Page, renderer: "svg" | "webgl", frameGuid: string): Promise<void> {
  await installMacOsSfProFontAccess(page);
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
    figUrl: fileUrl(IOS_PRIMARY),
    sourceUrl: fileUrl(IOS_SOURCE),
    frameGuid,
  });
  await page.goto(`/?${params.toString()}`);
  try {
    await page.waitForSelector("[data-e2e-frame-renderer]", { timeout: 45_000 });
  } catch (error) {
    const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    throw new Error(
      `E2E frame view did not render. body=${bodyText} pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`,
      { cause: error },
    );
  }
  if (renderer === "webgl") {
    await expect.poll(() => allWebGLSurfacesReady(page), { timeout: 45_000 }).toBe(true);
    return;
  }
  try {
    await page.waitForFunction(() => {
      const frame = document.querySelector("[data-e2e-frame-renderer]");
      const box = frame?.getBoundingClientRect();
      return box !== undefined && box.width > 0 && box.height > 0;
    }, null, { timeout: 45_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const frame = document.querySelector("[data-e2e-frame-renderer]");
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

async function installMacOsSfProFontAccess(page: Page): Promise<void> {
  await page.context().grantPermissions(["local-fonts"], { origin: "http://localhost:5192" });
  const sfnsBase64 = readFileSync(MACOS_SFNS_FONT).toString("base64");
  await page.addInitScript((base64: string) => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get(): string {
        return "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
      },
    });
    function base64ToBytes(value: string): Uint8Array {
      const binary = atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    const bytes = base64ToBytes(base64);
    const fontData = ["Regular", "Semibold"].map((style) => ({
      family: "System Font",
      fullName: `System Font ${style}`,
      postscriptName: style === "Regular" ? ".SFNS-Regular" : ".SFNS-Semibold",
      style,
      async blob(): Promise<Blob> {
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return new Blob([buffer], { type: "font/ttf" });
      },
    }));
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: async () => fontData,
    });
  }, sfnsBase64);
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

function fileUrl(path: string): string {
  return `/@fs${path}`;
}

function selectedGuidOption(options: OpenIosTemplateOptions): string | undefined {
  if ("selectGuid" in options) {
    return options.selectGuid;
  }
  return DEEP_BLUE_INSTANCE_GUID;
}

async function selectedFrameDarkPixelRatio(page: Page, guid: string): Promise<number> {
  const box = await nodeHitAreaBox(page, guid);
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

async function nodeHitAreaBox(
  page: Page,
  guid: string,
): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
  const hitArea = page.getByRole("button", { name: `Canvas node ${guid}` });
  const box = await hitArea.boundingBox();
  if (box === null) {
    throw new Error(`Canvas hit area ${guid} has no bounding box`);
  }
  return box;
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

function expectBoxPairNear(
  actual: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  expected: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  guid: string,
): void {
  const maxDelta = 0.75;
  expect(Math.abs(actual.x - expected.x), `${guid} editor surface x`).toBeLessThanOrEqual(maxDelta);
  expect(Math.abs(actual.y - expected.y), `${guid} editor surface y`).toBeLessThanOrEqual(maxDelta);
  expect(Math.abs(actual.width - expected.width), `${guid} editor surface width`).toBeLessThanOrEqual(maxDelta);
  expect(Math.abs(actual.height - expected.height), `${guid} editor surface height`).toBeLessThanOrEqual(maxDelta);
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
  writeFileSync(testInfo.outputPath("expected-figma-export.png"), writePng(input.expected));
  writeFileSync(testInfo.outputPath("diff.png"), writePng(input.diff.image));
  if (input.actualSvg !== undefined) {
    writeFileSync(testInfo.outputPath("actual-editor.svg"), input.actualSvg);
  }
  if (input.expectedSvg !== undefined) {
    writeFileSync(testInfo.outputPath("expected-figma-export.svg"), input.expectedSvg);
  }
  await testInfo.attach("visual-diff.json", { body: metadataJson, contentType: "application/json" });
  if (input.diff.ratio <= input.maxRatio) {
    return;
  }
  await Promise.all([
    testInfo.attach("actual-editor.png", { body: writePng(input.actual), contentType: "image/png" }),
    testInfo.attach("expected-figma-export.png", { body: writePng(input.expected), contentType: "image/png" }),
    testInfo.attach("diff.png", { body: writePng(input.diff.image), contentType: "image/png" }),
  ]);
}
