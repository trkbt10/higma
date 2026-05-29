/** @file Real .fig editor performance measurements for Kiwi-backed rendering. */

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readPng } from "@higma-codecs/png";
import { existsSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  figEditorWebGLSurfaces,
  waitForFigEditorOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";
import type { FigEditorOperationSurfaceGlobalThis } from "../../../src/operation-surface/fig-editor-operation-surface-types";
import type {
  FigEditorWebGLSurfaceSnapshot,
} from "../../../src/canvas/webgl/fig-editor-webgl-surface-state";
import {
  hasMacOsSfProLocalFontFiles,
  installMacOsSfProLocalFontAccess,
} from "../shared/macos-sf-pro-local-font-access";
import { discoverSourceBackedPair, resolveFixture } from "../shared/real-fig-fixture-discovery";

const SOURCE_BACKED_PAIR = discoverSourceBackedPair();
const DEEP_BLUE_INSTANCE_GUID = "2316:9650";
const PERFORMANCE_POLL_INTERVALS_MS = [16, 16, 32, 64, 128];

type PerformanceMetrics = {
  readonly renderer: "svg" | "webgl";
  readonly initialDisplayMs: number;
  readonly initialStats: RenderStats;
  readonly layerExpandMs: number;
  readonly selectionMs: number;
  readonly selectionOperationDispatchMs: number;
  readonly selectionPanelVisibleMs: number;
  readonly viewportPanMs: number;
  readonly viewportPanPointerInputMs: number;
  readonly viewportPanSettleMs: number;
  readonly viewportPanWebGLCanvasInlineTransformDuringInput: string | null;
  readonly viewportPanStats: RenderStats;
  readonly selectedFigNodeDragPreviewMs: number;
  readonly selectedFigNodeDragPreviewInputMs: number;
  readonly selectedFigNodeDragPreviewRendererSettleMs: number;
  readonly selectedFigNodeDragPreviewVisualCheckMs: number;
  readonly selectedFigNodeDragPreviewSettleMs: number;
  readonly selectedFigNodeDragPreviewStats: RenderStats;
  readonly selectedFigNodeDragCommitMs: number;
  readonly selectedFigNodeDragCommitProtocolBaselineMs: number;
  readonly selectedFigNodeDragCommitOperationMs: number;
  readonly selectedFigNodeDragCommitBrowserOperationMs: number;
  readonly selectedFigNodeDragCommitRendererSettleMs: number;
  readonly selectedFigNodeDragCommitVisualCheckMs: number;
  readonly selectedFigNodeDragCommitStats: RenderStats;
  readonly pageSwitchMs: number;
  readonly pageSwitchStats: RenderStats;
  readonly pageSwitchEditPersistenceMs: number;
  readonly pageSwitchEditPersistenceStats: RenderStats;
  readonly webglCanvasPixelStats: readonly WebGLCanvasPixelStats[];
};

type WebGLCanvasPixelStats = {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly opaquePixelCount: number;
  readonly nonWhiteOpaquePixelCount: number;
  readonly nonWhiteOpaquePixelRatio: number;
};

type SelectionMetrics = Pick<
  PerformanceMetrics,
  "selectionMs" | "selectionOperationDispatchMs" | "selectionPanelVisibleMs"
>;

test.describe("real fig editor performance", () => {
  test.skip(
    SOURCE_BACKED_PAIR === undefined ||
      !existsSync(resolveFixture(SOURCE_BACKED_PAIR.primary)) ||
      !existsSync(resolveFixture(SOURCE_BACKED_PAIR.source)),
    "requires a source-backed fixture pair under dev/public/fig-fixtures.tmp",
  );
  test.skip(!hasMacOsSfProLocalFontFiles(), "requires macOS SFNS.ttf and SFNSRounded.ttf for browser-real font mode");

  for (const renderer of ["svg", "webgl"] as const) {
    test(`records source-backed editor interaction timings in ${renderer}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const errors = collectPageErrors(page);
      const consoleErrors = collectConsoleErrors(page);
      const webglCanvasPixelStats: WebGLCanvasPixelStats[] = [];
      await installMacOsSfProLocalFontAccess(page);

      const initialDisplayMs = await measureInitialDisplay(page, renderer, errors, consoleErrors);
      if (renderer === "webgl") {
        webglCanvasPixelStats.push(await expectWebGLViewportCanvasPainted(page, "initial settled WebGL viewport"));
      }
      const initialStats = await readRenderStats(page);
      const viewportPan = await measureViewportPan(page, renderer, testInfo);
      if (renderer === "webgl") {
        webglCanvasPixelStats.push(await expectWebGLViewportCanvasPainted(page, "after viewport pan settled WebGL viewport"));
      }
      const selectedFigNodeDrag = await measureSelectedFigNodeDrag(page, renderer, webglCanvasPixelStats);
      const layerExpandMs = await measureLayerExpansion(page);
      const selection = await measureSelection(page);
      const pageSwitchMs = await measurePageSwitch(page, renderer, errors);
      if (renderer === "webgl") {
        webglCanvasPixelStats.push(await expectWebGLViewportCanvasPainted(page, "after page switch settled WebGL viewport"));
      }
      const pageSwitchStats = await readRenderStats(page);
      const pageSwitchEditPersistenceMs = await measurePageSwitchEditPersistence(
        page,
        renderer,
        webglCanvasPixelStats,
      );
      const pageSwitchEditPersistenceStats = await readRenderStats(page);
      if (renderer === "webgl") {
        await measureViewportZoom(page, webglCanvasPixelStats);
      }

      const metrics: PerformanceMetrics = {
        renderer,
        initialDisplayMs,
        initialStats,
        ...viewportPan,
        ...selectedFigNodeDrag,
        layerExpandMs,
        ...selection,
        pageSwitchMs,
        pageSwitchStats,
        pageSwitchEditPersistenceMs,
        pageSwitchEditPersistenceStats,
        webglCanvasPixelStats,
      };
      await attachMetrics(testInfo, metrics);

      expect(errors).toEqual([]);
      expect(initialStats.viewportSurfaceCount).toBe(1);
      expect(initialStats.visibleNodeBoundCount).toBeGreaterThan(0);
      expect(initialStats.visibleNodeBoundCount).toBeLessThanOrEqual(initialStats.renderedNodeBoundCount);
      expect(pageSwitchStats.viewportSurfaceCount).toBe(1);
      expect(pageSwitchStats.visibleNodeBoundCount).toBeGreaterThan(0);
      expect(pageSwitchStats.visibleNodeBoundCount).toBeLessThanOrEqual(pageSwitchStats.renderedNodeBoundCount);
      if (renderer === "webgl") {
        expect(initialStats.viewportWebGLSurfaceCount).toBe(1);
        expect(pageSwitchStats.viewportWebGLSurfaceCount).toBe(1);
        expect(initialStats.webglCanvasCount).toBe(1);
        expect(pageSwitchStats.webglCanvasCount).toBe(1);
        expect(initialStats.webglLastRenderStaticVertexBufferReleaseCount).toBe(0);
        expect(pageSwitchStats.webglLastRenderStaticVertexBufferReleaseCount).toBe(0);
        expect(pageSwitchStats.webglLastImageFillDrawCount).toBeGreaterThan(0);
        expect(pageSwitchStats.webglLastVisibleTexturePreparationCount).toBeGreaterThan(0);
      }
    });
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

async function measureSelectedFigNodeDrag(
  page: Page,
  renderer: "svg" | "webgl",
  webglCanvasPixelStats: WebGLCanvasPixelStats[],
): Promise<Pick<
  PerformanceMetrics,
  | "selectedFigNodeDragPreviewMs"
  | "selectedFigNodeDragPreviewInputMs"
  | "selectedFigNodeDragPreviewRendererSettleMs"
  | "selectedFigNodeDragPreviewVisualCheckMs"
  | "selectedFigNodeDragPreviewSettleMs"
  | "selectedFigNodeDragPreviewStats"
  | "selectedFigNodeDragCommitMs"
  | "selectedFigNodeDragCommitProtocolBaselineMs"
  | "selectedFigNodeDragCommitOperationMs"
  | "selectedFigNodeDragCommitRendererSettleMs"
  | "selectedFigNodeDragCommitVisualCheckMs"
  | "selectedFigNodeDragCommitStats"
>> {
  const before = await readRenderStats(page);
  const beforeNode = await readRequiredNodeTransform(page, DEEP_BLUE_INSTANCE_GUID);
  const startedAt = performance.now();
  await page.evaluate((guidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.selection.select(guidKey);
    api.canvasInteraction.beginSelectedFigNodeDragTransform();
    Array.from({ length: 10 }).forEach(() => {
      api.canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransform(guidKey, { dx: 1, dy: 0.5 });
    });
  }, DEEP_BLUE_INSTANCE_GUID);
  const inputDoneAt = performance.now();
  if (renderer === "webgl") {
    await expect.poll(
      () => readRenderStats(page).then((stats) => stats.webglSceneGraphInteractionRenderCount),
      { timeout: 15_000, intervals: PERFORMANCE_POLL_INTERVALS_MS },
    ).toBeGreaterThan(before.webglSceneGraphInteractionRenderCount);
  }
  await waitForTwoAnimationFrames(page);
  await waitForRendererReady(page, renderer);
  const previewRendererSettledAt = performance.now();
  const previewStats = await readRenderStats(page);
  const duringPreviewNode = await readRequiredNodeTransform(page, DEEP_BLUE_INSTANCE_GUID);
  expect(previewStats.documentKiwiRevision).toBe(before.documentKiwiRevision);
  expect(duringPreviewNode.m02).toBeCloseTo(beforeNode.m02, 6);
  expect(duringPreviewNode.m12).toBeCloseTo(beforeNode.m12, 6);
  if (renderer === "webgl") {
    expect(previewStats.webglLastRenderFrameReasons).toEqual(["scene-graph-interaction"]);
    expect(previewStats.webglSceneGraphInteractionRenderCount).toBeGreaterThan(0);
    const previewVisualCheckStartedAt = performance.now();
    webglCanvasPixelStats.push(await expectWebGLViewportCanvasPainted(page, "during selected FigNode drag preview"));
    const previewVisualCheckDoneAt = performance.now();
    const commitStartedAt = previewVisualCheckDoneAt;
    const commitResult = await measureSelectedFigNodeDragCommit(page, renderer, previewStats, beforeNode, webglCanvasPixelStats);
    return {
      selectedFigNodeDragPreviewMs: commitStartedAt - startedAt,
      selectedFigNodeDragPreviewInputMs: inputDoneAt - startedAt,
      selectedFigNodeDragPreviewRendererSettleMs: previewRendererSettledAt - inputDoneAt,
      selectedFigNodeDragPreviewVisualCheckMs: previewVisualCheckDoneAt - previewVisualCheckStartedAt,
      selectedFigNodeDragPreviewSettleMs: commitStartedAt - inputDoneAt,
      selectedFigNodeDragPreviewStats: previewStats,
      ...commitResult,
    };
  }

  const commitStartedAt = performance.now();
  const commitResult = await measureSelectedFigNodeDragCommit(page, renderer, previewStats, beforeNode, webglCanvasPixelStats);
  return {
    selectedFigNodeDragPreviewMs: commitStartedAt - startedAt,
    selectedFigNodeDragPreviewInputMs: inputDoneAt - startedAt,
    selectedFigNodeDragPreviewRendererSettleMs: previewRendererSettledAt - inputDoneAt,
    selectedFigNodeDragPreviewVisualCheckMs: 0,
    selectedFigNodeDragPreviewSettleMs: commitStartedAt - inputDoneAt,
    selectedFigNodeDragPreviewStats: previewStats,
    ...commitResult,
  };
}

async function measureSelectedFigNodeDragCommit(
  page: Page,
  renderer: "svg" | "webgl",
  previewStats: RenderStats,
  beforeNode: { readonly m02: number; readonly m12: number },
  webglCanvasPixelStats: WebGLCanvasPixelStats[],
): Promise<Pick<
  PerformanceMetrics,
  | "selectedFigNodeDragCommitMs"
  | "selectedFigNodeDragCommitProtocolBaselineMs"
  | "selectedFigNodeDragCommitOperationMs"
  | "selectedFigNodeDragCommitBrowserOperationMs"
  | "selectedFigNodeDragCommitRendererSettleMs"
  | "selectedFigNodeDragCommitVisualCheckMs"
  | "selectedFigNodeDragCommitStats"
>> {
  const protocolBaselineStartedAt = performance.now();
  await page.evaluate(() => undefined);
  const protocolBaselineMs = performance.now() - protocolBaselineStartedAt;
  const commitStartedAt = performance.now();
  const browserOperationMs = await page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const startedAt = performance.now();
    api.canvasInteraction.endSelectedFigNodeDragTransform();
    return performance.now() - startedAt;
  });
  const commitOperationDoneAt = performance.now();
  await waitForRendererUpdateAfterDocumentMutation(page, renderer, previewStats, DEEP_BLUE_INSTANCE_GUID);
  const commitRendererSettledAt = performance.now();
  const committedNode = await readRequiredNodeTransform(page, DEEP_BLUE_INSTANCE_GUID);
  expect(committedNode.m02).toBeCloseTo(beforeNode.m02 + 10, 6);
  expect(committedNode.m12).toBeCloseTo(beforeNode.m12 + 5, 6);
  const commitStats = await readRenderStats(page);
  const commitVisualCheckStartedAt = performance.now();
  if (renderer === "webgl") {
    webglCanvasPixelStats.push(await expectWebGLViewportCanvasPainted(page, "after selected FigNode drag commit"));
  }
  const committedAt = performance.now();
  return {
    selectedFigNodeDragCommitMs: committedAt - commitStartedAt,
    selectedFigNodeDragCommitProtocolBaselineMs: protocolBaselineMs,
    selectedFigNodeDragCommitOperationMs: commitOperationDoneAt - commitStartedAt,
    selectedFigNodeDragCommitBrowserOperationMs: browserOperationMs,
    selectedFigNodeDragCommitRendererSettleMs: commitRendererSettledAt - commitOperationDoneAt,
    selectedFigNodeDragCommitVisualCheckMs: committedAt - commitVisualCheckStartedAt,
    selectedFigNodeDragCommitStats: commitStats,
  };
}

async function readRequiredNodeTransform(
  page: Page,
  guidKey: string,
): Promise<{ readonly m02: number; readonly m12: number }> {
  return page.evaluate((targetGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const transform = api.document.requireNode(targetGuidKey).node.transform;
    if (transform === undefined) {
      throw new Error(`Expected Kiwi node ${targetGuidKey} to carry transform`);
    }
    return {
      m02: transform.m02,
      m12: transform.m12,
    };
  }, guidKey);
}

async function measureInitialDisplay(
  page: Page,
  renderer: "svg" | "webgl",
  pageErrors: readonly string[],
  consoleErrors: readonly string[],
): Promise<number> {
  const startedAt = performance.now();
  await page.goto(`/?${routeParams(renderer).toString()}`);
  try {
    await page.locator("[role='region'][aria-label='Fig editor canvas']").waitFor({ state: "attached", timeout: 45_000 });
    await waitForFigEditorOperationSurface(page);
    await waitForRendererReady(page, renderer);
  } catch (error) {
    const diagnostics = await readInitialDisplayDiagnostics(page, pageErrors, consoleErrors);
    throw new Error(
      `real fig performance initial display did not settle for ${renderer}: ${JSON.stringify(diagnostics)}`,
      { cause: error },
    );
  }
  return performance.now() - startedAt;
}

async function measureLayerExpansion(page: Page): Promise<number> {
  const layers = page.getByRole("tree", { name: "Layers" });
  const expandButton = layers.getByRole("button", { name: /^Expand / }).first();
  await expect(expandButton).toBeVisible({ timeout: 10_000 });
  const treeitemCountBefore = await layers.getByRole("treeitem").count();
  const startedAt = performance.now();
  await expandButton.click();
  await expect.poll(() => layers.getByRole("treeitem").count(), { timeout: 10_000 }).toBeGreaterThan(treeitemCountBefore);
  return performance.now() - startedAt;
}

async function measureSelection(page: Page): Promise<SelectionMetrics> {
  const startedAt = performance.now();
  await page.evaluate((guidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.selection.select(guidKey);
  }, DEEP_BLUE_INSTANCE_GUID);
  const selectedAt = performance.now();
  await expect.poll(() => page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.document.snapshot().selectedGuidKeys;
  }), { intervals: PERFORMANCE_POLL_INTERVALS_MS }).toContain(DEEP_BLUE_INSTANCE_GUID);
  await expect(page.getByText(`INSTANCE · ${DEEP_BLUE_INSTANCE_GUID}`)).toBeVisible({ timeout: 45_000 });
  const visibleAt = performance.now();
  return {
    selectionMs: visibleAt - startedAt,
    selectionOperationDispatchMs: selectedAt - startedAt,
    selectionPanelVisibleMs: visibleAt - selectedAt,
  };
}

async function measureViewportPan(
  page: Page,
  renderer: "svg" | "webgl",
  testInfo: TestInfo,
): Promise<Pick<
  PerformanceMetrics,
  "viewportPanMs" | "viewportPanPointerInputMs" | "viewportPanSettleMs" | "viewportPanWebGLCanvasInlineTransformDuringInput" | "viewportPanStats"
>> {
  const before = await readRenderStats(page);
  const center = await resolveEditorCanvasCenter(page);
  const webGLCanvasInlineTransformDuringInputRef = { value: null as string | null };
  const startedAt = performance.now();
  await page.keyboard.down("Alt");
  try {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(center.x + 240, center.y + 120, { steps: 8 });
    if (renderer === "webgl") {
      webGLCanvasInlineTransformDuringInputRef.value = await readWebGLViewportCanvasInlineTransform(page);
    }
    await page.mouse.up({ button: "left" });
  } finally {
    await page.keyboard.up("Alt");
  }
  const pointerInputDoneAt = performance.now();
  if (renderer === "webgl") {
    await expect.poll(
      () => readRenderStats(page).then((stats) => stats.webglRenderRevision),
      { timeout: 15_000, intervals: PERFORMANCE_POLL_INTERVALS_MS },
    ).toBeGreaterThan(before.webglRenderRevision);
  }
  await waitForTwoAnimationFrames(page);
  await waitForRendererReady(page, renderer);
  const viewportPanStats = await readRenderStats(page);
  writeFileSync(testInfo.outputPath("viewport-pan-stats.json"), JSON.stringify(viewportPanStats, null, 2));
  if (renderer === "webgl") {
    const settledTransform = await readWebGLViewportCanvasInlineTransform(page);
    expect(viewportPanStats.webglLoadingCount).toBe(0);
    expect(viewportPanStats.viewportWebGLSurfaceCount).toBe(1);
    expect(viewportPanStats.webglCanvasCount).toBe(1);
    expect(viewportPanStats.webglPrepareCount).toBeGreaterThanOrEqual(before.webglPrepareCount);
    expect(webGLCanvasInlineTransformDuringInputRef.value).toBe("");
    expect(settledTransform).toBe("");
    expect(viewportPanStats.webglViewportMotionRenderCount).toBeGreaterThan(before.webglViewportMotionRenderCount);
    expect(viewportPanStats.webglSettledRenderCount).toBeGreaterThan(before.webglSettledRenderCount);
    expectNoViewportPanStaticVertexBufferPreparation(before, viewportPanStats);
    expect(viewportPanStats.webglLastRenderStaticVertexBufferCreationCount).toBeLessThan(5);
    expect(viewportPanStats.webglLastRenderStaticVertexBufferReleaseCount).toBe(0);
  }
  const settledAt = performance.now();
  return {
    viewportPanMs: settledAt - startedAt,
    viewportPanPointerInputMs: pointerInputDoneAt - startedAt,
    viewportPanSettleMs: settledAt - pointerInputDoneAt,
    viewportPanWebGLCanvasInlineTransformDuringInput: webGLCanvasInlineTransformDuringInputRef.value,
    viewportPanStats,
  };
}

async function dispatchZoomWheelBurst(
  page: Page,
  point: { readonly x: number; readonly y: number },
  steps: number,
): Promise<void> {
  // Dispatch the whole burst synchronously in one evaluate so React batches it
  // into a single viewport change -> exactly one viewport-motion (scaled-blit)
  // frame, with no idle settle interleaving between wheels. This makes the
  // assertions deterministic instead of racing the requestIdleCallback settle.
  await page.evaluate(({ x, y, steps: stepCount }) => {
    const svg = document.querySelector("svg[aria-label='Editor canvas viewport']");
    if (svg === null) {
      throw new Error("viewport zoom requires the editor canvas viewport svg");
    }
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    for (let step = 0; step < stepCount; step += 1) {
      svg.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -120,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        ctrlKey: !isMac,
        metaKey: isMac,
      }));
    }
  }, { x: point.x, y: point.y, steps });
}

/**
 * Validate the in-gesture zoom fast path: a wheel-zoom change must present a
 * scaled blit of the cached settled frame (no full effect traversal), and a
 * high-fidelity settled render must follow once the gesture settles.
 */
async function measureViewportZoom(
  page: Page,
  webglCanvasPixelStats: WebGLCanvasPixelStats[],
): Promise<void> {
  const before = await readRenderStats(page);
  const center = await resolveEditorCanvasCenter(page);
  await dispatchZoomWheelBurst(page, center, 6);
  await expect.poll(
    () => readRenderStats(page).then((stats) => stats.webglViewportMotionScaledBlitCount),
    { timeout: 15_000, intervals: PERFORMANCE_POLL_INTERVALS_MS },
  ).toBeGreaterThan(before.webglViewportMotionScaledBlitCount);
  const duringZoomStats = await readRenderStats(page);
  // The scaled blit bypasses the scene traversal entirely.
  expect(duringZoomStats.webglLastViewportMotionRenderedNodeCount).toBe(0);
  expect(duringZoomStats.webglLastViewportMotionEffectNodeCount).toBe(0);
  // Once the wheel burst goes idle, the deferred high-fidelity settled render
  // repaints effects at the final zoom.
  await expect.poll(
    () => readRenderStats(page).then((stats) => stats.webglSettledRenderCount),
    { timeout: 15_000, intervals: PERFORMANCE_POLL_INTERVALS_MS },
  ).toBeGreaterThan(before.webglSettledRenderCount);
  await waitForRendererReady(page, "webgl");
  webglCanvasPixelStats.push(await expectWebGLViewportCanvasPainted(page, "after viewport zoom settled WebGL viewport"));
}

function expectNoViewportPanStaticVertexBufferPreparation(before: RenderStats, after: RenderStats): void {
  if (after.webglPrepareCount === before.webglPrepareCount) {
    return;
  }
  expect(after.webglLastPrepareStaticVertexBufferCreationCount).toBe(0);
}

async function readWebGLViewportCanvasInlineTransform(page: Page): Promise<string> {
  const canvas = page.locator("canvas[aria-label='Fig editor WebGL viewport surface']");
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error("Expected Fig editor WebGL viewport surface canvas");
    }
    return element.style.transform;
  });
}

async function resolveEditorCanvasCenter(page: Page): Promise<{ readonly x: number; readonly y: number }> {
  const canvas = page.locator("svg[aria-label='Editor canvas viewport']");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("real fig performance viewport pan requires a visible editor canvas");
  }
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function waitForTwoAnimationFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolveFrame();
      });
    });
  }));
}

async function measurePageSwitch(page: Page, renderer: "svg" | "webgl", pageErrors: readonly string[]): Promise<number> {
  const nextPage = await page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const pages = api.document.pages();
    if (pages.length < 2) {
      throw new Error(`real fig performance requires at least two CANVAS pages, got ${pages.length}`);
    }
    const candidate = pages[1];
    if (candidate === undefined) {
      throw new Error("real fig performance could not resolve second CANVAS page");
    }
    if (candidate.name === undefined) {
      throw new Error(`real fig performance page ${candidate.guidKey} is missing name`);
    }
    return { guidKey: candidate.guidKey, name: candidate.name };
  });
  const startedAt = performance.now();
  await page.evaluate((nextPageGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.page.setActive(nextPageGuidKey);
  }, nextPage.guidKey);
  const selectedNextPage = page.getByRole("listbox", { name: "Pages" }).getByRole("option", { name: nextPage.name });
  try {
    await expect.poll(() => page.evaluate(() => {
      const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
      if (api === undefined) {
        throw new Error("globalThis.higmaFigEditor is not published");
      }
      return api.document.activePage().guidKey;
    }), { timeout: 45_000, intervals: PERFORMANCE_POLL_INTERVALS_MS }).toBe(nextPage.guidKey);
    await expect(selectedNextPage).toHaveAttribute("aria-selected", "true", { timeout: 45_000 });
    await expect(page.getByRole("status", { name: "Browser font preload pending" })).toHaveCount(0, { timeout: 45_000 });
    await waitForRendererReady(page, renderer);
  } catch (error) {
    const diagnostics = await readPageSwitchDiagnostics(page, pageErrors);
    throw new Error(`real fig performance page switch did not settle: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  return performance.now() - startedAt;
}

type PageSwitchEditTarget = {
  readonly activePageGuidKey: string;
  readonly guidKey: string;
  readonly type: string;
  readonly transformM02: number | undefined;
  readonly transformM12: number | undefined;
};

async function measurePageSwitchEditPersistence(
  page: Page,
  renderer: "svg" | "webgl",
  webglCanvasPixelStats: WebGLCanvasPixelStats[],
): Promise<number> {
  const target = await resolvePageSwitchEditTarget(page);
  const startedAt = performance.now();
  const beforeTranslateStats = await readRenderStats(page);
  await page.evaluate((guidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.node.translate(guidKey, { dx: 1, dy: 1 });
  }, target.guidKey);
  await waitForRendererUpdateAfterDocumentMutation(page, renderer, beforeTranslateStats, target.guidKey);
  const translated = await readPageSwitchEditTarget(page, target.guidKey);
  expect(translated.activePageGuidKey).toBe(target.activePageGuidKey);
  expect(translated.type).toBe(target.type);
  expect(requirePageSwitchEditTransformValue(translated.transformM02, "translated m02"))
    .toBeCloseTo(expectedTranslatedTransformValue(target.transformM02), 6);
  expect(requirePageSwitchEditTransformValue(translated.transformM12, "translated m12"))
    .toBeCloseTo(expectedTranslatedTransformValue(target.transformM12), 6);
  if (renderer === "webgl") {
    const translatedStats = await readRenderStats(page);
    // The single-node (node-content) edit must repaint only its changed region,
    // not re-render the whole visible scene.
    expect(translatedStats.webglCommittedContentRegionRedrawCount)
      .toBeGreaterThan(beforeTranslateStats.webglCommittedContentRegionRedrawCount);
    expect(translatedStats.webglLastRenderedNodeCount)
      .toBeLessThan(beforeTranslateStats.webglLastRenderedNodeCount);
    webglCanvasPixelStats.push(await expectWebGLViewportCanvasPainted(page, "after page-switch document translate"));
  }

  const beforeUndoStats = await readRenderStats(page);
  await page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.history.undo();
  });
  await waitForRendererUpdateAfterDocumentMutation(page, renderer, beforeUndoStats);
  const undone = await readPageSwitchEditTarget(page, target.guidKey);
  expect(undone).toEqual(target);
  if (renderer === "webgl") {
    webglCanvasPixelStats.push(await expectWebGLViewportCanvasPainted(page, "after page-switch document undo"));
  }
  return performance.now() - startedAt;
}

function expectedTranslatedTransformValue(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  return value + 1;
}

function requirePageSwitchEditTransformValue(value: number | undefined, owner: string): number {
  if (value === undefined) {
    throw new Error(`page-switch edit persistence ${owner} was not written by Kiwi node.translate`);
  }
  return value;
}

async function resolvePageSwitchEditTarget(page: Page): Promise<PageSwitchEditTarget> {
  return page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const activePageGuidKey = api.document.activePage().guidKey;
    const visibleBounds = api.canvas.visibleNodeBounds();
    const snapshots = visibleBounds.map((bounds) => api.document.requireNode(bounds.guidKey));
    // Exclude component/variable types: editing those is a "reference-data"
    // mutation that can affect other instances not listed in changedGuidKeys,
    // so the renderer (correctly) cannot region-redraw them. A plain node /
    // instance edit is "node-content", which exercises the content-region path.
    const referenceDataTypes = new Set(["DOCUMENT", "CANVAS", "COMPONENT", "COMPONENT_SET", "SYMBOL", "VARIABLE", "VARIABLE_SET"]);
    const candidate = snapshots.find((snapshot) => {
      if (referenceDataTypes.has(snapshot.type)) {
        return false;
      }
      return snapshot.parentGuidKey !== undefined;
    });
    if (candidate === undefined) {
      throw new Error(`page-switch edit persistence requires a visible editable Kiwi node on active page ${activePageGuidKey}`);
    }
    const transform = candidate.node.transform;
    return {
      activePageGuidKey,
      guidKey: candidate.guidKey,
      type: candidate.type,
      transformM02: transform?.m02,
      transformM12: transform?.m12,
    };
  });
}

async function readPageSwitchEditTarget(page: Page, guidKey: string): Promise<PageSwitchEditTarget> {
  return page.evaluate((targetGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const activePageGuidKey = api.document.activePage().guidKey;
    const snapshot = api.document.requireNode(targetGuidKey);
    const transform = snapshot.node.transform;
    return {
      activePageGuidKey,
      guidKey: snapshot.guidKey,
      type: snapshot.type,
      transformM02: transform?.m02,
      transformM12: transform?.m12,
    };
  }, guidKey);
}

async function waitForRendererUpdateAfterDocumentMutation(
  page: Page,
  renderer: "svg" | "webgl",
  beforeStats: RenderStats,
  expectedChangedGuidKey?: string,
): Promise<void> {
  if (renderer !== "webgl") {
    await waitForTwoAnimationFrames(page);
    await waitForRendererReady(page, renderer);
    return;
  }
  try {
    await expect.poll(
      () => readRenderStats(page).then((stats) => webGLRenderedKiwiDocumentMutationMatchesDocument(stats)),
      { timeout: 15_000, intervals: PERFORMANCE_POLL_INTERVALS_MS },
    ).toBe(true);
  } catch (error) {
    const afterStats = await readRenderStats(page);
    throw new Error(
      `WebGL renderer did not update after Kiwi document mutation: ${JSON.stringify({ beforeStats, afterStats })}`,
      { cause: error },
    );
  }
  if (expectedChangedGuidKey !== undefined) {
    await assertWebGLRenderedKiwiMutationIncludesGuid(page, expectedChangedGuidKey);
  }
  await waitForTwoAnimationFrames(page);
  await waitForRendererReady(page, renderer);
}

async function assertWebGLRenderedKiwiMutationIncludesGuid(page: Page, expectedChangedGuidKey: string): Promise<void> {
  const stats = await readRenderStats(page);
  if (webGLLastRenderedKiwiDocumentMutationIncludesGuid(stats, expectedChangedGuidKey)) {
    return;
  }
  throw new Error(`WebGL renderer rendered Kiwi mutation without expected changed GUID ${expectedChangedGuidKey}: ${JSON.stringify(stats)}`);
}

async function expectWebGLViewportCanvasPainted(page: Page, label: string): Promise<WebGLCanvasPixelStats> {
  await waitForTwoAnimationFrames(page);
  const canvas = page.getByRole("img", { name: "Fig editor WebGL viewport surface", exact: true });
  await expect(canvas).toBeVisible({ timeout: 45_000 });
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error(`${label} WebGL canvas does not have a visible bounding box`);
  }
  const stats = webGLViewportCanvasPixelStats(
    label,
    readPng(await page.screenshot({ clip: box, scale: "css" })),
  );
  expect(stats.width, `${label} canvas width`).toBeGreaterThan(0);
  expect(stats.height, `${label} canvas height`).toBeGreaterThan(0);
  expect(stats.opaquePixelCount, `${label} opaque pixel count`).toBeGreaterThan(0);
  expect(stats.nonWhiteOpaquePixelRatio, `${label} non-white opaque pixel ratio`).toBeGreaterThan(0.001);
  return stats;
}

function webGLViewportCanvasPixelStats(
  label: string,
  png: ReturnType<typeof readPng>,
): WebGLCanvasPixelStats {
  const totalPixels = png.width * png.height;
  const counts = Array.from({ length: totalPixels }, (_, pixelIndex) => pixelIndex).reduce((acc, pixelIndex) => {
    const i = pixelIndex * 4;
    const alpha = png.data[i + 3] ?? 0;
    if (alpha <= 200) {
      return acc;
    }
    const opaquePixelCount = acc.opaquePixelCount + 1;
    const red = png.data[i] ?? 255;
    const green = png.data[i + 1] ?? 255;
    const blue = png.data[i + 2] ?? 255;
    if (red > 245 && green > 245 && blue > 245) {
      return { opaquePixelCount, nonWhiteOpaquePixelCount: acc.nonWhiteOpaquePixelCount };
    }
    return {
      opaquePixelCount,
      nonWhiteOpaquePixelCount: acc.nonWhiteOpaquePixelCount + 1,
    };
  }, { opaquePixelCount: 0, nonWhiteOpaquePixelCount: 0 });
  if (counts.opaquePixelCount === 0) {
    return {
      label,
      width: png.width,
      height: png.height,
      opaquePixelCount: 0,
      nonWhiteOpaquePixelCount: 0,
      nonWhiteOpaquePixelRatio: 0,
    };
  }
  return {
    label,
    width: png.width,
    height: png.height,
    opaquePixelCount: counts.opaquePixelCount,
    nonWhiteOpaquePixelCount: counts.nonWhiteOpaquePixelCount,
    nonWhiteOpaquePixelRatio: counts.nonWhiteOpaquePixelCount / counts.opaquePixelCount,
  };
}

type PageSwitchDiagnostics = {
  readonly pageErrors: readonly string[];
  readonly pageOptions: readonly { readonly name: string | null; readonly selected: string | null }[];
  readonly pendingFontPreloadCount: number;
  readonly canvasCount: number;
  readonly rendererSvgCount: number;
  readonly bodyText: string;
};

type InitialDisplayDiagnostics = {
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly globalThisOperationSurfacePublished: boolean;
  readonly harnessLoadingCount: number;
  readonly pendingFontPreloadCount: number;
  readonly canvasCount: number;
  readonly rendererSvgCount: number;
  readonly webglCanvasCount: number;
  readonly bodyText: string;
};

async function readInitialDisplayDiagnostics(
  page: Page,
  pageErrors: readonly string[],
  consoleErrors: readonly string[],
): Promise<InitialDisplayDiagnostics> {
  return page.evaluate(({ capturedPageErrors, capturedConsoleErrors }) => ({
    pageErrors: capturedPageErrors,
    consoleErrors: capturedConsoleErrors,
    globalThisOperationSurfacePublished: Boolean((globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor),
    harnessLoadingCount: document.querySelectorAll("[role='status'][aria-label='E2E harness loading']").length,
    pendingFontPreloadCount: document.querySelectorAll("[role='status'][aria-label='Browser font preload pending']").length,
    canvasCount: document.querySelectorAll("[role='region'][aria-label='Fig editor canvas']").length,
    rendererSvgCount: document.querySelectorAll("[role='group'][aria-label='Fig editor viewport surface'] svg[aria-hidden='true']").length,
    webglCanvasCount: document.querySelectorAll("canvas[aria-label='Fig editor WebGL viewport surface']").length,
    bodyText: document.body.innerText.slice(0, 2_000),
  }), { capturedPageErrors: pageErrors, capturedConsoleErrors: consoleErrors });
}

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
      pendingFontPreloadCount: document.querySelectorAll("[role='status'][aria-label='Browser font preload pending']").length,
      canvasCount: document.querySelectorAll("[role='region'][aria-label='Fig editor canvas']").length,
      rendererSvgCount: document.querySelectorAll("[role='group'][aria-label='Fig editor viewport surface'] svg[aria-hidden='true']").length,
      bodyText: document.body.innerText.slice(0, 2_000),
    };
  }, pageErrors);
}

async function waitForRendererReady(page: Page, renderer: "svg" | "webgl"): Promise<void> {
  if (renderer === "svg") {
    await expect(page.locator("[role='group'][aria-label='Fig editor viewport surface'] svg[aria-hidden='true']").first()).toBeVisible({ timeout: 45_000 });
    return;
  }
  await expect.poll(
    () => allWebGLSurfacesReady(page),
    { timeout: 45_000, intervals: PERFORMANCE_POLL_INTERVALS_MS },
  ).toBe(true);
}

async function allWebGLSurfacesReady(page: Page): Promise<boolean> {
  const surfaces = await figEditorWebGLSurfaces(page);
  return surfaces.length > 0 && surfaces.every((surface) => (
    surface.ready &&
    surface.canvasWidth > 0 &&
    surface.canvasHeight > 0
  ));
}

type RenderStats = {
  readonly documentKiwiRevision: number;
  readonly viewportSurfaceCount: number;
  readonly viewportWebGLSurfaceCount: number;
  readonly visibleNodeBoundCount: number;
  readonly renderedNodeBoundCount: number;
  readonly rendererSvgCount: number;
  readonly webglCanvasCount: number;
  readonly webglLoadingCount: number;
  readonly webglSurfaceCanvasSizes: readonly { readonly width: number; readonly height: number }[];
  readonly webglSurfaceKiwiDocumentMutationRevisions: readonly (number | undefined)[];
  readonly webglSurfaceKiwiDocumentMutationChangedGuidKeys: readonly (readonly string[])[];
  readonly webglControllerInputRevision: number;
  readonly webglControllerInputSceneViewports: readonly (FigEditorWebGLSurfaceSnapshot["controllerInputSceneViewport"])[];
  readonly webglControllerInputKiwiDocumentMutationRevisions: readonly (number | undefined)[];
  readonly webglControllerInputKiwiDocumentMutationChangedGuidKeys: readonly (readonly string[])[];
  readonly webglRenderRevision: number;
  readonly webglLastRenderedSceneViewports: readonly (FigEditorWebGLSurfaceSnapshot["lastRenderedSceneViewport"])[];
  readonly webglLastRenderedKiwiDocumentMutationRevisions: readonly (number | undefined)[];
  readonly webglLastRenderedKiwiDocumentMutationChangedGuidKeys: readonly (readonly string[])[];
  readonly webglMetricsRevision: number;
  readonly webglPrepareCount: number;
  readonly webglRenderCount: number;
  readonly webglLastPrepareMsMax: number;
  readonly webglLastRenderMsMax: number;
  readonly webglLastRenderTreeResolveMsMax: number;
  readonly webglLastNodeTraversalMsMax: number;
  readonly webglLastSettledFrameCacheCaptureMsMax: number;
  readonly webglLastSettledFrameCacheRestoreMsMax: number;
  readonly webglLastSettledFrameCacheRegionCopyMsMax: number;
  readonly webglLastRenderFrameReasons: readonly string[];
  readonly webglLastRenderedNodeCount: number;
  readonly webglLastRenderedGroupCount: number;
  readonly webglLastRenderedFrameCount: number;
  readonly webglLastRenderedRectCount: number;
  readonly webglLastRenderedEllipseCount: number;
  readonly webglLastRenderedPathCount: number;
  readonly webglLastRenderedTextCount: number;
  readonly webglLastRenderedImageCount: number;
  readonly webglLastViewportSkippedNodeCount: number;
  readonly webglLastViewportSkippedSubtreeCount: number;
  readonly webglLastEffectNodeCount: number;
  readonly webglLastLayerBlurNodeCount: number;
  readonly webglLastGroupOpacityNodeCount: number;
  readonly webglLastInheritedGroupOpacityNodeCount: number;
  readonly webglLastImageDrawCount: number;
  readonly webglLastImageFillDrawCount: number;
  readonly webglLastImageNodeDrawCount: number;
  readonly webglLastTextGlyphRunDrawCount: number;
  readonly webglLastClipStencilFlushCount: number;
  readonly webglLastClipStencilFlushMsMax: number;
  readonly webglLastShapeRenderMsMax: number;
  readonly webglLastPathRenderMsMax: number;
  readonly webglLastTextRenderMsMax: number;
  readonly webglLastImageRenderMsMax: number;
  readonly webglLastEffectRenderMsMax: number;
  readonly webglLastBackgroundBlurRenderMsMax: number;
  readonly webglLastDropShadowRenderMsMax: number;
  readonly webglLastInnerShadowRenderMsMax: number;
  readonly webglLastEffectContentRenderMsMax: number;
  readonly webglLastEffectStrokeRenderMsMax: number;
  readonly webglLastGroupOpacityRenderMsMax: number;
  readonly webglLastLayerBlurRenderMsMax: number;
  readonly webglLastBackgroundBlurPassCount: number;
  readonly webglLastDropShadowPassCount: number;
  readonly webglLastInnerShadowPassCount: number;
  readonly webglLastInnerShadowBlurSourceCount: number;
  readonly webglLastEffectRegionCount: number;
  readonly webglLastEffectRegionPixelCount: number;
  readonly webglLastMaxEffectRegionPixelCount: number;
  readonly webglLastEffectCaptureRegionCount: number;
  readonly webglLastEffectCaptureRegionPixelCount: number;
  readonly webglLastMaxEffectCaptureRegionPixelCount: number;
  readonly webglLastBrowserBlendCaptureRegionPixelCount: number;
  readonly webglLastGroupOpacityCaptureRegionPixelCount: number;
  readonly webglLastLayerBlurCaptureRegionPixelCount: number;
  readonly webglLastPrepareStaticVertexBufferCreationCount: number;
  readonly webglLastPrepareStaticVertexBufferUploadByteLength: number;
  readonly webglLastPrepareStaticVertexBufferReleaseCount: number;
  readonly webglLastRenderDynamicVertexBufferBindCount: number;
  readonly webglLastRenderDynamicVertexBufferUploadCount: number;
  readonly webglLastRenderDynamicVertexBufferUploadByteLength: number;
  readonly webglLastRenderStaticVertexBufferBindCount: number;
  readonly webglLastRenderStaticVertexBufferCreationCount: number;
  readonly webglLastRenderStaticVertexBufferUploadByteLength: number;
  readonly webglLastRenderStaticVertexBufferReleaseCount: number;
  readonly webglLastRenderStaticVertexBufferCount: number;
  readonly webglLastVisibleTexturePreparationCount: number;
  readonly webglLastMissingVisibleTexturePreparationCount: number;
  readonly webglLastTextureUploadCount: number;
  readonly webglSettledRenderCount: number;
  readonly webglLastSettledRenderMsMax: number;
  readonly webglViewportMotionRenderCount: number;
  readonly webglViewportMotionScaledBlitCount: number;
  readonly webglCommittedContentRegionRedrawCount: number;
  readonly webglLastViewportMotionRenderMsMax: number;
  readonly webglLastViewportMotionRenderedNodeCount: number;
  readonly webglLastViewportMotionEffectNodeCount: number;
  readonly webglLastViewportMotionLayerBlurNodeCount: number;
  readonly webglLastViewportMotionGroupOpacityNodeCount: number;
  readonly webglLastViewportMotionInheritedGroupOpacityNodeCount: number;
  readonly webglLastViewportMotionClipStencilFlushCount: number;
  readonly webglLastViewportMotionClipStencilFlushMsMax: number;
  readonly webglSceneGraphInteractionRenderCount: number;
  readonly webglLastSceneGraphInteractionRenderMsMax: number;
  readonly webglLastSceneGraphInteractionRenderedNodeCount: number;
  readonly webglLastSceneGraphInteractionEffectNodeCount: number;
  readonly webglLastSceneGraphInteractionLayerBlurNodeCount: number;
  readonly webglLastSceneGraphInteractionGroupOpacityNodeCount: number;
  readonly webglLastSceneGraphInteractionInheritedGroupOpacityNodeCount: number;
  readonly webglLastSceneGraphInteractionClipStencilFlushCount: number;
  readonly webglLastSceneGraphInteractionClipStencilFlushMsMax: number;
};

function webGLRenderedKiwiDocumentMutationMatchesDocument(stats: RenderStats): boolean {
  if (stats.webglLastRenderedKiwiDocumentMutationRevisions.length === 0) {
    return false;
  }
  return stats.webglLastRenderedKiwiDocumentMutationRevisions.every((revision) => revision === stats.documentKiwiRevision);
}

function webGLLastRenderedKiwiDocumentMutationIncludesGuid(stats: RenderStats, guidKey: string): boolean {
  return stats.webglLastRenderedKiwiDocumentMutationChangedGuidKeys.some((guidKeys) => guidKeys.includes(guidKey));
}

async function readRenderStats(page: Page): Promise<RenderStats> {
  const [webGLSurfaces, domStats] = await Promise.all([
    figEditorWebGLSurfaces(page),
    page.evaluate(() => {
      const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
      if (api === undefined) {
        throw new Error("globalThis.higmaFigEditor is not published");
      }
      return {
        documentKiwiRevision: api.document.snapshot().kiwiDocumentRevision,
        viewportSurfaceCount: document.querySelectorAll("[role='group'][aria-label='Fig editor viewport surface']").length,
        visibleNodeBoundCount: api.canvas.visibleNodeBounds().length,
        renderedNodeBoundCount: api.canvas.viewport().renderedNodeBounds.length,
        rendererSvgCount: document.querySelectorAll("[role='group'][aria-label='Fig editor viewport surface'] svg[aria-hidden='true']").length,
      };
    }),
  ]);
  const metrics = webGLSurfaces.flatMap((surface) => {
    if (surface.metrics === undefined) {
      return [];
    }
    return [surface.metrics];
  });
  return {
    ...domStats,
    viewportWebGLSurfaceCount: webGLSurfaces.filter((surface) => surface.kind === "viewport").length,
    webglCanvasCount: webGLSurfaces.length,
    webglLoadingCount: webGLSurfaces.filter((surface) => !surface.ready).length,
    webglSurfaceCanvasSizes: webGLSurfaces.map((surface) => ({ width: surface.canvasWidth, height: surface.canvasHeight })),
    webglSurfaceKiwiDocumentMutationRevisions: webGLSurfaces.map((surface) => surface.kiwiDocumentMutationRevision),
    webglSurfaceKiwiDocumentMutationChangedGuidKeys: webGLSurfaces.map((surface) => surface.kiwiDocumentMutationChangedGuidKeys),
    webglControllerInputRevision: webGLSurfaces.reduce((sum, surface) => sum + surface.controllerInputRevision, 0),
    webglControllerInputSceneViewports: webGLSurfaces.map((surface) => surface.controllerInputSceneViewport),
    webglControllerInputKiwiDocumentMutationRevisions: webGLSurfaces.map((surface) => surface.controllerInputKiwiDocumentMutationRevision),
    webglControllerInputKiwiDocumentMutationChangedGuidKeys: webGLSurfaces.map((surface) => surface.controllerInputKiwiDocumentMutationChangedGuidKeys),
    webglRenderRevision: webGLSurfaces.reduce((sum, surface) => sum + surface.renderRevision, 0),
    webglLastRenderedSceneViewports: webGLSurfaces.map((surface) => surface.lastRenderedSceneViewport),
    webglLastRenderedKiwiDocumentMutationRevisions: webGLSurfaces.map((surface) => surface.lastRenderedKiwiDocumentMutationRevision),
    webglLastRenderedKiwiDocumentMutationChangedGuidKeys: webGLSurfaces.map((surface) => surface.lastRenderedKiwiDocumentMutationChangedGuidKeys),
    webglMetricsRevision: webGLSurfaces.reduce((sum, surface) => sum + surface.metricsRevision, 0),
    webglPrepareCount: metrics.reduce((sum, metric) => sum + metric.prepareCount, 0),
    webglRenderCount: metrics.reduce((sum, metric) => sum + metric.renderCount, 0),
    webglLastPrepareMsMax: Math.max(0, ...metrics.map((metric) => metric.lastPrepareMs)),
    webglLastRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastRenderMs)),
    webglLastRenderTreeResolveMsMax: Math.max(0, ...metrics.map((metric) => metric.lastRenderTreeResolveMs)),
    webglLastNodeTraversalMsMax: Math.max(0, ...metrics.map((metric) => metric.lastNodeTraversalMs)),
    webglLastSettledFrameCacheCaptureMsMax: Math.max(0, ...metrics.map((metric) => metric.lastSettledFrameCacheCaptureMs)),
    webglLastSettledFrameCacheRestoreMsMax: Math.max(0, ...metrics.map((metric) => metric.lastSettledFrameCacheRestoreMs)),
    webglLastSettledFrameCacheRegionCopyMsMax: Math.max(0, ...metrics.map((metric) => metric.lastSettledFrameCacheRegionCopyMs)),
    webglLastRenderFrameReasons: metrics.map((metric) => metric.lastRenderFrameReason),
    webglLastRenderedNodeCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedNodeCount, 0),
    webglLastRenderedGroupCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedGroupCount, 0),
    webglLastRenderedFrameCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedFrameCount, 0),
    webglLastRenderedRectCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedRectCount, 0),
    webglLastRenderedEllipseCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedEllipseCount, 0),
    webglLastRenderedPathCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedPathCount, 0),
    webglLastRenderedTextCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedTextCount, 0),
    webglLastRenderedImageCount: metrics.reduce((sum, metric) => sum + metric.lastRenderedImageCount, 0),
    webglLastViewportSkippedNodeCount: metrics.reduce((sum, metric) => sum + metric.lastViewportSkippedNodeCount, 0),
    webglLastViewportSkippedSubtreeCount: metrics.reduce((sum, metric) => sum + metric.lastViewportSkippedSubtreeCount, 0),
    webglLastEffectNodeCount: metrics.reduce((sum, metric) => sum + metric.lastEffectNodeCount, 0),
    webglLastLayerBlurNodeCount: metrics.reduce((sum, metric) => sum + metric.lastLayerBlurNodeCount, 0),
    webglLastGroupOpacityNodeCount: metrics.reduce((sum, metric) => sum + metric.lastGroupOpacityNodeCount, 0),
    webglLastInheritedGroupOpacityNodeCount: metrics.reduce((sum, metric) => sum + metric.lastInheritedGroupOpacityNodeCount, 0),
    webglLastImageDrawCount: metrics.reduce((sum, metric) => sum + metric.lastImageDrawCount, 0),
    webglLastImageFillDrawCount: metrics.reduce((sum, metric) => sum + metric.lastImageFillDrawCount, 0),
    webglLastImageNodeDrawCount: metrics.reduce((sum, metric) => sum + metric.lastImageNodeDrawCount, 0),
    webglLastTextGlyphRunDrawCount: metrics.reduce((sum, metric) => sum + metric.lastTextGlyphRunDrawCount, 0),
    webglLastClipStencilFlushCount: metrics.reduce((sum, metric) => sum + metric.lastClipStencilFlushCount, 0),
    webglLastClipStencilFlushMsMax: Math.max(0, ...metrics.map((metric) => metric.lastClipStencilFlushMs)),
    webglLastShapeRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastShapeRenderMs)),
    webglLastPathRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastPathRenderMs)),
    webglLastTextRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastTextRenderMs)),
    webglLastImageRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastImageRenderMs)),
    webglLastEffectRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastEffectRenderMs)),
    webglLastBackgroundBlurRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastBackgroundBlurRenderMs)),
    webglLastDropShadowRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastDropShadowRenderMs)),
    webglLastInnerShadowRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastInnerShadowRenderMs)),
    webglLastEffectContentRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastEffectContentRenderMs)),
    webglLastEffectStrokeRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastEffectStrokeRenderMs)),
    webglLastGroupOpacityRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastGroupOpacityRenderMs)),
    webglLastLayerBlurRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastLayerBlurRenderMs)),
    webglLastBackgroundBlurPassCount: metrics.reduce((sum, metric) => sum + metric.lastBackgroundBlurPassCount, 0),
    webglLastDropShadowPassCount: metrics.reduce((sum, metric) => sum + metric.lastDropShadowPassCount, 0),
    webglLastInnerShadowPassCount: metrics.reduce((sum, metric) => sum + metric.lastInnerShadowPassCount, 0),
    webglLastInnerShadowBlurSourceCount: metrics.reduce(
      (sum, metric) => sum + metric.lastInnerShadowBlurSourceCount,
      0,
    ),
    webglLastEffectRegionCount: metrics.reduce((sum, metric) => sum + metric.lastEffectRegionCount, 0),
    webglLastEffectRegionPixelCount: metrics.reduce((sum, metric) => sum + metric.lastEffectRegionPixelCount, 0),
    webglLastMaxEffectRegionPixelCount: Math.max(0, ...metrics.map((metric) => metric.lastMaxEffectRegionPixelCount)),
    webglLastEffectCaptureRegionCount: metrics.reduce((sum, metric) => sum + metric.lastEffectCaptureRegionCount, 0),
    webglLastEffectCaptureRegionPixelCount: metrics.reduce(
      (sum, metric) => sum + metric.lastEffectCaptureRegionPixelCount,
      0,
    ),
    webglLastMaxEffectCaptureRegionPixelCount: Math.max(
      0,
      ...metrics.map((metric) => metric.lastMaxEffectCaptureRegionPixelCount),
    ),
    webglLastBrowserBlendCaptureRegionPixelCount: metrics.reduce(
      (sum, metric) => sum + metric.lastBrowserBlendCaptureRegionPixelCount,
      0,
    ),
    webglLastGroupOpacityCaptureRegionPixelCount: metrics.reduce(
      (sum, metric) => sum + metric.lastGroupOpacityCaptureRegionPixelCount,
      0,
    ),
    webglLastLayerBlurCaptureRegionPixelCount: metrics.reduce(
      (sum, metric) => sum + metric.lastLayerBlurCaptureRegionPixelCount,
      0,
    ),
    webglLastPrepareStaticVertexBufferCreationCount: metrics.reduce((sum, metric) => sum + metric.lastPrepareStaticVertexBufferCreationCount, 0),
    webglLastPrepareStaticVertexBufferUploadByteLength: metrics.reduce((sum, metric) => sum + metric.lastPrepareStaticVertexBufferUploadByteLength, 0),
    webglLastPrepareStaticVertexBufferReleaseCount: metrics.reduce((sum, metric) => sum + metric.lastPrepareStaticVertexBufferReleaseCount, 0),
    webglLastRenderDynamicVertexBufferBindCount: metrics.reduce((sum, metric) => sum + metric.lastRenderDynamicVertexBufferBindCount, 0),
    webglLastRenderDynamicVertexBufferUploadCount: metrics.reduce((sum, metric) => sum + metric.lastRenderDynamicVertexBufferUploadCount, 0),
    webglLastRenderDynamicVertexBufferUploadByteLength: metrics.reduce((sum, metric) => sum + metric.lastRenderDynamicVertexBufferUploadByteLength, 0),
    webglLastRenderStaticVertexBufferBindCount: metrics.reduce((sum, metric) => sum + metric.lastRenderStaticVertexBufferBindCount, 0),
    webglLastRenderStaticVertexBufferCreationCount: metrics.reduce((sum, metric) => sum + metric.lastRenderStaticVertexBufferCreationCount, 0),
    webglLastRenderStaticVertexBufferUploadByteLength: metrics.reduce((sum, metric) => sum + metric.lastRenderStaticVertexBufferUploadByteLength, 0),
    webglLastRenderStaticVertexBufferReleaseCount: metrics.reduce((sum, metric) => sum + metric.lastRenderStaticVertexBufferReleaseCount, 0),
    webglLastRenderStaticVertexBufferCount: metrics.reduce((sum, metric) => sum + metric.lastRenderStaticVertexBufferCount, 0),
    webglLastVisibleTexturePreparationCount: metrics.reduce((sum, metric) => sum + metric.lastVisibleTexturePreparationCount, 0),
    webglLastMissingVisibleTexturePreparationCount: metrics.reduce((sum, metric) => sum + metric.lastMissingVisibleTexturePreparationCount, 0),
    webglLastTextureUploadCount: metrics.reduce((sum, metric) => sum + metric.lastTextureUploadCount, 0),
    webglSettledRenderCount: metrics.reduce((sum, metric) => sum + metric.settledRenderCount, 0),
    webglLastSettledRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastSettledRenderMs)),
    webglViewportMotionRenderCount: metrics.reduce((sum, metric) => sum + metric.viewportMotionRenderCount, 0),
    webglViewportMotionScaledBlitCount: metrics.reduce((sum, metric) => sum + metric.viewportMotionScaledBlitCount, 0),
    webglCommittedContentRegionRedrawCount: metrics.reduce((sum, metric) => sum + metric.committedContentRegionRedrawCount, 0),
    webglLastViewportMotionRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastViewportMotionRenderMs)),
    webglLastViewportMotionRenderedNodeCount: metrics.reduce((sum, metric) => sum + metric.lastViewportMotionRenderedNodeCount, 0),
    webglLastViewportMotionEffectNodeCount: metrics.reduce((sum, metric) => sum + metric.lastViewportMotionEffectNodeCount, 0),
    webglLastViewportMotionLayerBlurNodeCount: metrics.reduce((sum, metric) => sum + metric.lastViewportMotionLayerBlurNodeCount, 0),
    webglLastViewportMotionGroupOpacityNodeCount: metrics.reduce((sum, metric) => sum + metric.lastViewportMotionGroupOpacityNodeCount, 0),
    webglLastViewportMotionInheritedGroupOpacityNodeCount: metrics.reduce((sum, metric) => sum + metric.lastViewportMotionInheritedGroupOpacityNodeCount, 0),
    webglLastViewportMotionClipStencilFlushCount: metrics.reduce((sum, metric) => sum + metric.lastViewportMotionClipStencilFlushCount, 0),
    webglLastViewportMotionClipStencilFlushMsMax: Math.max(0, ...metrics.map((metric) => metric.lastViewportMotionClipStencilFlushMs)),
    webglSceneGraphInteractionRenderCount: metrics.reduce((sum, metric) => sum + metric.sceneGraphInteractionRenderCount, 0),
    webglLastSceneGraphInteractionRenderMsMax: Math.max(0, ...metrics.map((metric) => metric.lastSceneGraphInteractionRenderMs)),
    webglLastSceneGraphInteractionRenderedNodeCount: metrics.reduce((sum, metric) => sum + metric.lastSceneGraphInteractionRenderedNodeCount, 0),
    webglLastSceneGraphInteractionEffectNodeCount: metrics.reduce((sum, metric) => sum + metric.lastSceneGraphInteractionEffectNodeCount, 0),
    webglLastSceneGraphInteractionLayerBlurNodeCount: metrics.reduce((sum, metric) => sum + metric.lastSceneGraphInteractionLayerBlurNodeCount, 0),
    webglLastSceneGraphInteractionGroupOpacityNodeCount: metrics.reduce((sum, metric) => sum + metric.lastSceneGraphInteractionGroupOpacityNodeCount, 0),
    webglLastSceneGraphInteractionInheritedGroupOpacityNodeCount: metrics.reduce((sum, metric) => sum + metric.lastSceneGraphInteractionInheritedGroupOpacityNodeCount, 0),
    webglLastSceneGraphInteractionClipStencilFlushCount: metrics.reduce((sum, metric) => sum + metric.lastSceneGraphInteractionClipStencilFlushCount, 0),
    webglLastSceneGraphInteractionClipStencilFlushMsMax: Math.max(0, ...metrics.map((metric) => metric.lastSceneGraphInteractionClipStencilFlushMs)),
  };
}

function routeParams(renderer: "svg" | "webgl"): URLSearchParams {
  if (SOURCE_BACKED_PAIR === undefined) {
    throw new Error("source-backed pair not discovered");
  }
  return new URLSearchParams({
    renderer,
    panel: "all",
    fontMode: "browser-real",
    figUrl: fileUrl(resolveFixture(SOURCE_BACKED_PAIR.primary)),
    sourceUrl: fileUrl(resolveFixture(SOURCE_BACKED_PAIR.source)),
  });
}

function fileUrl(path: string): string {
  return `/@fs${path}`;
}

async function attachMetrics(testInfo: TestInfo, metrics: PerformanceMetrics): Promise<void> {
  const body = JSON.stringify(metrics, null, 2);
  writeFileSync(testInfo.outputPath("performance-metrics.json"), body);
  await testInfo.attach("performance-metrics.json", { body, contentType: "application/json" });
}
