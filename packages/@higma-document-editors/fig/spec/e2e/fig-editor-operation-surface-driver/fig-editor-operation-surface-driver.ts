/** @file Playwright driver for the Fig editor Kiwi-backed operation surface. */

import { expect, type Page } from "@playwright/test";
import type {
  FigEditorOperationSurface,
  FigEditorOperationSurfaceGlobalThis,
  FigEditorOperationSurfaceCanvasHitSnapshot,
  FigEditorOperationSurfaceNodeBoundsSnapshot,
  FigEditorOperationSurfaceNodeQuery,
  FigEditorOperationSurfaceNodeViewportPoint,
  FigEditorOperationSurfaceNodeSnapshot,
} from "../../../src/operation-surface/fig-editor-operation-surface-types";
import type {
  FigEditorWebGLSurfaceSnapshot,
} from "../../../src/canvas/webgl/fig-editor-webgl-surface-state";

/** Wait until the Fig editor publishes its Kiwi-backed operation surface. */
export async function waitForFigEditorOperationSurface(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return Boolean((globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor);
  });
}

/** Open the E2E harness and wait for the Kiwi document API to become readable. */
export async function openEditorWithFigEditorOperationSurface(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await waitForFigEditorOperationSurface(page);
  await expect.poll(() => page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      return 0;
    }
    return api.document.snapshot().nodeCount;
  })).toBeGreaterThan(0);
}

/** Select one Kiwi node through the Fig editor operation surface. */
export async function selectFigEditorNodeByGuid(page: Page, guidKey: string): Promise<void> {
  await page.evaluate((targetGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.selection.select(targetGuidKey);
  }, guidKey);
}

/** Add one Kiwi node to the current Fig editor selection through selectNode semantics. */
export async function addFigEditorNodeToSelectionByGuid(page: Page, guidKey: string): Promise<void> {
  await page.evaluate((targetGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.selection.select(targetGuidKey, { additive: true });
  }, guidKey);
}

/** Replace the Fig editor selection with concrete Kiwi GUID keys. */
export async function setFigEditorSelectionByGuidKeys(
  page: Page,
  guidKeys: readonly string[],
): Promise<void> {
  await page.evaluate((targetGuidKeys) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.selection.set(targetGuidKeys);
  }, guidKeys);
}

/** Enter canvas text editing for one Kiwi TEXT node through the operation surface. */
export async function enterFigEditorTextEditByGuid(page: Page, guidKey: string): Promise<void> {
  await page.evaluate((targetGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.text.enterEdit(targetGuidKey);
  }, guidKey);
}

/** Set the Fig editor creation mode through the operation surface. */
export async function setFigEditorCreationMode(
  page: Page,
  mode: Parameters<FigEditorOperationSurface["creationMode"]["set"]>[0],
): Promise<void> {
  await page.evaluate((targetMode) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.creationMode.set(targetMode);
  }, mode);
}

/** Begin the selected FigNode drag transform state through the operation surface. */
export async function beginSelectedFigNodeDragTransformViaOperationSurface(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.canvasInteraction.beginSelectedFigNodeDragTransform();
  });
}

/** Translate one FigNode during an active selected FigNode drag transform. */
export async function translateFigNodeDuringSelectedFigNodeDragTransformViaOperationSurface(
  page: Page,
  guidKey: string,
  delta: { readonly dx: number; readonly dy: number },
): Promise<void> {
  await page.evaluate(({ targetGuidKey, dx, dy }) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransform(targetGuidKey, { dx, dy });
  }, { targetGuidKey: guidKey, dx: delta.dx, dy: delta.dy });
}

/** End the selected FigNode drag transform state through the operation surface. */
export async function endSelectedFigNodeDragTransformViaOperationSurface(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.canvasInteraction.endSelectedFigNodeDragTransform();
  });
}

/** Read one Kiwi node snapshot from the Fig editor operation surface. */
export async function figEditorNodeSnapshotByGuid(
  page: Page,
  guidKey: string,
): Promise<FigEditorOperationSurfaceNodeSnapshot> {
  return page.evaluate((targetGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.document.requireNode(targetGuidKey);
  }, guidKey);
}

/** Project one Kiwi node-relative ratio into the editor viewport surface. */
export async function figEditorNodeViewportPointByGuid(
  page: Page,
  guidKey: string,
  ratio: { readonly x: number; readonly y: number },
): Promise<FigEditorOperationSurfaceNodeViewportPoint> {
  return page.evaluate(({ targetGuidKey, targetRatio }) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.canvas.nodeViewportPoint(targetGuidKey, targetRatio);
  }, { targetGuidKey: guidKey, targetRatio: ratio });
}

/** Resolve the topmost Kiwi node at a viewport point through the operation surface. */
export async function figEditorRequireHitTestViewportPoint(
  page: Page,
  point: { readonly viewportX: number; readonly viewportY: number },
): Promise<FigEditorOperationSurfaceCanvasHitSnapshot> {
  return page.evaluate((targetPoint) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.canvas.requireHitTestViewportPoint(targetPoint);
  }, point);
}

/** Select the topmost Kiwi node at a viewport point through the operation surface. */
export async function figEditorRequireSelectNodeAtViewportPoint(
  page: Page,
  point: { readonly viewportX: number; readonly viewportY: number },
): Promise<FigEditorOperationSurfaceCanvasHitSnapshot> {
  return page.evaluate((targetPoint) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.canvas.requireSelectNodeAtViewportPoint(targetPoint);
  }, point);
}

/** Move one selected Kiwi node by viewport pixels during an active drag transform. */
export async function translateFigNodeDuringSelectedFigNodeDragTransformByViewportDeltaViaOperationSurface(
  page: Page,
  guidKey: string,
  delta: { readonly viewportDx: number; readonly viewportDy: number },
): Promise<void> {
  await page.evaluate(({ targetGuidKey, viewportDx, viewportDy }) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransformByViewportDelta(
      targetGuidKey,
      { viewportDx, viewportDy },
    );
  }, { targetGuidKey: guidKey, viewportDx: delta.viewportDx, viewportDy: delta.viewportDy });
}

/** Read all visible active-CANVAS renderer-derived node bounds from the operation surface. */
export async function figEditorVisibleNodeBounds(
  page: Page,
  query?: FigEditorOperationSurfaceNodeQuery,
): Promise<readonly FigEditorOperationSurfaceNodeBoundsSnapshot[]> {
  return page.evaluate((targetQuery) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.canvas.visibleNodeBounds(targetQuery);
  }, query);
}

/** Read all WebGL renderer surface states through the Fig editor operation surface. */
export async function figEditorWebGLSurfaces(
  page: Page,
): Promise<readonly FigEditorWebGLSurfaceSnapshot[]> {
  return page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.renderer.webGLSurfaces();
  });
}

/** Read one WebGL renderer surface state through the Fig editor operation surface. */
export async function figEditorWebGLSurfaceByKey(
  page: Page,
  surfaceKey: string,
): Promise<FigEditorWebGLSurfaceSnapshot> {
  return page.evaluate((targetSurfaceKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.renderer.requireWebGLSurface(targetSurfaceKey);
  }, surfaceKey);
}

/** Wait until every registered Fig editor WebGL surface has presented a ready settled frame. */
export async function waitForFigEditorWebGLSurfacesSettled(page: Page): Promise<void> {
  await expect.poll(async () => {
    const surfaces = await figEditorWebGLSurfaces(page);
    return surfaces.length > 0 &&
      surfaces.every((surface) => (
      surface.ready &&
      surface.metrics !== undefined &&
      surface.metrics.lastRenderFrameReason === "settled"
      ));
  }, { timeout: 45_000 }).toBe(true);
}
