/**
 * @file Node-side thumbnail renderer wiring for `exportFig`.
 *
 * Bridges the io package's `FigThumbnailRenderer` DI hook (defined in
 * `@higma-document-io/fig/export`) to this package's SVG renderer +
 * `@resvg/resvg-js` for PNG output.
 *
 * The io package deliberately does not bundle this — its
 * `FigExportOptions.renderThumbnail` is a DI seam precisely because
 * rasterisation is platform-specific (resvg-js is native, browsers use
 * OffscreenCanvas/WebGL). This module is the canonical Node-side
 * implementation; CLI tools and `bun test` runners should consume it
 * via `createNodeThumbnailRenderer`.
 *
 * Why the renderer lives here and not in io:
 *   - `@higma-document-renderers/fig` already depends on
 *     `@higma-document-io/fig` (it consumes `parseFigFile`,
 *     `createFigSymbolContext`, etc.). Putting the renderer in io and
 *     having io import this package would invert the dependency.
 *   - resvg-js is a native module; io must stay browser-compatible.
 */

import { Resvg } from "@resvg/resvg-js";
import { fitFigThumbnailSize } from "@higma-figma-containers/package";
import { documentToTree } from "@higma-document-io/fig/context";
import type {
  FigThumbnailRenderRequest,
  FigThumbnailRenderResult,
  FigThumbnailRenderer,
} from "@higma-document-io/fig/export";
import {
  buildNodeTree,
  guidToString,
  parseId,
} from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import type { FontLoader } from "@higma-document-models/fig/font";
import type { FigmaRenderExportSettings } from "../scene-graph/render";
import { renderFigToSvg } from "../svg/renderer";

// =============================================================================
// Options
// =============================================================================

export type CreateNodeThumbnailRendererOptions = {
  /**
   * Font loader used to rasterise TEXT nodes inside the thumbnail
   * target. Omit when callers know the target frame contains no TEXT
   * (the renderer throws otherwise — failing fast beats inventing a
   * default font, see AGENTS.md).
   */
  readonly fontLoader?: FontLoader;
  /**
   * Forwarded to the underlying `renderFigToSvg`. Required when the
   * thumbnail target contains color-managed image paints
   * (`imageShouldColorManage: true`); the renderer throws otherwise.
   * Typical Node-side value: `{ colorProfile: "SRGB" }`.
   */
  readonly exportSettings?: FigmaRenderExportSettings;
  /**
   * Optional override for the SVG-to-PNG rasteriser. Defaults to
   * `@resvg/resvg-js`. Pass a stub in tests that don't need real
   * pixels; CLI tools normally use the default.
   */
  readonly rasterise?: (svg: string, options: { width: number; height: number }) => Promise<Uint8Array>;
};

// =============================================================================
// Internal helpers
// =============================================================================

function defaultRasterise(
  svg: string,
  options: { width: number; height: number },
): Promise<Uint8Array> {
  // Resvg honours the SVG's own `width`/`height` attributes; we set
  // those to the target's pixel dimensions before rasterising so we
  // don't need a second resize step.
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: options.width },
    background: "rgba(255,255,255,0)",
  });
  const png = resvg.render().asPng();
  return Promise.resolve(new Uint8Array(png.buffer, png.byteOffset, png.byteLength));
}

/**
 * Find the raw FigNode (post-projection) whose GUID matches the
 * domain target. We project the document via `documentToTree` here so
 * edits made on the FigDesignDocument since load are reflected in the
 * thumbnail — using `_loaded.nodeChanges` directly would render the
 * pre-edit snapshot.
 */
function locateRawNode(
  request: FigThumbnailRenderRequest,
): { readonly raw: FigNode; readonly symbolMap: ReadonlyMap<string, FigNode>; readonly blobs: readonly { readonly bytes: readonly number[] }[] } {
  const { nodeChanges, blobs } = documentToTree(request.document);
  const tree = buildNodeTree(nodeChanges);
  const { sessionID, localID } = parseId(request.target.id);
  const key = guidToString({ sessionID, localID });
  const raw = tree.nodeMap.get(key);
  if (!raw) {
    throw new Error(
      `node-thumbnail-renderer: projected document does not contain target GUID ${key}; ` +
        `documentToTree(...) lost the node.`,
    );
  }
  return { raw, symbolMap: tree.nodeMap, blobs };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build a `FigThumbnailRenderer` suitable for passing into
 * `exportFig(doc, { renderThumbnail: ... })` in a Node environment.
 *
 * The renderer:
 *   1. Projects the document via `documentToTree` so the latest edits
 *      are picked up.
 *   2. Locates the target node by GUID in the projected nodeMap.
 *   3. Renders it as a self-contained SVG root (no parent transform).
 *   4. Pipes the SVG through resvg-js (or the override).
 *   5. Clamps PNG dimensions to `request.maxDimension`.
 */
export function createNodeThumbnailRenderer(
  options: CreateNodeThumbnailRendererOptions = {},
): FigThumbnailRenderer {
  const rasterise = options.rasterise ?? defaultRasterise;
  return async (request) => {
    const located = locateRawNode(request);
    const pngDimensions = fitFigThumbnailSize(request.canvasBounds, request.maxDimension);
    const svgResult = await renderFigToSvg([located.raw], {
      width: request.canvasBounds.width,
      height: request.canvasBounds.height,
      viewport: { x: 0, y: 0, width: request.canvasBounds.width, height: request.canvasBounds.height },
      normalizeRootTransform: true,
      blobs: located.blobs,
      images: request.document.images,
      symbolMap: located.symbolMap,
      ...(options.fontLoader ? { fontLoader: options.fontLoader } : {}),
      ...(options.exportSettings ? { exportSettings: options.exportSettings } : {}),
    });
    const png = await rasterise(svgResult.svg, pngDimensions);
    const result: FigThumbnailRenderResult = {
      png,
      thumbnailSize: pngDimensions,
      renderCoordinates: request.canvasBounds,
    };
    return result;
  };
}
