/**
 * @file SVG fig-editor text editing visual parity tests.
 *
 * Guards against text appearance changing during edit. Text pixels must keep
 * coming from the selected renderer backend; the inline overlay may only draw
 * caret/selection chrome.
 */

import { expect, test, type Page } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { createPngImage, readPng } from "@higma-codecs/png";

const HELLO_TEXT = { pageX: 50, pageY: 50, width: 200, height: 30 };
const HELLO_TEXT_GUID = "1:2";
const WRAPPED_TEXT = { pageX: 260, pageY: 50, width: 60, height: 80 };
const WRAPPED_TEXT_GUID = "1:16";

test.describe("Fig editor SVG text editing visual parity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?renderer=svg");
    await waitForSvgEditor(page);
  });

  test("keeps text rendering in the SVG backend while overlay text is not duplicated", async ({ page }) => {
    const beforeSvg = await renderedTextSvgState(page, HELLO_TEXT_GUID);
    expect(beforeSvg.pathCount).toBeGreaterThan(0);
    expect(beforeSvg.textCount).toBe(0);
    const textClip = await textInteriorClip(page, HELLO_TEXT);
    const beforeEdit = readPng(await page.screenshot({ clip: textClip }));

    await doubleClickNode(page, HELLO_TEXT);
    await page.locator("textarea").waitFor({ state: "attached" });
    const duringEdit = readPng(await page.screenshot({ clip: textClip }));

    const editingState = await page.evaluate(() => {
      const svg = document.querySelector<SVGSVGElement>("[data-fig-editor-root-surface-content-guid='1:2'] svg[aria-hidden='true']");
      const overlayTexts = Array.from(document.querySelectorAll<SVGTextElement>("svg:not([aria-hidden='true']) text"))
        .map((text) => text.textContent ?? "")
        .filter((text) => text.includes("Hello World"));
      return { pathCount: svg?.querySelectorAll("path").length ?? 0, textCount: svg?.querySelectorAll("text").length ?? 0, overlayTextCount: overlayTexts.length };
    });

    expect(editingState.pathCount).toBeGreaterThan(0);
    expect(editingState.textCount).toBe(0);
    expect(editingState.overlayTextCount).toBe(0);
    expect(countDifferentPixels(beforeEdit, duringEdit)).toBeLessThanOrEqual(25);

    await fillHiddenCanvasTextarea(page, "Edited SVG text");
    const afterEditState = await page.evaluate((guid) => {
      const svg = document.querySelector<SVGSVGElement>(`[data-fig-editor-root-surface-content-guid='${guid}'] svg[aria-hidden='true']`);
      const overlayTexts = Array.from(document.querySelectorAll<SVGTextElement>("svg:not([aria-hidden='true']) text"))
        .map((text) => text.textContent ?? "")
        .filter((text) => text.includes("Edited SVG text"));
      return { outerHTML: svg?.outerHTML ?? "", pathCount: svg?.querySelectorAll("path").length ?? 0, textCount: svg?.querySelectorAll("text").length ?? 0, overlayTextCount: overlayTexts.length };
    }, HELLO_TEXT_GUID);

    expect(afterEditState.outerHTML).not.toBe(beforeSvg.outerHTML);
    expect(afterEditState.pathCount).toBeGreaterThan(0);
    expect(afterEditState.textCount).toBe(0);
    expect(afterEditState.overlayTextCount).toBe(0);

    await page.keyboard.press("Escape");
    await expect(page.locator("textarea")).toHaveCount(0);
    expect((await renderedTextSvgState(page, HELLO_TEXT_GUID)).outerHTML).toBe(afterEditState.outerHTML);
  });

  test("maps wrapped source selection to the rendered visual line", async ({ page }) => {
    const svgBeforeEdit = await renderedTextSvgState(page, WRAPPED_TEXT_GUID);
    expect(svgBeforeEdit.pathCount).toBeGreaterThan(0);
    expect(svgBeforeEdit.textCount).toBe(0);

    await doubleClickNode(page, WRAPPED_TEXT);
    await page.locator("textarea").waitFor({ state: "attached" });
    await setHiddenCanvasTextareaSelection(page, 6, 11);
    await page.waitForFunction(() => document.querySelectorAll("svg rect[fill-opacity='0.3']").length === 1);

    const selectionRects = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<SVGRectElement>("svg rect[fill-opacity='0.3']")).map((rect) => ({
        x: Number(rect.getAttribute("x")),
        y: Number(rect.getAttribute("y")),
        width: Number(rect.getAttribute("width")),
        height: Number(rect.getAttribute("height")),
      }));
    });

    expect(selectionRects).toHaveLength(1);
    expect(selectionRects[0].x).toBeCloseTo(0, 1);
    expect(selectionRects[0].width).toBeGreaterThan(30);
    expect(selectionRects[0].y).toBeGreaterThan(15);

    await setHiddenCanvasTextareaSelection(page, 5, 6);
    await page.waitForFunction(() => document.querySelectorAll("svg rect[fill-opacity='0.3']").length === 1);
    const whitespaceRects = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<SVGRectElement>("svg rect[fill-opacity='0.3']")).map((rect) => ({
        y: Number(rect.getAttribute("y")),
        width: Number(rect.getAttribute("width")),
      }));
    });
    expect(whitespaceRects).toHaveLength(1);
    expect(whitespaceRects[0].width).toBeGreaterThan(0);
    expect(whitespaceRects[0].width).toBeLessThan(selectionRects[0].width);
    expect(whitespaceRects[0].y).toBeLessThan(selectionRects[0].y);
  });
});

async function waitForSvgEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const image = document.querySelector("svg[aria-hidden='true']");
      const hitArea = document.querySelector("rect[fill='transparent']");
      return Boolean(image && hitArea);
    },
    { timeout: 10_000 },
  );
}

async function renderedTextSvgState(page: Page, guid: string): Promise<{
  readonly outerHTML: string;
  readonly pathCount: number;
  readonly textCount: number;
}> {
  return page.evaluate((textGuid) => {
    const svg = document.querySelector<SVGSVGElement>(`[data-fig-editor-root-surface-content-guid='${textGuid}'] svg[aria-hidden='true']`);
    if (!svg) {
      throw new Error(`SVG renderer tree was not found for text node ${textGuid}`);
    }
    return {
      outerHTML: svg.outerHTML,
      pathCount: svg.querySelectorAll("path").length,
      textCount: svg.querySelectorAll("text").length,
    };
  }, guid);
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

async function textInteriorClip(
  page: Page,
  node: { readonly pageX: number; readonly pageY: number; readonly width: number; readonly height: number },
): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = await page.evaluate(
    ({ pageX, pageY, width, height }) => {
      const hit = Array.from(document.querySelectorAll<SVGRectElement>("rect[fill='transparent']")).find((candidate) => {
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
      if (!hit) {
        return null;
      }
      const bounds = hit.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    },
    node,
  );
  if (!rect) {
    throw new Error(`Hit-area rect not found for node at (${node.pageX}, ${node.pageY})`);
  }
  return {
    x: rect.x + 6,
    y: rect.y + 6,
    width: Math.min(92, rect.width - 12),
    height: Math.min(18, rect.height - 12),
  };
}

function countDifferentPixels(before: ReturnType<typeof readPng>, after: ReturnType<typeof readPng>): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`Screenshot sizes differ: ${before.width}x${before.height} vs ${after.width}x${after.height}`);
  }
  const diff = createPngImage({ width: before.width, height: before.height });
  return pixelmatch(before.data, after.data, diff.data, before.width, before.height, { threshold: 0.05, includeAA: true });
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
  await page.waitForFunction(
    ({ startOffset, endOffset }) => {
      const textarea = Array.from(document.querySelectorAll("textarea")).find((ta) => {
        return window.getComputedStyle(ta).opacity === "0";
      });
      return textarea?.selectionStart === startOffset && textarea.selectionEnd === endOffset;
    },
    { startOffset: start, endOffset: end },
  );
}
