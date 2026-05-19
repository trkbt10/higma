/** @file Thumbnail rendering pipeline for Kiwi fig export. */

import { isPng } from "@higma-codecs/png";
import type { FigPackageMetadata } from "@higma-figma-containers/package";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { getNodeType, guidToString, isFigGuid } from "@higma-document-models/fig/domain";
import type { FigDocumentContext } from "../context";

export type FigCanvasBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type FigThumbnailRenderRequest = {
  readonly context: FigDocumentContext;
  readonly page: FigNode;
  readonly target: FigNode;
  readonly canvasBounds: FigCanvasBounds;
  readonly maxDimension: number;
};

export type FigThumbnailRenderResult = {
  readonly png: Uint8Array;
  readonly thumbnailSize: { readonly width: number; readonly height: number };
  readonly renderCoordinates: FigCanvasBounds;
};

export type FigThumbnailRenderer = (
  request: FigThumbnailRenderRequest,
) => Promise<FigThumbnailRenderResult>;

export type FigPreparedThumbnail = {
  readonly png: Uint8Array;
  readonly thumbnailSize: { readonly width: number; readonly height: number };
  readonly renderCoordinates: FigCanvasBounds;
};

type FoundNode = {
  readonly node: FigNode;
  readonly page: FigNode;
  readonly ancestors: readonly FigNode[];
};

function readThumbnailTarget(context: FigDocumentContext): FigGuid | undefined {
  for (const root of context.document.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    const raw = root.thumbnailInfo;
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== "object") {
      throw new Error(`prepareExportThumbnail: DOCUMENT.thumbnailInfo must be an object; got ${typeof raw}`);
    }
    const nodeID = (raw as { readonly nodeID?: unknown }).nodeID;
    if (!isFigGuid(nodeID)) {
      throw new Error(`prepareExportThumbnail: DOCUMENT.thumbnailInfo.nodeID must be a FigGuid; got ${JSON.stringify(nodeID)}`);
    }
    return nodeID;
  }
  return undefined;
}

function requiredGuid(node: FigNode, owner: string): FigGuid {
  if (node.guid === undefined) {
    throw new Error(`prepareExportThumbnail: ${owner} is missing guid`);
  }
  return node.guid;
}

function parentOf(context: FigDocumentContext, node: FigNode): FigNode | undefined {
  const parentGuid = node.parentIndex?.guid;
  if (parentGuid === undefined) {
    return undefined;
  }
  return context.document.nodesByGuid.get(guidToString(parentGuid));
}

function findThumbnailTargetNode(context: FigDocumentContext, targetGuid: FigGuid): FoundNode {
  const target = context.document.nodesByGuid.get(guidToString(targetGuid));
  if (!target) {
    throw new Error(`prepareExportThumbnail: thumbnailInfo.nodeID=${guidToString(targetGuid)} was not found in nodeChanges`);
  }
  if (getNodeType(target) === "SYMBOL") {
    throw new Error(
      `prepareExportThumbnail: thumbnailInfo points at SYMBOL definition "${target.name ?? guidToString(targetGuid)}"; ` +
      `thumbnail targets must be positioned on a CANVAS`,
    );
  }

  return findCanvasAncestor(context, target, parentOf(context, target), []);
}

function findCanvasAncestor(
  context: FigDocumentContext,
  target: FigNode,
  current: FigNode | undefined,
  ancestors: readonly FigNode[],
): FoundNode {
  if (current === undefined) {
    throw new Error(`prepareExportThumbnail: target ${guidToString(requiredGuid(target, "target"))} is not under a CANVAS`);
  }
  if (getNodeType(current) === "CANVAS") {
    return { node: target, page: current, ancestors };
  }
  return findCanvasAncestor(context, target, parentOf(context, current), [current, ...ancestors]);
}

function requiredTransform(node: FigNode): NonNullable<FigNode["transform"]> {
  if (node.transform === undefined) {
    throw new Error(`prepareExportThumbnail: node "${node.name ?? guidToString(requiredGuid(node, "node"))}" is missing transform`);
  }
  return node.transform;
}

function requiredSize(node: FigNode): NonNullable<FigNode["size"]> {
  if (node.size === undefined) {
    throw new Error(`prepareExportThumbnail: node "${node.name ?? guidToString(requiredGuid(node, "node"))}" is missing size`);
  }
  return node.size;
}

function composeCanvasBounds(found: FoundNode): FigCanvasBounds {
  const composeOffsetX = (acc: number, node: FigNode): number => acc + requiredTransform(node).m02;
  const composeOffsetY = (acc: number, node: FigNode): number => acc + requiredTransform(node).m12;
  const targetTransform = requiredTransform(found.node);
  const targetSize = requiredSize(found.node);
  return {
    x: found.ancestors.reduce(composeOffsetX, 0) + targetTransform.m02,
    y: found.ancestors.reduce(composeOffsetY, 0) + targetTransform.m12,
    width: targetSize.x,
    height: targetSize.y,
  };
}

/**
 * Merge rendered thumbnail dimensions into package metadata.
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

/**
 * Render and package a thumbnail when the Kiwi document declares one.
 */
export async function prepareExportThumbnail(
  context: FigDocumentContext,
  renderer: FigThumbnailRenderer | undefined,
  maxDimension: number,
): Promise<FigPreparedThumbnail | undefined> {
  const targetGuid = readThumbnailTarget(context);
  if (targetGuid === undefined) {
    return undefined;
  }
  if (!renderer) {
    throw new Error(
      `prepareExportThumbnail: DOCUMENT.thumbnailInfo is set but FigExportOptions.renderThumbnail was not provided`,
    );
  }
  const found = findThumbnailTargetNode(context, targetGuid);
  const canvasBounds = composeCanvasBounds(found);
  if (!(canvasBounds.width > 0) || !(canvasBounds.height > 0)) {
    throw new Error(
      `prepareExportThumbnail: thumbnail target "${found.node.name ?? guidToString(targetGuid)}" ` +
      `has non-positive size ${canvasBounds.width}x${canvasBounds.height}`,
    );
  }
  if (!(maxDimension > 0)) {
    throw new Error(`prepareExportThumbnail: maxDimension must be > 0; got ${maxDimension}`);
  }
  const result = await renderer({
    context,
    page: found.page,
    target: found.node,
    canvasBounds,
    maxDimension,
  });
  if (!isPng(result.png)) {
    throw new Error(
      `renderThumbnail returned ${result.png.length}-byte payload for "${found.node.name ?? guidToString(targetGuid)}" ` +
      `that does not begin with the PNG magic`,
    );
  }
  if (!(result.thumbnailSize.width > 0) || !(result.thumbnailSize.height > 0)) {
    throw new Error(
      `renderThumbnail returned non-positive thumbnailSize ${result.thumbnailSize.width}x${result.thumbnailSize.height}`,
    );
  }
  if (result.renderCoordinates === undefined) {
    throw new Error("renderThumbnail must return explicit renderCoordinates");
  }
  if (!(result.renderCoordinates.width > 0) || !(result.renderCoordinates.height > 0)) {
    throw new Error(
      `renderThumbnail returned non-positive renderCoordinates ${result.renderCoordinates.width}x${result.renderCoordinates.height}`,
    );
  }
  return {
    png: result.png,
    thumbnailSize: result.thumbnailSize,
    renderCoordinates: result.renderCoordinates,
  };
}
