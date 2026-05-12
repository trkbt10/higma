/** @file SceneGraph SVG renderer viewport tests. */
import { renderSceneGraphToSvg } from "./scene-renderer";
import type { SceneGraph } from "@higma-document-models/fig/scene-graph";
import { createNodeId } from "@higma-document-models/fig/scene-graph";
import { createPngImage, readPng, writePng, type PngImage } from "@higma-codecs/png";

function createPngBytes(size: { readonly width: number; readonly height: number }, rgb = 128): Uint8Array {
  const image = createPngImage(size);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = rgb;
    image.data[i + 1] = rgb;
    image.data[i + 2] = rgb;
    image.data[i + 3] = 255;
  }
  return writePng(image);
}

function readFirstImageDataUriPng(svg: string): PngImage {
  const match = svg.match(/href="data:image\/png;base64,([^"]+)"/);
  if (!match) {
    throw new Error("expected an embedded PNG data URI");
  }
  return readPng(Buffer.from(match[1], "base64"));
}

describe("renderSceneGraphToSvg viewport", () => {
  it("uses the SceneGraph viewport as the SVG viewBox", () => {
    const sceneGraph: SceneGraph = {
      width: 300,
      height: 200,
      viewport: { x: -120, y: -40, width: 300, height: 200 },
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain('viewBox="-120 -40 300 200"');
  });

  it("bakes image paint filters into SVG pattern image data", () => {
    const source = createPngBytes({ width: 10, height: 10 }, 224);
    const sceneGraph: SceneGraph = {
      width: 100,
      height: 100,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "rect",
          id: createNodeId("image-rect"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 100,
          height: 100,
          fills: [{
            type: "image",
            imageRef: "img-ref",
            data: source,
            mimeType: "image/png",
            scaleMode: "FILL",
            opacity: 1,
            paintFilter: { brightness: -0.1 },
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('id="img-');
    expect(svg).not.toContain("-paint-filter");
    expect(svg).not.toContain("<feComponentTransfer");
    const embedded = readFirstImageDataUriPng(svg);
    expect(embedded.data[0]).toBeLessThan(224);
  });

  it("omits the redundant child clip wrapper for viewport-sized root frames", () => {
    const sceneGraph: SceneGraph = {
      width: 100,
      height: 100,
      viewport: { x: 0, y: 0, width: 100, height: 100 },
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "frame",
          id: createNodeId("slide"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 100,
          height: 100,
          fills: [],
          clipsContent: true,
          children: [{
            type: "rect",
            id: createNodeId("child"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            width: 120,
            height: 120,
            fills: [],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).not.toContain("<g clip-path=");
  });
});
