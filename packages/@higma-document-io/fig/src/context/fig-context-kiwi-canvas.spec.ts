/**
 * @file Decoded fig-family canvas to FigDesignDocument adapter tests.
 */

import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import { createFigDesignDocumentFromKiwiCanvas } from "./fig-context";

function createCanvas(): FigmaKiwiCanvas {
  return {
    header: { magic: "fig-site", version: "0", payloadSize: 0 },
    schema: { definitions: [] },
    message: {},
    nodeChanges: [
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 }, name: "Document" },
      {
        type: "CANVAS",
        guid: { sessionID: 0, localID: 1 },
        name: "Page",
        parentIndex: { guid: { sessionID: 0, localID: 0 } },
      },
      {
        type: "RECTANGLE",
        guid: { sessionID: 0, localID: 2 },
        name: "Card",
        parentIndex: { guid: { sessionID: 0, localID: 1 } },
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

describe("createFigDesignDocumentFromKiwiCanvas", () => {
  it("routes decoded product canvases into the FigDesignDocument renderer model", () => {
    const document = createFigDesignDocumentFromKiwiCanvas(createCanvas(), { canvasVisibility: "user-visible" });

    expect(document.pages).toHaveLength(1);
    expect(document.pages[0].children[0].id).toBe("0:2");
    expect(document.pages[0].children[0].fills[0]?.type).toBe("SOLID");
    expect(document.images).toBeInstanceOf(Map);
    expect(document._loaded).toBeUndefined();
  });

  it("preserves the root document color profile for render export settings", () => {
    const canvas = createCanvas();
    const document = createFigDesignDocumentFromKiwiCanvas({
      ...canvas,
      nodeChanges: [
        {
          type: "DOCUMENT",
          guid: { sessionID: 0, localID: 0 },
          name: "Document",
          documentColorProfile: { value: 1, name: "SRGB" },
        },
        ...canvas.nodeChanges.slice(1),
      ],
    }, { canvasVisibility: "user-visible" });

    expect(document.documentColorProfile).toEqual({ value: 1, name: "SRGB" });
  });
});
