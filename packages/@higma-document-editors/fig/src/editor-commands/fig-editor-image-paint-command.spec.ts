/** @file Fig editor image paint command tests. */
import { PAINT_TYPE_VALUES, SCALE_MODE_VALUES } from "@higma-document-models/fig/constants";
import { figImageHashHexToBytes } from "@higma-document-models/fig/domain";
import {
  createFigEditorImageAsset,
  writeFigNodePaintImageAssetReference,
} from "./fig-editor-image-paint-command";
import { sectionNode } from "../panels/sections/section-specimen";

function imagePaint(hashHex: string) {
  return {
    type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
    imageScaleMode: { value: SCALE_MODE_VALUES.FILL, name: "FILL" },
    image: { hash: figImageHashHexToBytes(hashHex) },
    opacity: 1,
    visible: true,
  };
}

describe("createFigEditorImageAsset", () => {
  it("creates stable refs from image bytes and file extension", () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const image = createFigEditorImageAsset({ data, mimeType: "image/png", fileName: "sample.png" });

    expect(image.ref).toBe("5734a87d");
    expect(image.data).toBe(data);
    expect(image.mimeType).toBe("image/png");
  });

  it("rejects non-image assets explicitly", () => {
    expect(() => createFigEditorImageAsset({
      data: new Uint8Array([1]),
      mimeType: "text/plain",
      fileName: "sample.txt",
    })).toThrow("Unsupported image MIME type");
  });
});

describe("writeFigNodePaintImageAssetReference", () => {
  it("writes only the targeted Kiwi paint slot", () => {
    const node = sectionNode("RECTANGLE", {
      fillPaints: [
        imagePaint("01020304"),
        imagePaint("05060708"),
      ],
    });

    const next = writeFigNodePaintImageAssetReference({
      node,
      imageRef: "4e4a5c83",
      target: { paintListKind: "fill", paintIndex: 1 },
    });

    expect(next.fillPaints?.[0]).toEqual(node.fillPaints?.[0]);
    expect(next.fillPaints?.[1]).toMatchObject({
      image: { hash: figImageHashHexToBytes("4e4a5c83") },
    });
  });
});
