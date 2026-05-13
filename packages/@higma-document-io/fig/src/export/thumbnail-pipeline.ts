/**
 * @file Thumbnail rendering pipeline for fig export.
 *
 * Figma's editor stores a "Set as thumbnail" pointer on the DOCUMENT
 * NodeChange (Kiwi field `thumbnailInfo: { nodeID, thumbnailVersion }`).
 * Our domain surfaces it as `FigDesignDocument.thumbnailTarget`.
 *
 * When that pointer is set, the exporter must rasterise the target
 * frame into `thumbnail.png` and update the matching `client_meta`
 * fields (`thumbnail_size` + `render_coordinates`) so the .fig opens
 * with the user-chosen cover instead of a stale snapshot.
 *
 * Rasterisation requires platform-specific bytes (resvg-js in Node,
 * an OffscreenCanvas pipeline in browsers, …). This module therefore
 * does **not** ship a default renderer — callers inject one via
 * `FigExportOptions.renderThumbnail`. See AGENTS.md ("No Magic Policy"
 * / "Fail-Fast"): we never invent a fallback that silently degrades.
 */

import { isPng } from "@higma-codecs/png";
import type { FigPackageMetadata } from "@higma-figma-containers/package";
import type {
  FigDesignDocument,
  FigDesignNode,
  FigPageId,
  FigThumbnailTarget,
} from "@higma-document-models/fig/domain";
import { parseId } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";

// =============================================================================
// Types
// =============================================================================

/**
 * Canvas-space axis-aligned bounding box of the target node. Figma
 * records the same shape in `meta.json` → `client_meta.render_coordinates`,
 * so the renderer receives bounds already in the SoT's units.
 */
export type FigCanvasBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type FigThumbnailRenderRequest = {
  /** The document being exported — gives the renderer access to images, blobs, components. */
  readonly document: FigDesignDocument;
  /** The page that contains `target`. */
  readonly pageId: FigPageId;
  /** The frame the user picked via "Set as thumbnail". */
  readonly target: FigDesignNode;
  /** Canvas-space bounds of `target` (already accounts for the target's transform). */
  readonly canvasBounds: FigCanvasBounds;
  /**
   * Maximum PNG width or height in pixels — the larger axis is clamped
   * here, preserving aspect ratio. Figma exports cap at 400.
   */
  readonly maxDimension: number;
};

export type FigThumbnailRenderResult = {
  /** PNG bytes. Must begin with the PNG magic — exporter does not validate further. */
  readonly png: Uint8Array;
  /** Actual rendered PNG dimensions (after aspect-preserving clamp). */
  readonly thumbnailSize: { readonly width: number; readonly height: number };
  /**
   * Canvas-space rectangle covered by the rendered PNG. When omitted,
   * the exporter writes `canvasBounds` from the request. Override only
   * when the renderer expanded/cropped the source rectangle.
   */
  readonly renderCoordinates?: FigCanvasBounds;
};

export type FigThumbnailRenderer = (
  request: FigThumbnailRenderRequest,
) => Promise<FigThumbnailRenderResult>;

/** Output of `prepareExportThumbnail` — the bits the exporter needs to inject. */
export type FigPreparedThumbnail = {
  readonly png: Uint8Array;
  readonly thumbnailSize: { readonly width: number; readonly height: number };
  readonly renderCoordinates: FigCanvasBounds;
};

// =============================================================================
// Node lookup
// =============================================================================

function nodeIdMatchesGuid(node: FigDesignNode, guid: FigGuid): boolean {
  const { sessionID, localID } = parseId(node.id);
  return sessionID === guid.sessionID && localID === guid.localID;
}

type FoundNode = {
  readonly node: FigDesignNode;
  readonly pageId: FigPageId;
  /** Parent chain from canvas-root down to `node`, used for bounds composition. */
  readonly ancestors: readonly FigDesignNode[];
};

function findInChildren(
  children: readonly FigDesignNode[],
  guid: FigGuid,
  pageId: FigPageId,
  ancestors: readonly FigDesignNode[],
): FoundNode | undefined {
  for (const child of children) {
    if (nodeIdMatchesGuid(child, guid)) {
      return { node: child, pageId, ancestors };
    }
    const grand = child.children;
    if (grand && grand.length > 0) {
      const hit = findInChildren(grand, guid, pageId, [...ancestors, child]);
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

function findThumbnailTargetNode(
  doc: FigDesignDocument,
  target: FigThumbnailTarget,
): FoundNode {
  for (const page of doc.pages) {
    const hit = findInChildren(page.children, target.nodeID, page.id, []);
    if (hit) {
      return hit;
    }
  }
  // Last-chance: a thumbnailTarget pointing at a SYMBOL definition (not on any page).
  for (const [, symbol] of doc.components) {
    if (nodeIdMatchesGuid(symbol, target.nodeID)) {
      throw new Error(
        `prepareExportThumbnail: thumbnailTarget points at SYMBOL definition ` +
          `"${symbol.name}" (id=${symbol.id}), which has no canvas position to render. ` +
          `Re-target an INSTANCE or FRAME on a CANVAS.`,
      );
    }
  }
  const idStr = `${target.nodeID.sessionID}:${target.nodeID.localID}`;
  throw new Error(
    `prepareExportThumbnail: thumbnailTarget.nodeID=${idStr} not found in any page. ` +
      `The "Set as thumbnail" pointer is stale; either re-pick a frame in the editor ` +
      `or clear FigDesignDocument.thumbnailTarget before export.`,
  );
}

// =============================================================================
// Bounds composition
// =============================================================================

/**
 * Compose ancestor transforms with the target's transform to derive a
 * canvas-space axis-aligned bbox. Only translation + scale are composed
 * (rotation/skew are rare for thumbnail-marked frames and would require
 * a full corner-walk — out of scope until a real case appears).
 */
function composeCanvasBounds(found: FoundNode): FigCanvasBounds {
  const composeOffsetX = (acc: number, n: FigDesignNode): number => acc + n.transform.m02;
  const composeOffsetY = (acc: number, n: FigDesignNode): number => acc + n.transform.m12;
  const offsetX = found.ancestors.reduce(composeOffsetX, 0) + found.node.transform.m02;
  const offsetY = found.ancestors.reduce(composeOffsetY, 0) + found.node.transform.m12;
  return {
    x: offsetX,
    y: offsetY,
    width: found.node.size.x,
    height: found.node.size.y,
  };
}

// =============================================================================
// Metadata patch
// =============================================================================

/**
 * Merge fresh thumbnail dimensions into a `client_meta` block, leaving
 * the rest of metadata (background color, file name, exported_at, raw
 * unknown fields) untouched.
 */
export function patchMetadataForThumbnail(
  base: FigPackageMetadata | null,
  thumb: FigPreparedThumbnail,
): FigPackageMetadata {
  const clientMeta = mergeClientMetaForThumbnail(base?.clientMeta, thumb);
  return {
    raw: base?.raw ?? {},
    rawKeys: base?.rawKeys ?? [],
    clientMeta,
    fileName: base?.fileName,
    developerRelatedLinks: base?.developerRelatedLinks,
    exportedAt: base?.exportedAt,
  };
}

function mergeClientMetaForThumbnail(
  existing: FigPackageMetadata["clientMeta"],
  thumb: FigPreparedThumbnail,
): NonNullable<FigPackageMetadata["clientMeta"]> {
  const next: { -readonly [K in keyof NonNullable<FigPackageMetadata["clientMeta"]>]?: NonNullable<FigPackageMetadata["clientMeta"]>[K] } = {
    thumbnailSize: thumb.thumbnailSize,
    renderCoordinates: thumb.renderCoordinates,
  };
  if (existing?.backgroundColor !== undefined) {
    next.backgroundColor = existing.backgroundColor;
  }
  return next;
}

// =============================================================================
// Public entry
// =============================================================================

/**
 * Render the document's "Set as thumbnail" target if one is set.
 *
 * Returns `undefined` when no target exists — callers should preserve
 * whatever thumbnail bytes the loaded file already carries.
 *
 * Throws when:
 *  - the target nodeID resolves to a missing or non-canvas node
 *  - `renderThumbnail` is missing despite a target being set
 *  - the renderer returns malformed bytes (not PNG magic)
 *
 * The exporter wraps the result into `saveFigFile`'s `thumbnail` option
 * and a patched `metadata`. This function never mutates the document.
 */
export async function prepareExportThumbnail(
  doc: FigDesignDocument,
  renderer: FigThumbnailRenderer | undefined,
  maxDimension: number,
): Promise<FigPreparedThumbnail | undefined> {
  const target = doc.thumbnailTarget;
  if (!target) {
    return undefined;
  }
  if (!renderer) {
    throw new Error(
      `prepareExportThumbnail: doc.thumbnailTarget is set but FigExportOptions.renderThumbnail ` +
        `was not provided. The exporter never auto-rasterises — supply a renderer ` +
        `(see @higma-document-renderers/fig/svg + resvg-js for a reference Node-side wiring).`,
    );
  }
  const found = findThumbnailTargetNode(doc, target);
  const canvasBounds = composeCanvasBounds(found);
  if (!(canvasBounds.width > 0) || !(canvasBounds.height > 0)) {
    throw new Error(
      `prepareExportThumbnail: thumbnailTarget node "${found.node.name}" (id=${found.node.id}) ` +
        `has non-positive size ${canvasBounds.width}x${canvasBounds.height}; cannot rasterise.`,
    );
  }
  if (!(maxDimension > 0)) {
    throw new Error(
      `prepareExportThumbnail: maxDimension must be > 0; got ${maxDimension}`,
    );
  }
  const result = await renderer({
    document: doc,
    pageId: found.pageId,
    target: found.node,
    canvasBounds,
    maxDimension,
  });
  if (!isPng(result.png)) {
    // `isPng` covers both "too short" and "wrong magic" — see
    // `@higma-codecs/png/detector`. Surface the original payload size
    // in the message so the call site knows whether the renderer
    // returned an empty buffer or just the wrong bytes.
    throw new Error(
      `renderThumbnail returned ${result.png.length}-byte payload for "${found.node.name}" ` +
        `that does not begin with the PNG magic; fig-lint's fig.zip.thumbnail rule would reject the export.`,
    );
  }
  if (!(result.thumbnailSize.width > 0) || !(result.thumbnailSize.height > 0)) {
    throw new Error(
      `renderThumbnail returned non-positive thumbnailSize ` +
        `${result.thumbnailSize.width}x${result.thumbnailSize.height}`,
    );
  }
  return {
    png: result.png,
    thumbnailSize: result.thumbnailSize,
    renderCoordinates: result.renderCoordinates ?? canvasBounds,
  };
}
