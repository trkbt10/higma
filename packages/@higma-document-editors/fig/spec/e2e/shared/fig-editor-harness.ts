/** @file Shared human-operation helpers for fig-editor E2E harnesses. */
/* eslint-disable jsdoc/require-jsdoc -- E2E helper names are the user-operation contract; per-helper JSDoc duplicates labels. */

import { expect, type Page } from "@playwright/test";
import {
  figEditorNodeViewportPointByGuid,
  waitForFigEditorOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";
import type { FigEditorOperationSurfaceGlobalThis } from "../../../src/operation-surface/fig-editor-operation-surface-types";

export type PageBounds = {
  readonly pageX: number;
  readonly pageY: number;
  readonly width: number;
  readonly height: number;
};

export type NodeBounds = PageBounds & {
  readonly guidKey: string;
};

export const HELLO_TEXT = { guidKey: "1:2", pageX: 50, pageY: 50, width: 200, height: 30 } satisfies NodeBounds;
export const WRAPPED_TEXT = { guidKey: "1:16", pageX: 260, pageY: 50, width: 60, height: 80 } satisfies NodeBounds;
export const STYLED_TEXT = { guidKey: "1:24", pageX: 260, pageY: 150, width: 220, height: 30 } satisfies NodeBounds;
export const RECT = { guidKey: "1:3", pageX: 50, pageY: 310, width: 150, height: 80 } satisfies NodeBounds;
export const ELLIPSE = { guidKey: "1:4", pageX: 130, pageY: 330, width: 120, height: 80 } satisfies NodeBounds;
export const LINE = { guidKey: "1:5", pageX: 280, pageY: 455, width: 120, height: 40 } satisfies NodeBounds;
export const VECTOR = { guidKey: "1:6", pageX: 330, pageY: 310, width: 120, height: 100 } satisfies NodeBounds;
export const FRAME = { guidKey: "1:9", pageX: 520, pageY: 300, width: 220, height: 150 } satisfies NodeBounds;
export const FRAME_CHILD = { guidKey: "1:11", pageX: 582, pageY: 350, width: 92, height: 58 } satisfies NodeBounds;
export const FRAME_CHILD_VECTOR = { guidKey: "1:12", pageX: 646, pageY: 340, width: 58, height: 42 } satisfies NodeBounds;
export const COVERING_GROUP = { guidKey: "1:13", pageX: 760, pageY: 300, width: 170, height: 120 } satisfies NodeBounds;
export const GROUP_CHILD = { guidKey: "1:14", pageX: 784, pageY: 326, width: 90, height: 54 } satisfies NodeBounds;






export async function openEditor(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}`);
  await waitForEditor(page);
}






export async function waitForEditor(page: Page): Promise<void> {
  await waitForFigEditorOperationSurface(page);
  await expect(page.locator("svg[aria-label='Editor canvas viewport']")).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      return false;
    }
    api.canvas.viewport();
    return true;
  })).toBe(true);
}






export async function clickNode(page: Page, node: NodeBounds): Promise<void> {
  const center = await nodeScreenPoint(page, node, { x: 0.5, y: 0.5 });
  await page.mouse.click(center.x, center.y);
}






export async function doubleClickNode(page: Page, node: NodeBounds): Promise<void> {
  const center = await nodeScreenPoint(page, node, { x: 0.5, y: 0.5 });
  await page.mouse.dblclick(center.x, center.y);
}






export async function clickNodeAt(
  page: Page,
  node: NodeBounds,
  ratio: { readonly x: number; readonly y: number },
): Promise<void> {
  const point = await nodeScreenPoint(page, node, ratio);
  await page.mouse.click(point.x, point.y);
}

export async function contextMenuNode(page: Page, node: NodeBounds): Promise<void> {
  const center = await nodeScreenPoint(page, node, { x: 0.5, y: 0.5 });
  await page.mouse.click(center.x, center.y, { button: "right" });
}

export async function clickPagePoint(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<void> {
  const screenPoint = await pagePointToScreenPoint(page, point);
  await page.mouse.click(screenPoint.x, screenPoint.y);
}

export async function clickNodeAtPagePosition(
  page: Page,
  node: NodeBounds,
  ratio: { readonly x: number; readonly y: number },
): Promise<void> {
  await clickPagePoint(page, {
    x: node.pageX + node.width * ratio.x,
    y: node.pageY + node.height * ratio.y,
  });
}

export async function pagePointToScreenPoint(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  const viewportPoint = await page.evaluate(({ x, y }) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const viewport = api.canvas.viewport();
    return {
      x: viewport.rulerThickness + viewport.viewport.translateX + x * viewport.viewport.scale,
      y: viewport.rulerThickness + viewport.viewport.translateY + y * viewport.viewport.scale,
    };
  }, point);
  const canvasBox = await editorCanvasViewportSvgBoundingBox(page);
  return { x: canvasBox.x + viewportPoint.x, y: canvasBox.y + viewportPoint.y };
}






export async function shiftClickNode(page: Page, node: NodeBounds): Promise<void> {
  const point = await nodeScreenPoint(page, node, { x: 0.5, y: 0.5 });
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
}






export async function nodeScreenPoint(
  page: Page,
  node: NodeBounds,
  ratio: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  const point = await figEditorNodeViewportPointByGuid(page, node.guidKey, ratio);
  const viewport = await page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.canvas.viewport();
  });
  const canvasBox = await editorCanvasViewportSvgBoundingBox(page);
  return {
    x: canvasBox.x + viewport.rulerThickness + point.viewportX,
    y: canvasBox.y + viewport.rulerThickness + point.viewportY,
  };
}






export async function nodeScreenRect(
  page: Page,
  node: NodeBounds,
): Promise<{ readonly left: number; readonly top: number; readonly width: number; readonly height: number }> {
  const topLeft = await nodeScreenPoint(page, node, { x: 0, y: 0 });
  const bottomRight = await nodeScreenPoint(page, node, { x: 1, y: 1 });
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

async function editorCanvasViewportSvgBoundingBox(page: Page): Promise<{
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}> {
  const canvasSvg = page.locator("svg[aria-label='Editor canvas viewport']");
  await expect(canvasSvg).toBeVisible();
  const box = await canvasSvg.boundingBox();
  if (box === null) {
    throw new Error("Editor canvas viewport SVG had no visible bounding box");
  }
  return box;
}






export async function vectorHandleCount(page: Page): Promise<number> {
  return page.locator("circle[role='button'][aria-label^='Vector path']").count();
}






export async function anchorHandleCount(page: Page): Promise<number> {
  return page.locator("circle[role='button'][aria-label^='Vector path anchor handle']").count();
}






export async function firstAnchorHandleCenter(page: Page): Promise<{ readonly x: number; readonly y: number }> {
  return anchorHandleCenter(page, 0);
}






export async function anchorHandleCenter(page: Page, index: number): Promise<{ readonly x: number; readonly y: number }> {
  return handleCenterByAriaLabelPrefix(page, "Vector path anchor handle", "Vector anchor", index);
}

async function handleCenterByAriaLabelPrefix(
  page: Page,
  ariaLabelPrefix: string,
  errorLabel: string,
  index: number,
): Promise<{ readonly x: number; readonly y: number }> {
  const handle = page.locator(`circle[role='button'][aria-label^='${ariaLabelPrefix}']`).nth(index);
  await expect(handle).toBeVisible();
  const bounds = await handle.boundingBox();
  if (!bounds) {
    throw new Error(`${errorLabel} handle had no visible bounding box`);
  }
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}






export async function nearestAnchorHandleDistance(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<number> {
  const handles = page.locator("circle[role='button'][aria-label^='Vector path anchor handle']");
  const count = await handles.count();
  const distances = await Promise.all(Array.from({ length: count }, async (_value, index) => {
    const bounds = await handles.nth(index).boundingBox();
    if (!bounds) {
      throw new Error("Vector anchor handle had no visible bounding box");
    }
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    return Math.hypot(center.x - point.x, center.y - point.y);
  }));
  return Math.min(...distances);
}






export async function controlHandleCenter(page: Page, index: number): Promise<{ readonly x: number; readonly y: number }> {
  return handleCenterByAriaLabelPrefix(page, "Vector path control handle", "Vector control", index);
}






export async function draftAnchorHandleCount(page: Page): Promise<number> {
  return page.locator("circle[role='button'][aria-label^='Draft vector path anchor handle']").count();
}






export async function draftControlHandleCount(page: Page): Promise<number> {
  return page.locator("circle[role='button'][aria-label^='Draft vector path control handle']").count();
}






export async function draftControlLineCount(page: Page): Promise<number> {
  return page.locator("line[aria-label='Draft vector path control line']").count();
}






export async function draftControlLineStrokeWidth(page: Page): Promise<string> {
  const line = page.locator("line[aria-label='Draft vector path control line']").first();
  await expect(line).toBeVisible();
  return await line.getAttribute("stroke-width") ?? "";
}






export async function draftSegmentStrokeWidth(page: Page): Promise<string> {
  const segment = page.getByRole("button", { name: "Draft vector path segment" });
  await expect(segment).toBeVisible();
  return await segment.getAttribute("stroke-width") ?? "";
}






export async function draftAnchorHandleCenter(page: Page, index: number): Promise<{ readonly x: number; readonly y: number }> {
  return handleCenterByAriaLabelPrefix(page, "Draft vector path anchor handle", "Draft vector anchor", index);
}






export async function draftControlHandleCenter(page: Page, index: number): Promise<{ readonly x: number; readonly y: number }> {
  return handleCenterByAriaLabelPrefix(page, "Draft vector path control handle", "Draft vector control", index);
}






export async function controlLineCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll("line[stroke-dasharray]").length);
}






export async function rightClickAnchorHandle(page: Page, index: number): Promise<void> {
  const center = await anchorHandleCenter(page, index);
  await expect.poll(() => topmostAt(page, center)).toMatchObject({ tagName: "circle" });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Convert Segment to Curve" })).toBeVisible();
}






export async function editablePathScreenPoint(page: Page, ratio: number): Promise<{ readonly x: number; readonly y: number }> {
  const point = await page.evaluate((pathRatio) => {
    const path = document.querySelector<SVGPathElement>("[aria-label='Editable vector path segment 1']");
    if (!path) {
      return null;
    }
    const length = path.getTotalLength();
    const ctm = path.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const candidateRatios = [pathRatio, 0.08, 0.14, 0.22, 0.31, 0.39, 0.48, 0.57, 0.66, 0.74, 0.83, 0.91];
    for (const candidateRatio of candidateRatios) {
      const svgPoint = path.getPointAtLength(length * candidateRatio);
      const domPoint = new DOMPoint(svgPoint.x, svgPoint.y).matrixTransform(ctm);
      const topmost = document.elementFromPoint(domPoint.x, domPoint.y);
      if (topmost?.getAttribute("aria-label") === "Editable vector path segment 1") {
        return { x: domPoint.x, y: domPoint.y };
      }
    }
    return null;
  }, ratio);
  if (!point) {
    throw new Error("Clickable editable vector path segment point was not found");
  }
  return point;
}






export async function firstEditablePathData(page: Page): Promise<string> {
  return page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>("[aria-label='Editable vector path segment 1']");
    const data = path?.getAttribute("d");
    if (!data) {
      throw new Error("Editable vector path segment data was not found");
    }
    return data;
  });
}






export async function committedPathUnitSummary(page: Page): Promise<{
  readonly commandCount: number;
  readonly hasNegativeCoordinate: boolean;
}> {
  const data = await firstEditablePathData(page);
  const coordinates = data.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return {
    commandCount: data.match(/[MLC]/g)?.length ?? 0,
    hasNegativeCoordinate: coordinates.some((coordinate) => coordinate < 0),
  };
}






export async function topmostAt(page: Page, point: { readonly x: number; readonly y: number }): Promise<{
  readonly tagName: string;
  readonly ariaLabel: string | null;
  readonly role: string | null;
}> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    if (!element) {
      throw new Error(`No element at (${x}, ${y})`);
    }
    return {
      tagName: element.tagName.toLowerCase(),
      ariaLabel: element.getAttribute("aria-label"),
      role: element.getAttribute("role"),
    };
  }, point);
}






export async function selectionBoxPageBounds(page: Page): Promise<NodeBounds> {
  return page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const selected = api.document.selectedNodes()[0];
    if (selected === undefined) {
      throw new Error("Selection box bounds require a selected Kiwi node");
    }
    const rect = Array.from(document.querySelectorAll<SVGRectElement>("rect[vector-effect='non-scaling-stroke']")).find((candidate) => {
      return candidate.getAttribute("fill") === "none" && candidate.getAttribute("stroke") !== "transparent";
    }) ?? null;
    if (!rect) {
      throw new Error("Selection box was not found");
    }
    return {
      guidKey: selected.guidKey,
      pageX: Number(rect.getAttribute("x")),
      pageY: Number(rect.getAttribute("y")),
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height")),
    };
  });
}






export async function renderedSvgMarkup(page: Page): Promise<string> {
  return page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>("svg[aria-hidden='true']"));
    if (svgs.length === 0) {
      throw new Error("Rendered SVG trees were not found");
    }
    return svgs.map((svg) => svg.outerHTML).join("\n");
  });
}






export function committedVectorPathStrokeCount(svg: string): number {
  return (svg.match(/stroke="#2659f2"/g) ?? []).length;
}






export async function isCanvasTextEditActive(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll("textarea")).some((textarea) => {
      return globalThis.getComputedStyle(textarea).opacity === "0";
    });
  });
}






export async function getCanvasTextareaValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hidden = Array.from(document.querySelectorAll("textarea")).find((textarea) => {
      return globalThis.getComputedStyle(textarea).opacity === "0";
    });
    return hidden?.value ?? "";
  });
}






export async function focusCanvasTextarea(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hidden = Array.from(document.querySelectorAll("textarea")).find((textarea) => {
      return globalThis.getComputedStyle(textarea).opacity === "0";
    });
    hidden?.focus();
  });
}






export async function canvasTextareaSelection(page: Page): Promise<{ readonly start: number; readonly end: number } | null> {
  return page.evaluate(() => {
    const hidden = Array.from(document.querySelectorAll("textarea")).find((textarea) => {
      return globalThis.getComputedStyle(textarea).opacity === "0";
    });
    if (!hidden) {
      return null;
    }
    return { start: hidden.selectionStart, end: hidden.selectionEnd };
  });
}






export async function activeElementDiagnostics(page: Page): Promise<{
  readonly tag: string;
  readonly opacity: string;
  readonly textareaValue: string;
}> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active) {
      return { tag: "none", opacity: "n/a", textareaValue: "not-textarea" };
    }
    return {
      tag: active.tagName,
      opacity: globalThis.getComputedStyle(active).opacity,
      textareaValue: active instanceof HTMLTextAreaElement ? active.value.substring(0, 30) : "not-textarea",
    };
  });
}






export async function countCanvasVisibleNodes(page: Page): Promise<number> {
  return page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.canvas.visibleNodeBounds().length;
  });
}






export async function countCarets(page: Page): Promise<number> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll<SVGLineElement>("svg line[stroke-width='2']")).filter((line) => {
      return line.getAttribute("x1") === line.getAttribute("x2") && line.getAttribute("y1") !== line.getAttribute("y2");
    }).length;
  });
}






export async function countSelectionRects(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll("svg rect[fill-opacity='0.3']").length);
}






export async function countTextEditFrameOutlines(page: Page): Promise<number> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll<SVGRectElement>("svg rect")).filter((rect) => {
      return rect.getAttribute("fill") === "none" && rect.getAttribute("stroke") !== "transparent";
    }).length;
  });
}
