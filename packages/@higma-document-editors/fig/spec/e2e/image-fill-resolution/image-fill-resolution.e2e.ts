/** @file Browser regression coverage for fig image asset resolution. */

import { expect, test, type Page } from "@playwright/test";
import { readPng } from "@higma-codecs/png";
import {
  figEditorWebGLSurfaces,
  figEditorNodeViewportPointByGuid,
  openEditorWithFigEditorOperationSurface,
  waitForFigEditorWebGLSurfacesSettled,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";
import type { FigEditorOperationSurfaceGlobalThis } from "../../../src/operation-surface/fig-editor-operation-surface-types";

const IMAGE_FILL_RECT_GUID_KEY = "1:23";
const IMAGE_TEXTURE_CACHE_CONTROL_NAME = "Image Fill Texture Cache Control";

test.describe("Fig editor image fill resolution", () => {
  test("renders image fills from the document image map in SVG renderer", async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=svg");

    await expect.poll(() => renderedSvgMarkup(page)).toContain("data:image/png;base64,");
  });

  test("renders image fills in the WebGL viewport canvas", async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=webgl");

    await expect.poll(() => nonWhiteScreenshotPixelCountInNode(page, IMAGE_FILL_RECT_GUID_KEY)).toBeGreaterThan(0);
  });

  test("uploads only the newly referenced image texture after one image paint asset change in WebGL", async ({ page }) => {
    await openEditorWithFigEditorOperationSurface(page, "?renderer=webgl");
    await waitForFigEditorWebGLSurfacesSettled(page);
    await addImageFillTextureCacheControlNode(page);
    await waitForFigEditorWebGLSurfacesSettled(page);

    const replacementBytes = await createBrowserPngBytes(page, "#00ff00");
    await page.evaluate(({ targetGuidKey, data }) => {
      const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
      if (api === undefined) {
        throw new Error("globalThis.higmaFigEditor is not published");
      }
      api.image.setNodePaintAsset(targetGuidKey, {
        paintListKind: "fill",
        paintIndex: 0,
        data: new Uint8Array(data),
        mimeType: "image/png",
        fileName: "replacement-texture.png",
      });
    }, { targetGuidKey: IMAGE_FILL_RECT_GUID_KEY, data: replacementBytes });

    await expect.poll(() => webGLTextureUploadStatsForGuid(page, IMAGE_FILL_RECT_GUID_KEY), { timeout: 15_000 }).toEqual({
      changedGuidRendered: true,
      viewportSurfaceCount: 1,
      visibleTexturePreparationCountAtLeastTwo: true,
      missingTexturePreparationCount: 1,
      textureUploadCount: 1,
    });
  });
});

type WebGLTextureUploadStats = {
  readonly changedGuidRendered: boolean;
  readonly viewportSurfaceCount: number;
  readonly visibleTexturePreparationCountAtLeastTwo: boolean;
  readonly missingTexturePreparationCount: number;
  readonly textureUploadCount: number;
};

async function webGLTextureUploadStatsForGuid(
  page: Page,
  guidKey: string,
): Promise<WebGLTextureUploadStats> {
  const viewportSurfaces = (await figEditorWebGLSurfaces(page)).filter((surface) => surface.kind === "viewport");
  return {
    changedGuidRendered: viewportSurfaces.every((surface) => surface.lastRenderedKiwiDocumentMutationChangedGuidKeys.includes(guidKey)),
    viewportSurfaceCount: viewportSurfaces.length,
    visibleTexturePreparationCountAtLeastTwo: viewportSurfaces.every((surface) => (surface.metrics?.lastVisibleTexturePreparationCount ?? 0) >= 2),
    missingTexturePreparationCount: viewportSurfaces.reduce((sum, surface) => sum + (surface.metrics?.lastMissingVisibleTexturePreparationCount ?? 0), 0),
    textureUploadCount: viewportSurfaces.reduce((sum, surface) => sum + (surface.metrics?.lastTextureUploadCount ?? 0), 0),
  };
}

async function addImageFillTextureCacheControlNode(page: Page): Promise<void> {
  await page.evaluate(({ sourceGuidKey, controlName }) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const source = api.document.requireNode(sourceGuidKey).node;
    const fills = source.fillPaints;
    if (fills === undefined || fills.length === 0) {
      throw new Error("Image texture cache control node requires source image fillPaints");
    }
    api.node.createOnActivePage({
      type: "ROUNDED_RECTANGLE",
      name: controlName,
      x: 1080,
      y: 310,
      width: 90,
      height: 70,
      fills,
    });
  }, { sourceGuidKey: IMAGE_FILL_RECT_GUID_KEY, controlName: IMAGE_TEXTURE_CACHE_CONTROL_NAME });
}

async function createBrowserPngBytes(page: Page, fillStyle: string): Promise<readonly number[]> {
  return page.evaluate((targetFillStyle) => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("createBrowserPngBytes requires a 2D canvas context");
    }
    context.fillStyle = targetFillStyle;
    context.fillRect(0, 0, 2, 2);
    const encoded = canvas.toDataURL("image/png").split(",")[1];
    if (encoded === undefined) {
      throw new Error("createBrowserPngBytes requires canvas PNG data");
    }
    const binary = atob(encoded);
    return Array.from(binary, (character) => character.charCodeAt(0));
  }, fillStyle);
}

async function renderedSvgMarkup(page: Page): Promise<string> {
  return page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>("svg[aria-hidden='true']"));
    if (svgs.length === 0) {
      throw new Error("Rendered SVG trees were not found");
    }
    return svgs.map((svg) => svg.outerHTML).join("\n");
  });
}

async function nonWhiteScreenshotPixelCountInNode(
  page: Page,
  guidKey: string,
): Promise<number> {
  const center = await figEditorNodeViewportPointByGuid(page, guidKey, { x: 0.5, y: 0.5 });
  const canvasBox = await page.locator("canvas").boundingBox();
  if (canvasBox === null) {
    throw new Error("WebGL canvas bounding box was not available");
  }
  const sampleOffsets = [-12, -6, 0, 6, 12];
  const samples = await Promise.all(sampleOffsets.flatMap((offsetX) => {
    return sampleOffsets.map(async (offsetY) => {
      const png = readPng(await page.screenshot({
        clip: {
          x: Math.floor(canvasBox.x + center.viewportX + offsetX),
          y: Math.floor(canvasBox.y + center.viewportY + offsetY),
          width: 1,
          height: 1,
        },
      }));
      const pixel = png.data;
      const isOpaque = (pixel[3] ?? 0) > 200;
      const isWhite = (pixel[0] ?? 0) > 245 && (pixel[1] ?? 0) > 245 && (pixel[2] ?? 0) > 245;
      if (isOpaque && !isWhite) {
        return 1;
      }
      return 0;
    });
  }));
  return samples.reduce((sum, value) => sum + value, 0);
}
