/** @file Spec for thumbnail rendering over DOCUMENT.thumbnailInfo. */

import { encodeRgbaToPng, isPng } from "@higma-codecs/png";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import { addNode, createEmptyFigDocument } from "@higma-document-io/fig";
import {
  createFigDocumentContext,
  createFigDocumentContextFromNodeChanges,
  type FigDocumentContext,
} from "@higma-document-io/fig/context";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { parseFigFile } from "../parser";
import { exportFig } from "./fig-exporter";
import type {
  FigCanvasBounds,
  FigThumbnailRenderRequest,
  FigThumbnailRenderResult,
} from "./thumbnail-pipeline";

function createFakePng(): Uint8Array {
  const width = 2;
  const height = 3;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 0xff;
    rgba[i + 1] = 0x00;
    rgba[i + 2] = 0x00;
    rgba[i + 3] = 0xff;
  }
  const png = encodeRgbaToPng(rgba, width, height);
  if (!isPng(png)) {
    throw new Error("encodeRgbaToPng produced bytes that do not start with the PNG magic");
  }
  return png;
}

const FAKE_PNG = createFakePng();

function firstCanvasGuid(context: FigDocumentContext): FigGuid {
  const canvas = context.document.nodeChanges.find((node) => getNodeType(node) === "CANVAS");
  if (canvas?.guid === undefined) {
    throw new Error("thumbnail pipeline test expected an initial CANVAS guid");
  }
  return canvas.guid;
}

function buildContextWithFrame(): { readonly context: FigDocumentContext; readonly frameGuid: FigGuid } {
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 17, nextLocalID: 1 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const empty = createEmptyFigDocument("Cover Page");
  const step = addNode({
    state,
    context: empty,
    pageGuid: firstCanvasGuid(empty),
    parentGuid: null,
    spec: {
      type: "FRAME",
      name: "Hero",
      x: 12,
      y: 34,
      width: 320,
      height: 200,
    },
  });
  return { context: step.context, frameGuid: step.nodeGuid };
}

function withThumbnailInfo(
  context: FigDocumentContext,
  nodeID: FigGuid,
  thumbnailVersion?: string,
): FigDocumentContext {
  return createFigDocumentContextFromNodeChanges({
    nodeChanges: context.document.nodeChanges.map((node) => {
      if (getNodeType(node) !== "DOCUMENT") {
        return node;
      }
      return {
        ...node,
        thumbnailInfo: {
          nodeID,
          ...(thumbnailVersion === undefined ? {} : { thumbnailVersion }),
        },
      };
    }),
    blobs: context.blobs,
    images: context.images,
    metadata: context.metadata,
  });
}

type RendererRecord = {
  readonly call: FigThumbnailRenderRequest;
};

function makeRecordingRenderer(
  result: FigThumbnailRenderResult,
): { renderer: (req: FigThumbnailRenderRequest) => Promise<FigThumbnailRenderResult>; calls: RendererRecord[] } {
  const calls: RendererRecord[] = [];
  return {
    renderer: async (req) => {
      calls.push({ call: req });
      return result;
    },
    calls,
  };
}

const HERO_BOUNDS: FigCanvasBounds = { x: 12, y: 34, width: 320, height: 200 };

describe("export thumbnail pipeline", () => {
  it("rasterises the DOCUMENT.thumbnailInfo target and writes it into the ZIP", async () => {
    const { context, frameGuid } = buildContextWithFrame();
    const contextWithTarget = withThumbnailInfo(context, frameGuid, "v-test-1");
    const { renderer, calls } = makeRecordingRenderer({
      png: FAKE_PNG,
      thumbnailSize: { width: 2, height: 3 },
      renderCoordinates: HERO_BOUNDS,
    });

    const exported = await exportFig(contextWithTarget, { renderThumbnail: renderer });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.call.target.guid).toEqual(frameGuid);
    expect(calls[0]?.call.canvasBounds).toEqual(HERO_BOUNDS);
    expect(calls[0]?.call.maxDimension).toBe(400);

    const reloaded = await loadFigFile(exported.data);
    expect(reloaded.thumbnail).toEqual(FAKE_PNG);
    expect(reloaded.metadata?.clientMeta?.thumbnailSize).toEqual({ width: 2, height: 3 });
    expect(reloaded.metadata?.clientMeta?.renderCoordinates).toEqual(HERO_BOUNDS);

    const parsed = await parseFigFile(exported.data);
    const documentNode = parsed.nodeChanges.find((node) => getNodeType(node) === "DOCUMENT");
    expect(documentNode?.thumbnailInfo).toEqual({
      nodeID: frameGuid,
      thumbnailVersion: "v-test-1",
    });
  });

  it("requires renderThumbnail when DOCUMENT.thumbnailInfo is set", async () => {
    const { context, frameGuid } = buildContextWithFrame();
    await expect(exportFig(withThumbnailInfo(context, frameGuid))).rejects.toThrow(/renderThumbnail.*was not provided/);
  });

  it("throws when DOCUMENT.thumbnailInfo points outside nodeChanges", async () => {
    const { context } = buildContextWithFrame();
    await expect(
      exportFig(withThumbnailInfo(context, { sessionID: 999, localID: 999 }), {
        renderThumbnail: async () => {
          throw new Error("should not be called");
        },
      }),
    ).rejects.toThrow(/was not found in nodeChanges/);
  });

  it("rejects renderer output that lacks the PNG magic", async () => {
    const { context, frameGuid } = buildContextWithFrame();
    await expect(
      exportFig(withThumbnailInfo(context, frameGuid), {
        renderThumbnail: async () => ({
          png: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
          thumbnailSize: { width: 1, height: 1 },
          renderCoordinates: HERO_BOUNDS,
        }),
      }),
    ).rejects.toThrow(/PNG magic/);
  });

  it("requires renderer-owned renderCoordinates", async () => {
    const { context, frameGuid } = buildContextWithFrame();
    await expect(
      exportFig(withThumbnailInfo(context, frameGuid), {
        renderThumbnail: async () => ({
          png: FAKE_PNG,
          thumbnailSize: { width: 1, height: 1 },
        } as FigThumbnailRenderResult),
      }),
    ).rejects.toThrow(/renderCoordinates/);
  });

  it("preserves placeholder thumbnail behavior when DOCUMENT.thumbnailInfo is absent", async () => {
    const { context } = buildContextWithFrame();
    const { renderer, calls } = makeRecordingRenderer({
      png: FAKE_PNG,
      thumbnailSize: { width: 2, height: 3 },
      renderCoordinates: HERO_BOUNDS,
    });
    const exported = await exportFig(context, { renderThumbnail: renderer });
    expect(calls).toHaveLength(0);
    const reloaded = await loadFigFile(exported.data);
    expect(reloaded.thumbnail).not.toBeNull();
    expect(reloaded.thumbnail).not.toEqual(FAKE_PNG);
    expect(reloaded.metadata?.clientMeta?.thumbnailSize).not.toEqual({ width: 2, height: 3 });
  });
});

describe("loaded document thumbnailInfo surfacing", () => {
  it("does not invent DOCUMENT.thumbnailInfo when the loaded root has none", async () => {
    const { context } = buildContextWithFrame();
    const exported = await exportFig(context);
    const reloadedContext = await createFigDocumentContext(exported.data);
    const documentNode = reloadedContext.document.nodeChanges.find((node) => getNodeType(node) === "DOCUMENT");
    expect(documentNode?.thumbnailInfo).toBeUndefined();
  });
});
