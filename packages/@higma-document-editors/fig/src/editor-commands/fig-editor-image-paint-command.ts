/** @file Fig editor image paint commands shared by UI and operation surface automation. */
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { FigEditorContextValue, FigNodeMutationSource } from "../context/FigEditorContext";
import {
  paintList,
  replacePaint,
  setImageHashHex,
  writePaintList,
  type PaintListKind,
} from "../panels/sections/paint/paint-domain";

export type FigEditorImageAssetInput = {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly fileName: string;
};

export type FigEditorPaintImageAssetTarget = {
  readonly paintListKind: PaintListKind;
  readonly paintIndex: number;
};

export type FigEditorImageAssetCommitResult = {
  readonly ref: string;
  readonly mimeType: string;
  readonly byteLength: number;
};

export type CommitFigEditorNodePaintImageAssetParams = {
  readonly editor: FigEditorContextValue;
  readonly guid: FigGuid;
  readonly input: FigEditorImageAssetInput;
  readonly target: FigEditorPaintImageAssetTarget;
  readonly source: FigNodeMutationSource;
};

export type CommitFigEditorSelectedPaintImageAssetParams = {
  readonly editor: FigEditorContextValue;
  readonly input: FigEditorImageAssetInput;
  readonly target: FigEditorPaintImageAssetTarget;
  readonly source: FigNodeMutationSource;
};

/** Commit one explicit image asset to one Kiwi node paint. */
export function commitFigEditorNodePaintImageAsset({
  editor,
  guid,
  input,
  target,
  source,
}: CommitFigEditorNodePaintImageAssetParams): FigEditorImageAssetCommitResult {
  const image = createFigEditorImageAsset(input);
  const paintTarget = requireFigEditorPaintImageAssetTarget(target);
  editor.updateNodeWithImages(
    guid,
    [image],
    (node) => writeFigNodePaintImageAssetReference({ node, imageRef: image.ref, target: paintTarget }),
    source,
  );
  return figEditorImageAssetCommitResult(image);
}

/** Commit one explicit image asset to every currently selected Kiwi node paint. */
export function commitFigEditorSelectedPaintImageAsset({
  editor,
  input,
  target,
  source,
}: CommitFigEditorSelectedPaintImageAssetParams): FigEditorImageAssetCommitResult {
  const image = createFigEditorImageAsset(input);
  const paintTarget = requireFigEditorPaintImageAssetTarget(target);
  editor.updateSelectedNodesWithImages(
    [image],
    (node) => writeFigNodePaintImageAssetReference({ node, imageRef: image.ref, target: paintTarget }),
    source,
  );
  return figEditorImageAssetCommitResult(image);
}

/** Build the single image asset representation used by Fig editor commands. */
export function createFigEditorImageAsset(input: FigEditorImageAssetInput): FigPackageImage {
  const data = requireFigEditorImageAssetData(input.data);
  requireSupportedImageMimeTypeAndFileName({ mimeType: input.mimeType, fileName: input.fileName });
  const ref = hashFigEditorImageAssetBytes(data);
  return { ref, data, mimeType: input.mimeType };
}

/** Write one image resource ref into one Kiwi paint slot. */
export function writeFigNodePaintImageAssetReference({
  node,
  imageRef,
  target,
}: {
  readonly node: FigNode;
  readonly imageRef: string;
  readonly target: FigEditorPaintImageAssetTarget;
}): FigNode {
  const paintTarget = requireFigEditorPaintImageAssetTarget(target);
  return writePaintList(
    node,
    paintTarget.paintListKind,
    replacePaint(
      paintList(node, paintTarget.paintListKind),
      paintTarget.paintIndex,
      (paint) => setImageHashHex(paint, imageRef),
    ),
  );
}

function figEditorImageAssetCommitResult(image: FigPackageImage): FigEditorImageAssetCommitResult {
  return {
    ref: image.ref,
    mimeType: image.mimeType,
    byteLength: image.data.length,
  };
}

function requireFigEditorImageAssetData(data: Uint8Array): Uint8Array {
  if (!(data instanceof Uint8Array)) {
    throw new Error("Fig editor image asset command requires Uint8Array data");
  }
  if (data.length === 0) {
    throw new Error("Fig editor image asset command requires non-empty data");
  }
  return data;
}

function requireFigEditorPaintImageAssetTarget(
  target: FigEditorPaintImageAssetTarget,
): FigEditorPaintImageAssetTarget {
  if (target.paintListKind !== "fill" && target.paintListKind !== "stroke") {
    throw new Error("Fig editor image paint command requires paintListKind fill or stroke");
  }
  if (!Number.isInteger(target.paintIndex) || target.paintIndex < 0) {
    throw new Error("Fig editor image paint command requires a non-negative integer paintIndex");
  }
  return target;
}

function requireSupportedImageMimeTypeAndFileName({
  mimeType,
  fileName,
}: {
  readonly mimeType: string;
  readonly fileName: string;
}): void {
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Unsupported image MIME type: ${mimeType}`);
  }
  const lowerName = fileName.toLowerCase();
  const nameExt = lowerName.match(/\.([a-z0-9]+)$/)?.[1];
  if (nameExt === "jpeg") {
    return;
  }
  if (nameExt !== undefined && ["png", "jpg", "gif", "webp", "svg"].includes(nameExt)) {
    return;
  }
  switch (mimeType) {
    case "image/png":
      return;
    case "image/jpeg":
      return;
    case "image/gif":
      return;
    case "image/webp":
      return;
    case "image/svg+xml":
      return;
    default:
      throw new Error(`Unsupported image MIME type: ${mimeType}`);
  }
}

function hashFigEditorImageAssetBytes(data: Uint8Array): string {
  const hash = data.reduce((current, byte) => Math.imul(current ^ byte, 0x01000193), 0x811c9dc5);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
