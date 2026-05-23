/** @file Real .fig editor performance measurements for Kiwi-backed rendering. */

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../../../dev/public/fig-fixtures.tmp");
const IOS_PRIMARY = resolve(FIXTURE_DIR, "ios-app-store-template.fig");
const IOS_SOURCE = resolve(FIXTURE_DIR, "ios-app-store-template-source.fig");
const MACOS_SFNS_FONT = "/System/Library/Fonts/SFNS.ttf";
const DEEP_BLUE_INSTANCE_GUID = "2316:9650";

type PerformanceMetrics = {
  readonly initialDisplayMs: number;
  readonly layerExpandMs: number;
  readonly selectionMs: number;
  readonly selectionPointerDispatchMs: number;
  readonly selectionPanelVisibleMs: number;
  readonly pageSwitchMs: number;
};

type SelectionMetrics = Pick<
  PerformanceMetrics,
  "selectionMs" | "selectionPointerDispatchMs" | "selectionPanelVisibleMs"
>;

test.describe("real fig editor performance", () => {
  test.skip(
    !existsSync(IOS_PRIMARY) || !existsSync(IOS_SOURCE),
    "requires local iOS fixture and source copy under dev/public/fig-fixtures.tmp",
  );
  test.skip(!existsSync(MACOS_SFNS_FONT), "requires macOS SFNS.ttf for browser-real font mode");

  test("records iOS source-backed editor interaction timings", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await installMacOsSfProFontAccess(page);

    const initialDisplayMs = await measureInitialDisplay(page);
    const layerExpandMs = await measureLayerExpansion(page);
    const selection = await measureSelection(page);
    const pageSwitchMs = await measurePageSwitch(page, errors);

    expect(errors).toEqual([]);
    await attachMetrics(testInfo, {
      initialDisplayMs,
      layerExpandMs,
      ...selection,
      pageSwitchMs,
    });
  });
});

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function measureInitialDisplay(page: Page): Promise<number> {
  const startedAt = performance.now();
  await page.goto(`/?${routeParams().toString()}`);
  await page.waitForSelector("[data-fig-editor-canvas]", { timeout: 45_000 });
  await expect(page.locator("svg[data-fig-family-page-renderer]").first()).toBeVisible({ timeout: 45_000 });
  return performance.now() - startedAt;
}

async function measureLayerExpansion(page: Page): Promise<number> {
  const layers = page.getByRole("tree", { name: "Layers" });
  await expect(layers.getByRole("treeitem", { name: /Framed/ }).first()).toBeVisible();
  const expandButton = layers.getByRole("button", { name: "Expand Framed" }).first();
  await expect(expandButton).toBeVisible();
  const startedAt = performance.now();
  await expandButton.click();
  await expect(layers.getByRole("treeitem", { name: /iPhone 17 Pro Silver/ }).first()).toBeVisible();
  return performance.now() - startedAt;
}

async function measureSelection(page: Page): Promise<SelectionMetrics> {
  const target = page.locator(`[data-editor-canvas-item-id="${DEEP_BLUE_INSTANCE_GUID}"]`);
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error(`Selection target ${DEEP_BLUE_INSTANCE_GUID} has no screen box`);
  }
  const startedAt = performance.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const clickedAt = performance.now();
  await expect(page.getByText(`INSTANCE · ${DEEP_BLUE_INSTANCE_GUID}`)).toBeVisible();
  const visibleAt = performance.now();
  return {
    selectionMs: visibleAt - startedAt,
    selectionPointerDispatchMs: clickedAt - startedAt,
    selectionPanelVisibleMs: visibleAt - clickedAt,
  };
}

async function measurePageSwitch(page: Page, pageErrors: readonly string[]): Promise<number> {
  const pages = page.getByRole("listbox", { name: "Pages" }).getByRole("option");
  const pageCount = await pages.count();
  if (pageCount < 2) {
    throw new Error(`real fig performance requires at least two CANVAS pages, got ${pageCount}`);
  }
  const nextPage = pages.nth(1);
  await expect(nextPage).toBeVisible();
  const nextPageName = await nextPage.getAttribute("aria-label");
  if (nextPageName === null) {
    throw new Error("real fig performance page switch target is missing aria-label");
  }
  const startedAt = performance.now();
  await nextPage.click();
  const selectedNextPage = page.getByRole("listbox", { name: "Pages" }).getByRole("option", { name: nextPageName });
  try {
    await expect(selectedNextPage).toHaveAttribute("aria-selected", "true", { timeout: 45_000 });
    await expect(page.locator("[data-browser-font-preload='pending']")).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator("svg[data-fig-family-page-renderer]").first()).toBeVisible({ timeout: 45_000 });
  } catch (error) {
    const diagnostics = await readPageSwitchDiagnostics(page, pageErrors);
    throw new Error(`real fig performance page switch did not settle: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  return performance.now() - startedAt;
}

type PageSwitchDiagnostics = {
  readonly pageErrors: readonly string[];
  readonly pageOptions: readonly { readonly name: string | null; readonly selected: string | null }[];
  readonly pendingFontPreloadCount: number;
  readonly canvasCount: number;
  readonly rendererSvgCount: number;
  readonly bodyText: string;
};

async function readPageSwitchDiagnostics(
  page: Page,
  pageErrors: readonly string[],
): Promise<PageSwitchDiagnostics> {
  return page.evaluate((errors) => {
    const options = Array.from(document.querySelectorAll<HTMLElement>("[role='listbox'][aria-label='Pages'] [role='option']"));
    return {
      pageErrors: errors,
      pageOptions: options.map((option) => ({
        name: option.getAttribute("aria-label"),
        selected: option.getAttribute("aria-selected"),
      })),
      pendingFontPreloadCount: document.querySelectorAll("[data-browser-font-preload='pending']").length,
      canvasCount: document.querySelectorAll("[data-fig-editor-canvas]").length,
      rendererSvgCount: document.querySelectorAll("svg[data-fig-family-page-renderer]").length,
      bodyText: document.body.innerText.slice(0, 2_000),
    };
  }, pageErrors);
}

function routeParams(): URLSearchParams {
  return new URLSearchParams({
    renderer: "svg",
    panel: "all",
    fontMode: "browser-real",
    figUrl: fileUrl(IOS_PRIMARY),
    sourceUrl: fileUrl(IOS_SOURCE),
  });
}

function fileUrl(path: string): string {
  return `/@fs${path}`;
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

async function attachMetrics(testInfo: TestInfo, metrics: PerformanceMetrics): Promise<void> {
  const body = JSON.stringify(metrics, null, 2);
  writeFileSync(testInfo.outputPath("performance-metrics.json"), body);
  await testInfo.attach("performance-metrics.json", { body, contentType: "application/json" });
}
