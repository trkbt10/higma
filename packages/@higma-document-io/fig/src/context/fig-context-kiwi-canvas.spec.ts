/** @file Spec for decoded fig-family canvas to FigDocumentContext. */

import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import { guidToString } from "@higma-document-models/fig/domain";
import { createFigDocumentContextFromKiwiCanvas } from "./document-context";

function createCanvas(): FigmaKiwiCanvas {
  return {
    header: { magic: "fig-site", version: "0", payloadSize: 0 },
    schema: { definitions: [] },
    message: {},
    nodeChanges: [
      { type: { value: 1, name: "DOCUMENT" }, guid: { sessionID: 0, localID: 0 }, name: "Document" },
      {
        type: { value: 2, name: "CANVAS" },
        guid: { sessionID: 0, localID: 1 },
        name: "Page",
        parentIndex: { guid: { sessionID: 0, localID: 0 }, position: "!" },
      },
      {
        type: { value: 4, name: "RECTANGLE" },
        guid: { sessionID: 0, localID: 2 },
        name: "Card",
        parentIndex: { guid: { sessionID: 0, localID: 1 }, position: "!" },
        transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 40 },
        size: { x: 120, y: 80 },
        fillPaints: [
          {
            type: { value: 0, name: "SOLID" },
            visible: true,
            opacity: 1,
            color: { r: 1, g: 0, b: 0, a: 1 },
          },
        ],
      },
    ],
    blobs: [],
    images: new Map(),
    metadata: null,
    thumbnail: null,
  };
}

describe("createFigDocumentContextFromKiwiCanvas", () => {
  it("indexes decoded nodeChanges without creating a second document shape", () => {
    const context = createFigDocumentContextFromKiwiCanvas(createCanvas());
    const card = context.document.nodesByGuid.get("0:2");
    expect(card?.name).toBe("Card");
    expect(card?.fillPaints?.[0]?.type?.name).toBe("SOLID");
    expect(context.document.childrenOf(context.document.nodesByGuid.get("0:1")!)).toEqual([card]);
    expect(context.loaded).toBeUndefined();
  });

  it("preserves DOCUMENT fields on the Kiwi root node", () => {
    const canvas = createCanvas();
    const context = createFigDocumentContextFromKiwiCanvas({
      ...canvas,
      nodeChanges: [
        {
          type: { value: 1, name: "DOCUMENT" },
          guid: { sessionID: 0, localID: 0 },
          name: "Document",
          documentColorProfile: { value: 1, name: "SRGB" },
        },
        ...canvas.nodeChanges.slice(1),
      ],
    });
    const root = context.document.nodesByGuid.get(guidToString({ sessionID: 0, localID: 0 }));
    expect(root?.documentColorProfile).toEqual({ value: 1, name: "SRGB" });
  });
});
