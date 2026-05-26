/**
 * @file WebGL fig-editor text editing smoke tests.
 *
 * Verifies that the React editor shell can edit text while the rendered
 * pixels come from the WebGL backend.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  doubleClickNode,
  HELLO_TEXT,
  WRAPPED_TEXT,
} from "../shared/fig-editor-harness";
import {
  figEditorWebGLSurfaceByKey,
  waitForFigEditorWebGLSurfacesSettled,
  waitForFigEditorOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";

const HELLO_TEXT_GUID = HELLO_TEXT.guidKey;

test.use({ deviceScaleFactor: 2 });

test.describe("Fig editor WebGL text editing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?renderer=webgl");
    await waitForWebGLEditor(page);
  });

  test("uses a WebGL canvas and transparent text-edit input", async ({ page }) => {
    const canvas = webGLCanvasForNode(page, HELLO_TEXT_GUID);
    await expect(canvas).toHaveCount(1);
    await expect.poll(() => figEditorWebGLSurfaceByKey(page, "fig-editor-webgl-viewport").then((surface) => surface.ready)).toBe(true);

    const canvasMetrics = await canvas.evaluate((node) => ({
      ratio: node.width / node.clientWidth,
      backingPixels: node.width * node.height,
    }));
    const beforeEditMetrics = await readWebGLMetrics(page, HELLO_TEXT_GUID);
    expect(canvasMetrics.ratio).toBeGreaterThan(0);
    expect(canvasMetrics.backingPixels).toBeLessThanOrEqual(4_100_000);

    await doubleClickNode(page, HELLO_TEXT);
    await page.locator("textarea").waitFor({ state: "attached" });
    await fillHiddenCanvasTextarea(page, "WebGL text\nwrap parity");
    await expect(webGLLoadingForNode(page, HELLO_TEXT_GUID)).toHaveCount(0);
    await expect.poll(
      () => readWebGLMetrics(page, HELLO_TEXT_GUID).then((metrics) => metrics.renderCount),
      { timeout: 5_000 },
    ).toBeGreaterThan(beforeEditMetrics.renderCount);

    const editorState = await page.evaluate(() => {
      const textarea = Array.from(document.querySelectorAll("textarea")).find((ta) => {
        return globalThis.getComputedStyle(ta).opacity === "0";
      });
      if (!textarea) {
        return null;
      }
      const style = globalThis.getComputedStyle(textarea);
      const textRect = textarea.getBoundingClientRect();
      const canvas = document.querySelector("canvas[aria-label='Fig editor WebGL viewport surface']");
      const canvasRect = canvas?.getBoundingClientRect();
      const serializeRect = (rect: DOMRect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      return {
        text: textarea.value,
        textareaBackground: style.backgroundColor,
        textareaOpacity: style.opacity,
        canvasWidth: canvas?.width ?? 0,
        canvasClientWidth: canvas?.clientWidth ?? 0,
        textRect: serializeRect(textRect),
        canvasRect: canvasRect ? serializeRect(canvasRect) : null,
      };
    });

    expect(editorState).not.toBeNull();
    expect(editorState?.text).toBe("WebGL text\nwrap parity");
    expect(editorState?.textareaBackground).toBe("rgba(0, 0, 0, 0)");
    expect(editorState?.textareaOpacity).toBe("0");
    expect(editorState?.canvasWidth).toBeGreaterThan(editorState?.canvasClientWidth ?? 0);
    expect(editorState?.textRect.width).toBeGreaterThan(0);
    expect(editorState?.canvasRect?.width).toBeGreaterThan(0);
  });

  test("uses shared wrapped text selection layout over WebGL", async ({ page }) => {
    await expect.poll(() => figEditorWebGLSurfaceByKey(page, "fig-editor-webgl-viewport").then((surface) => surface.ready)).toBe(true);
    await doubleClickNode(page, WRAPPED_TEXT);
    await page.locator("textarea").waitFor({ state: "attached" });
    await setHiddenCanvasTextareaSelection(page, 6, 11);
    await page.waitForFunction(() => document.querySelectorAll("svg rect[fill-opacity='0.3']").length === 1);

    const selectionRects = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<SVGRectElement>("svg rect[fill-opacity='0.3']")).map((rect) => ({
        x: Number(rect.getAttribute("x")),
        y: Number(rect.getAttribute("y")),
        width: Number(rect.getAttribute("width")),
      }));
    });

    expect(selectionRects).toHaveLength(1);
    expect(selectionRects[0].x).toBeCloseTo(0, 1);
    expect(selectionRects[0].width).toBeGreaterThan(30);
    expect(selectionRects[0].y).toBeGreaterThan(15);
  });

  test("creates and edits a new WebGL text node with explicit font metrics", async ({ page }) => {
    const beforeMetrics = await readWebGLMetrics(page);

    await createTextNodeByDrag(page);
    await page.locator("textarea").waitFor({ state: "attached" });
    await fillHiddenCanvasTextarea(page, "New WebGL text");

    await expect.poll(
      () => readWebGLMetrics(page).then((metrics) => metrics.renderCount),
      { timeout: 5_000 },
    ).toBeGreaterThan(beforeMetrics.renderCount);
    await expect.poll(() => page.locator("textarea").inputValue()).toBe("New WebGL text");
  });
});

test.describe("Fig editor WebGL initialization performance", () => {
  test("shows a loading layer while heavy WebGL initialization is pending", async ({ page }) => {
    await page.goto("/?renderer=webgl&webglInitializationDelayMs=3000");

    const canvas = webGLCanvasForNode(page, HELLO_TEXT_GUID);
    const progress = webGLLoadingForNode(page, HELLO_TEXT_GUID);
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute("aria-valuemin", "0");
    await expect(progress).toHaveAttribute("aria-valuemax", "3");
    await expect.poll(() => figEditorWebGLSurfaceByKey(page, "fig-editor-webgl-viewport").then((surface) => surface.ready)).toBe(false);

    await expect(progress).toBeHidden({ timeout: 10_000 });
    await expect.poll(() => figEditorWebGLSurfaceByKey(page, "fig-editor-webgl-viewport").then((surface) => surface.ready)).toBe(true);
    await expect(canvas).toHaveCount(1);
    await waitForFigEditorWebGLSurfacesSettled(page);

    const metrics = await readWebGLMetrics(page);
    expect(metrics.prepareCount).toBeGreaterThanOrEqual(1);
    expect(metrics.renderCount).toBeGreaterThanOrEqual(1);
    expect(metrics.lastPrepareMs).toBeGreaterThanOrEqual(0);
    expect(metrics.lastRenderMs).toBeGreaterThanOrEqual(0);
    expect(metrics.lastRenderMs).toBeLessThan(100);
  });

  test("keeps viewport movement on the cached WebGL resource path", async ({ page }) => {
    await page.goto("/?renderer=webgl");
    await waitForReadyWebGLCanvas(page, HELLO_TEXT_GUID);
    await switchWebGLViewportToFixedZoom(page);

    const before = await readWebGLMetrics(page, HELLO_TEXT_GUID);
    await panWebGLViewport(page);
    await expect(webGLLoadingForNode(page, HELLO_TEXT_GUID)).toHaveCount(0);
    const immediate = await readWebGLMetrics(page, HELLO_TEXT_GUID);
    expect(immediate.prepareCount).toBe(before.prepareCount);
    await expect.poll(
      () => readWebGLMetrics(page, HELLO_TEXT_GUID).then((metrics) => metrics.renderCount),
      { timeout: 5_000 },
    ).toBeGreaterThan(before.renderCount);

    const after = await readWebGLMetrics(page, HELLO_TEXT_GUID);
    await expect(webGLLoadingForNode(page, HELLO_TEXT_GUID)).toHaveCount(0);
    expect(after.prepareCount).toBe(before.prepareCount);
    expect(after.lastRenderMs).toBeLessThan(100);
  });
});

async function waitForWebGLEditor(page: Page): Promise<void> {
  await waitForFigEditorOperationSurface(page);
  await waitForFigEditorWebGLSurfacesSettled(page);
}

function webGLCanvasForNode(page: Page, guid: string) {
  void guid;
  return page.getByRole("img", { name: "Fig editor WebGL viewport surface" });
}

function webGLLoadingForNode(page: Page, guid: string) {
  void guid;
  return page.getByRole("progressbar", { name: "WebGL resource preparation progress" });
}

async function waitForReadyWebGLCanvas(page: Page, guid: string): Promise<void> {
  void guid;
  await waitForFigEditorWebGLSurfacesSettled(page);
}

async function readWebGLMetrics(page: Page, guid = HELLO_TEXT_GUID): Promise<{
  readonly prepareCount: number;
  readonly renderCount: number;
  readonly lastPrepareMs: number;
  readonly lastRenderMs: number;
}> {
  const surface = await figEditorWebGLSurfaceByKey(page, "fig-editor-webgl-viewport");
  if (surface.metrics === undefined) {
    throw new Error(`WebGL renderer metrics are not published for node ${guid}`);
  }
  return {
    prepareCount: surface.metrics.prepareCount,
    renderCount: surface.metrics.renderCount,
    lastPrepareMs: surface.metrics.lastPrepareMs,
    lastRenderMs: surface.metrics.lastRenderMs,
  };
}

async function panWebGLViewport(page: Page): Promise<void> {
  const point = await resolveEditorViewportCenter(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(120, 40);
}

async function switchWebGLViewportToFixedZoom(page: Page): Promise<void> {
  const before = await readWebGLMetrics(page);
  const point = await resolveEditorViewportCenter(page);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Meta");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Meta");
  await expect.poll(
    () => readWebGLMetrics(page).then((metrics) => metrics.renderCount),
    { timeout: 5_000 },
  ).toBeGreaterThan(before.renderCount);
}

async function resolveEditorViewportCenter(page: Page): Promise<{ readonly x: number; readonly y: number }> {
  const canvas = page.locator("svg[aria-label='Editor canvas viewport']");
  await expect(canvas).toBeVisible();
  const rect = await canvas.boundingBox();
  if (rect === null) {
    throw new Error("Editor canvas viewport had no visible bounding box");
  }
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function createTextNodeByDrag(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const start = await resolveEditorViewportPoint(page, { xRatio: 0.58, yRatio: 0.42 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 160, start.y + 36, { steps: 4 });
  await page.mouse.up();
}

async function resolveEditorViewportPoint(
  page: Page,
  point: { readonly xRatio: number; readonly yRatio: number },
): Promise<{ readonly x: number; readonly y: number }> {
  const canvas = page.locator("svg[aria-label='Editor canvas viewport']");
  await expect(canvas).toBeVisible();
  const rect = await canvas.boundingBox();
  if (rect === null) {
    throw new Error("Editor canvas viewport had no visible bounding box");
  }
  return { x: rect.x + rect.width * point.xRatio, y: rect.y + rect.height * point.yRatio };
}

async function fillHiddenCanvasTextarea(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const textarea = Array.from(document.querySelectorAll("textarea")).find((ta) => {
      return globalThis.getComputedStyle(ta).opacity === "0";
    });
    if (!textarea) {
      throw new Error("Canvas text edit textarea was not found");
    }
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    textarea.focus();
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }, text);
}

async function setHiddenCanvasTextareaSelection(page: Page, start: number, end: number): Promise<void> {
  await page.evaluate(({ startOffset, endOffset }) => {
    const textarea = Array.from(document.querySelectorAll("textarea")).find((ta) => {
      return globalThis.getComputedStyle(ta).opacity === "0";
    });
    if (!textarea) {
      throw new Error("Canvas text edit textarea was not found");
    }
    textarea.focus();
    textarea.setSelectionRange(startOffset, endOffset);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  }, { startOffset: start, endOffset: end });
}
