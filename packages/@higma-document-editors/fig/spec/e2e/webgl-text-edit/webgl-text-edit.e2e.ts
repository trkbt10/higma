/**
 * @file WebGL fig-editor text editing smoke tests.
 *
 * Verifies that the React editor shell can edit text while the rendered
 * pixels come from the WebGL backend.
 */

import { expect, test, type Page } from "@playwright/test";

const HELLO_TEXT = { pageX: 50, pageY: 50, width: 200, height: 30 };
const WRAPPED_TEXT = { pageX: 260, pageY: 50, width: 60, height: 80 };

test.use({ deviceScaleFactor: 2 });

test.describe("Fig editor WebGL text editing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?renderer=webgl");
    await waitForWebGLEditor(page);
  });

  test("uses a WebGL canvas and transparent text-edit input", async ({ page }) => {
    const canvas = page.locator("canvas");
    await expect(canvas).toHaveCount(1);

    const canvasMetrics = await canvas.evaluate((node) => ({
      ratio: node.width / node.clientWidth,
      backingPixels: node.width * node.height,
      beforeEditPixels: node.toDataURL("image/png"),
    }));
    expect(canvasMetrics.ratio).toBeGreaterThan(0);
    expect(canvasMetrics.backingPixels).toBeLessThanOrEqual(4_100_000);

    await doubleClickNode(page, HELLO_TEXT);
    await page.locator("textarea").waitFor({ state: "attached" });
    await fillHiddenCanvasTextarea(page, "WebGL text\nwrap parity");
    await expect.poll(
      () => canvas.evaluate((node) => node.toDataURL("image/png")),
      { timeout: 5_000 },
    ).not.toBe(canvasMetrics.beforeEditPixels);

    const editorState = await page.evaluate(() => {
      const textarea = Array.from(document.querySelectorAll("textarea")).find((ta) => {
        return window.getComputedStyle(ta).opacity === "0";
      });
      if (!textarea) {
        return null;
      }
      const style = window.getComputedStyle(textarea);
      const textRect = textarea.getBoundingClientRect();
      const canvas = document.querySelector("canvas");
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
    const canvas = page.locator("canvas");
    const beforePixels = await canvas.evaluate((node) => node.toDataURL("image/png"));

    await createTextNodeByDrag(page);
    await page.locator("textarea").waitFor({ state: "attached" });
    await fillHiddenCanvasTextarea(page, "New WebGL text");

    await expect.poll(
      () => canvas.evaluate((node) => node.toDataURL("image/png")),
      { timeout: 5_000 },
    ).not.toBe(beforePixels);
    await expect.poll(() => page.locator("textarea").inputValue()).toBe("New WebGL text");
  });
});

test.describe("Fig editor WebGL initialization performance", () => {
  test("shows a loading layer while heavy WebGL initialization is pending", async ({ page }) => {
    await page.goto("/?renderer=webgl&webglInitializationDelayMs=3000");

    const canvas = page.locator("canvas");
    const loading = page.locator("[data-webgl-loading='true']");
    await expect(loading).toBeVisible();
    await expect(canvas).toHaveAttribute("data-webgl-ready", "false");

    await expect(loading).toBeHidden({ timeout: 10_000 });
    await expect(canvas).toHaveAttribute("data-webgl-ready", "true");

    const metrics = await readWebGLMetrics(page);
    expect(metrics.prepareCount).toBeGreaterThanOrEqual(1);
    expect(metrics.renderCount).toBeGreaterThanOrEqual(1);
    expect(metrics.lastPrepareMs).toBeGreaterThanOrEqual(0);
    expect(metrics.lastRenderMs).toBeGreaterThanOrEqual(0);
    expect(metrics.lastRenderMs).toBeLessThan(100);
  });

  test("keeps viewport movement on the cached WebGL resource path", async ({ page }) => {
    await page.goto("/?renderer=webgl");
    await waitForReadyWebGLCanvas(page);
    await switchWebGLViewportToFixedZoom(page);

    const before = await readWebGLMetrics(page);
    await panWebGLViewport(page);
    await expect.poll(
      () => readWebGLMetrics(page).then((metrics) => metrics.renderCount),
      { timeout: 5_000 },
    ).toBeGreaterThan(before.renderCount);

    const after = await readWebGLMetrics(page);
    expect(after.prepareCount).toBe(before.prepareCount);
    expect(after.lastRenderMs).toBeLessThan(100);
  });
});

async function waitForWebGLEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      const hitArea = document.querySelector("rect[fill='transparent']");
      return Boolean(canvas && hitArea && canvas.getAttribute("data-webgl-ready") === "true");
    },
    { timeout: 10_000 },
  );
}

async function waitForReadyWebGLCanvas(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector("canvas")?.getAttribute("data-webgl-ready") === "true",
    { timeout: 10_000 },
  );
}

async function readWebGLMetrics(page: Page): Promise<{
  readonly prepareCount: number;
  readonly renderCount: number;
  readonly lastPrepareMs: number;
  readonly lastRenderMs: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("WebGL canvas was not found");
    }
    return {
      prepareCount: Number(canvas.getAttribute("data-webgl-prepare-count")),
      renderCount: Number(canvas.getAttribute("data-webgl-render-count")),
      lastPrepareMs: Number(canvas.getAttribute("data-webgl-last-prepare-ms")),
      lastRenderMs: Number(canvas.getAttribute("data-webgl-last-render-ms")),
    };
  });
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
  return page.evaluate(() => {
    const svg = Array.from(document.querySelectorAll("svg")).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 500 && rect.height > 300;
    }) ?? null;
    if (!svg) {
      throw new Error("Editor SVG viewport was not found");
    }
    const rect = svg.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

async function createTextNodeByDrag(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Text" }).click();
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
  return page.evaluate(({ xRatio, yRatio }) => {
    const svg = Array.from(document.querySelectorAll("svg")).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 500 && rect.height > 300;
    }) ?? null;
    if (!svg) {
      throw new Error("Editor SVG viewport was not found");
    }
    const rect = svg.getBoundingClientRect();
    return { x: rect.left + rect.width * xRatio, y: rect.top + rect.height * yRatio };
  }, point);
}

async function doubleClickNode(
  page: Page,
  node: { readonly pageX: number; readonly pageY: number; readonly width: number; readonly height: number },
): Promise<void> {
  const center = await page.evaluate(
    ({ pageX, pageY, width, height }) => {
      const rect = Array.from(document.querySelectorAll<SVGRectElement>("rect[fill='transparent']")).find((candidate) => {
        const x = Number(candidate.getAttribute("x"));
        const y = Number(candidate.getAttribute("y"));
        const candidateWidth = Number(candidate.getAttribute("width"));
        const candidateHeight = Number(candidate.getAttribute("height"));
        return (
          Math.abs(x - pageX) < 1 &&
          Math.abs(y - pageY) < 1 &&
          Math.abs(candidateWidth - width) < 1 &&
          Math.abs(candidateHeight - height) < 1
        );
      }) ?? null;
      if (!rect) {
        return null;
      }
      const bounds = rect.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    },
    node,
  );

  if (!center) {
    throw new Error(`Hit-area rect not found for node at (${node.pageX}, ${node.pageY})`);
  }
  await page.mouse.dblclick(center.x, center.y);
}

async function fillHiddenCanvasTextarea(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const textarea = Array.from(document.querySelectorAll("textarea")).find((ta) => {
      return window.getComputedStyle(ta).opacity === "0";
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
      return window.getComputedStyle(ta).opacity === "0";
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
