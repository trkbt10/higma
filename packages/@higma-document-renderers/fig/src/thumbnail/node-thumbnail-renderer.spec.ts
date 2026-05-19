/** @file End-to-end spec for the Node-side Kiwi thumbnail renderer. */

import { isPng } from "@higma-codecs/png";
import { addNode, createEmptyFigDocument, exportFig } from "@higma-document-io/fig";
import {
  createFigDocumentContextFromNodeChanges,
  type FigDocumentContext,
} from "@higma-document-io/fig/context";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { parseFigFile } from "@higma-document-io/fig/parser";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import { createNodeThumbnailRenderer } from "./node-thumbnail-renderer";

function firstCanvasGuid(context: FigDocumentContext): FigGuid {
  const canvas = context.document.nodeChanges.find((node) => getNodeType(node) === "CANVAS");
  if (canvas?.guid === undefined) {
    throw new Error("node thumbnail test expected an initial CANVAS guid");
  }
  return canvas.guid;
}

function withThumbnailInfo(context: FigDocumentContext, nodeID: FigGuid): FigDocumentContext {
  return createFigDocumentContextFromNodeChanges({
    nodeChanges: context.document.nodeChanges.map((node) => {
      if (getNodeType(node) !== "DOCUMENT") {
        return node;
      }
      return { ...node, thumbnailInfo: { nodeID } };
    }),
    blobs: context.blobs,
    images: context.images,
    metadata: context.metadata,
  });
}

function buildContextWithFrame(
  name: string,
  width: number,
  height: number,
  x: number,
  y: number,
): { readonly context: FigDocumentContext; readonly frameGuid: FigGuid } {
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 9, nextLocalID: 1 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const empty = createEmptyFigDocument("Cover");
  const step = addNode({
    state,
    context: empty,
    pageGuid: firstCanvasGuid(empty),
    parentGuid: null,
    spec: {
      type: "FRAME",
      name,
      x,
      y,
      width,
      height,
    },
  });
  return { context: step.context, frameGuid: step.nodeGuid };
}

describe("createNodeThumbnailRenderer", () => {
  it("rasterises a fresh FRAME via resvg-js and embeds the PNG plus meta bounds", async () => {
    const { context, frameGuid } = buildContextWithFrame("Cover Frame", 320, 240, 20, 40);
    const exported = await exportFig(withThumbnailInfo(context, frameGuid), {
      renderThumbnail: createNodeThumbnailRenderer(),
    });

    const reloaded = await loadFigFile(exported.data);
    expect(reloaded.thumbnail).not.toBeNull();
    expect(isPng(reloaded.thumbnail!)).toBe(true);
    expect(reloaded.thumbnail!.length).toBeGreaterThan(200);
    expect(reloaded.metadata?.clientMeta?.thumbnailSize).toEqual({
      width: 320,
      height: 240,
    });
    expect(reloaded.metadata?.clientMeta?.renderCoordinates).toEqual({
      x: 20,
      y: 40,
      width: 320,
      height: 240,
    });

    const parsed = await parseFigFile(exported.data);
    const documentNode = parsed.nodeChanges.find((node) => getNodeType(node) === "DOCUMENT");
    expect(documentNode?.thumbnailInfo).toEqual({ nodeID: frameGuid });
  });

  it("clamps the longest axis to maxDimension while preserving aspect ratio", async () => {
    const { context, frameGuid } = buildContextWithFrame("Wide Frame", 1600, 800, 0, 0);
    const exported = await exportFig(withThumbnailInfo(context, frameGuid), {
      renderThumbnail: createNodeThumbnailRenderer(),
    });
    const reloaded = await loadFigFile(exported.data);
    expect(reloaded.metadata?.clientMeta?.thumbnailSize).toEqual({ width: 400, height: 200 });
    expect(reloaded.metadata?.clientMeta?.renderCoordinates).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 800,
    });
  });
});
