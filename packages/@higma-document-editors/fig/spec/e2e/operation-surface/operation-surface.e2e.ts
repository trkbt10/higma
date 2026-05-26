/** @file Operation surface operations against the Fig editor E2E harness. */

import { expect, test, type Page } from "@playwright/test";
import {
  beginSelectedFigNodeDragTransformViaOperationSurface,
  endSelectedFigNodeDragTransformViaOperationSurface,
  figEditorNodeViewportPointByGuid,
  figEditorRequireHitTestViewportPoint,
  figEditorRequireSelectNodeAtViewportPoint,
  figEditorWebGLSurfaces,
  openEditorWithFigEditorOperationSurface,
  translateFigNodeDuringSelectedFigNodeDragTransformByViewportDeltaViaOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";
import type { FigEditorOperationSurfaceGlobalThis } from "../../../src/operation-surface/fig-editor-operation-surface-types";

const RECTANGLE_GUID_KEY = "1:3";
const TEXT_GUID_KEY = "1:2";
const VECTOR_GUID_KEY = "1:6";

async function runOperationSurfaceMutation(page: Page): Promise<{
  readonly selectedGuidKeys: readonly string[];
  readonly rectangleX: number | undefined;
  readonly rectangleY: number | undefined;
  readonly rectangleOpacity: number | undefined;
  readonly text: string;
  readonly pathData: string | undefined;
  readonly activePageGuidKey: string;
  readonly pageGuidKeys: readonly string[];
  readonly addedPageName: string | undefined;
}> {
  return page.evaluate(({ rectangleGuidKey, textGuidKey, vectorGuidKey }) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.selection.select(rectangleGuidKey);
    api.node.translate(rectangleGuidKey, { dx: 5, dy: 7 });
    const movedRectangle = api.document.requireNode(rectangleGuidKey).node;
    api.node.replaceKiwiNode(rectangleGuidKey, { ...movedRectangle, opacity: 0.5 });
    api.text.setCharacters(textGuidKey, "Operation surface text");
    api.vectorPath.setData(vectorGuidKey, 0, "M 0 0 L 40 0 L 40 40 Z");
    const selectedGuidKeys = api.document.selectedNodes().map((node) => node.guidKey);
    const rectangle = api.document.requireNode(rectangleGuidKey).node;
    const vector = api.document.requireNode(vectorGuidKey).node;
    const addedPage = api.page.add("Operation surface Page");
    api.page.rename(addedPage.guidKey, "Operation surface Renamed Page");
    api.page.move(addedPage.guidKey, 0);
    return {
      selectedGuidKeys,
      rectangleX: rectangle.transform?.m02,
      rectangleY: rectangle.transform?.m12,
      rectangleOpacity: rectangle.opacity,
      text: api.text.readCharacters(textGuidKey),
      pathData: vector.vectorPaths?.[0]?.data,
      activePageGuidKey: api.document.activePage().guidKey,
      pageGuidKeys: api.document.pages().map((node) => node.guidKey),
      addedPageName: api.document.requireNode(addedPage.guidKey).name,
    };
  }, {
    rectangleGuidKey: RECTANGLE_GUID_KEY,
    textGuidKey: TEXT_GUID_KEY,
    vectorGuidKey: VECTOR_GUID_KEY,
  });
}

test.describe("fig editor operation surface", () => {
  [
    { renderer: "svg" },
    { renderer: "webgl" },
  ].forEach(({ renderer }) => {
    test(`mutates Kiwi document through operation surface in ${renderer} renderer`, async ({ page }) => {
      await openEditorWithFigEditorOperationSurface(page, `?renderer=${renderer}`);

      const result = await runOperationSurfaceMutation(page);

      expect(result.selectedGuidKeys).toEqual([RECTANGLE_GUID_KEY]);
      expect(result.rectangleX).toBe(55);
      expect(result.rectangleY).toBe(317);
      expect(result.rectangleOpacity).toBe(0.5);
      expect(result.text).toBe("Operation surface text");
      expect(result.pathData).toBe("M 0 0 L 40 0 L 40 40 Z");
      expect(result.activePageGuidKey).toBe(result.pageGuidKeys[0]);
      expect(result.addedPageName).toBe("Operation surface Renamed Page");
    });
  });

  [
    { renderer: "svg" },
    { renderer: "webgl" },
  ].forEach(({ renderer }) => {
    test(`selects and moves canvas nodes through Kiwi-backed viewport coordinates in ${renderer} renderer`, async ({ page }) => {
      await openEditorWithFigEditorOperationSurface(page, `?renderer=${renderer}`);

      const center = await figEditorNodeViewportPointByGuid(page, RECTANGLE_GUID_KEY, { x: 0.5, y: 0.5 });
      const selected = await figEditorRequireSelectNodeAtViewportPoint(page, {
        viewportX: center.viewportX,
        viewportY: center.viewportY,
      });

      expect(selected.node.guidKey).toBe(RECTANGLE_GUID_KEY);

      const beforeDrag = await page.evaluate((rectangleGuidKey) => {
        const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
        if (api === undefined) {
          throw new Error("globalThis.higmaFigEditor is not published");
        }
        return {
          node: api.document.requireNode(rectangleGuidKey).node,
          viewportScale: api.canvas.viewport().viewport.scale,
        };
      }, RECTANGLE_GUID_KEY);
      await beginSelectedFigNodeDragTransformViaOperationSurface(page);
      await translateFigNodeDuringSelectedFigNodeDragTransformByViewportDeltaViaOperationSurface(
        page,
        RECTANGLE_GUID_KEY,
        { viewportDx: 20, viewportDy: 8 },
      );
      await endSelectedFigNodeDragTransformViaOperationSurface(page);

      const moved = await page.evaluate((rectangleGuidKey) => {
        const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
        if (api === undefined) {
          throw new Error("globalThis.higmaFigEditor is not published");
        }
        return api.document.requireNode(rectangleGuidKey).node;
      }, RECTANGLE_GUID_KEY);

      expect(moved.transform?.m02).toBe((beforeDrag.node.transform?.m02 ?? 0) + 20 / beforeDrag.viewportScale);
      expect(moved.transform?.m12).toBe((beforeDrag.node.transform?.m12 ?? 0) + 8 / beforeDrag.viewportScale);
    });
  });

  test("reports WebGL renderer surfaces through the operation surface", async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=webgl");

    await expect.poll(async () => {
      const surfaces = await figEditorWebGLSurfaces(page);
      return surfaces.length === 1 &&
        surfaces[0]?.surfaceKey === "fig-editor-webgl-viewport" &&
        surfaces[0]?.kind === "viewport" &&
        surfaces[0]?.ready === true &&
        surfaces[0]?.metrics !== undefined;
    }).toBe(true);
  });

  test("resolves canvas hits from Kiwi bounds without DOM node access", async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=webgl");

    const center = await figEditorNodeViewportPointByGuid(page, RECTANGLE_GUID_KEY, { x: 0.5, y: 0.5 });
    const hit = await figEditorRequireHitTestViewportPoint(page, {
      viewportX: center.viewportX,
      viewportY: center.viewportY,
    });

    expect(hit.node.guidKey).toBe(RECTANGLE_GUID_KEY);
    expect(hit.bounds.guidKey).toBe(RECTANGLE_GUID_KEY);
  });
});
