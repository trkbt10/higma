/** @file SceneGraph SVG renderer viewport tests. */
import { renderSceneGraphToSvg, formatRenderTreeToSvg } from "./scene-renderer";
import { resolveRenderTree, createNodeId, type FrameNode, type PathNode, type SceneGraph, type RectNode, type RenderTree } from "@higma-document-renderers/fig/scene-graph";
import { createPngImage, readPng, writePng, type PngImage } from "@higma-codecs/png";
import { createFrameSurfaceEffectClipSceneGraph } from "../testing/frame-surface-effect-clip-scene";

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
  it("keeps frame background blur outside foreground blur filters", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("liquid-glass-frame"),
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      opacity: 1,
      visible: true,
      effects: [
        { type: "background-blur", radius: 40 },
        { type: "layer-blur", radius: 40 },
      ],
      width: 48,
      height: 48,
      surfaceShape: { type: "rect", width: 48, height: 48, cornerRadius: 24 },
      cornerRadius: 24,
      fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 0.05, blendMode: "hard-light" }],
      clipsContent: false,
      children: [],
    };
    const sceneGraph: SceneGraph = {
      width: 80,
      height: 80,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [frame],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;
    const backgroundBlurIndex = svg.indexOf("<foreignObject");
    const foregroundFilterIndex = svg.indexOf("<g filter=\"url(#filter-");

    expect(svg).toContain("backdrop-filter:blur(20px)");
    expect(svg).not.toContain("backdrop-filter:blur(40px)");
    expect(backgroundBlurIndex).toBeGreaterThan(-1);
    expect(foregroundFilterIndex).toBeGreaterThan(backgroundBlurIndex);
  });

  it("formats Kiwi strokeGeometry as filled stroke outline instead of restroking it", () => {
    const strokedPath: PathNode = {
      type: "path",
      id: createNodeId("path-stroke-geometry"),
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      opacity: 1,
      visible: true,
      effects: [],
      contours: [{
        commands: [
          { type: "M", x: 0, y: 0 },
          { type: "L", x: 10, y: 0 },
          { type: "L", x: 10, y: 10 },
          { type: "L", x: 0, y: 10 },
          { type: "Z" },
        ],
        windingRule: "evenodd",
      }],
      strokeContours: [{
        commands: [
          { type: "M", x: -1, y: -1 },
          { type: "L", x: 11, y: -1 },
          { type: "L", x: 11, y: 11 },
          { type: "L", x: -1, y: 11 },
          { type: "Z" },
        ],
        windingRule: "nonzero",
      }],
      fills: [{ type: "solid", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 }],
      stroke: {
        width: 2,
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        linecap: "butt",
        linejoin: "miter",
        align: "INSIDE",
      },
    };
    const sceneGraph: SceneGraph = {
      width: 40,
      height: 40,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [strokedPath],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('<path d="M-1 -1L11 -1L11 11L-1 11Z" fill="#000000"');
    expect(svg).toContain('fill-rule="evenodd" clip-rule="evenodd"');
    expect(svg).not.toContain('stroke-width="4"');
  });

  it("renders rect-metadata VECTOR strokeGeometry through the rect stroke SoT", () => {
    const strokedRectPath: PathNode = {
      type: "path",
      id: createNodeId("rect-param-stroke-geometry"),
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 200,
      cornerRadius: 20,
      cornerSmoothing: 0.6,
      contours: [{
        commands: [
          { type: "M", x: 0, y: 20 },
          { type: "L", x: 0, y: 180 },
          { type: "L", x: 100, y: 180 },
          { type: "L", x: 100, y: 20 },
          { type: "Z" },
        ],
        windingRule: "nonzero",
      }],
      strokeContours: [{
        commands: [
          { type: "M", x: 1, y: 20 },
          { type: "L", x: 1, y: 180 },
          { type: "L", x: 99, y: 180 },
          { type: "L", x: 99, y: 20 },
          { type: "Z" },
        ],
        windingRule: "nonzero",
      }],
      fills: [],
      stroke: {
        width: 2,
        color: { r: 0.55, g: 0.545, b: 0.529, a: 1 },
        opacity: 1,
        linecap: "butt",
        linejoin: "miter",
        align: "INSIDE",
      },
    };
    const sceneGraph: SceneGraph = {
      width: 120,
      height: 220,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [strokedRectPath],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('fill="none" stroke="#8c8b87" stroke-width="2"');
    expect(svg).not.toContain('fill="#8c8b87" mask=');
  });

  it("rounds wrapper opacity attributes through the Figma export number rule", () => {
    const sceneGraph: SceneGraph = {
      width: 40,
      height: 40,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "path",
          id: createNodeId("opacity-path"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 0.4000000059604645,
          visible: true,
          effects: [],
          contours: [{
            commands: [
              { type: "M", x: 0, y: 0 },
              { type: "L", x: 10, y: 0 },
              { type: "L", x: 10, y: 10 },
              { type: "Z" },
            ],
            windingRule: "nonzero",
          }],
          fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
        }],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('opacity="0.4"');
    expect(svg).not.toContain('opacity="0.4000000059604645"');
  });

  it("formats shadow-only paths with an opaque filter source shape", () => {
    const sceneGraph: SceneGraph = {
      width: 40,
      height: 40,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "path",
          id: createNodeId("effect-only-path"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [{
            type: "drop-shadow",
            offset: { x: 0, y: 0 },
            radius: 4,
            color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
            showShadowBehindNode: true,
          }],
          contours: [{
            commands: [
              { type: "M", x: 0, y: 0 },
              { type: "L", x: 20, y: 0 },
              { type: "L", x: 20, y: 20 },
              { type: "L", x: 0, y: 20 },
              { type: "Z" },
            ],
            windingRule: "nonzero",
          }],
          fills: [],
        }],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain('<feMergeNode in="SourceGraphic"');
  });

  it("marks filter source shapes with Figma exporter crisp-edge rendering", () => {
    const sceneGraph: SceneGraph = {
      width: 40,
      height: 40,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "ellipse",
          id: createNodeId("filtered-circle"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [{
            type: "drop-shadow",
            offset: { x: 0, y: 4 },
            radius: 2,
            color: { r: 0, g: 0, b: 0, a: 0.08 },
            showShadowBehindNode: true,
          }],
          cx: 14,
          cy: 14,
          rx: 14,
          ry: 14,
          fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 0.97 }],
        }],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('filter="url(#filter-');
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it("does not mark clipped frame backgrounds as crisp-edge filter sources", () => {
    const sceneGraph: SceneGraph = {
      width: 100,
      height: 80,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "frame",
          id: createNodeId("filtered-card"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [{
            type: "drop-shadow",
            offset: { x: 0, y: 8 },
            radius: 12,
            color: { r: 0, g: 0, b: 0, a: 0.15 },
            showShadowBehindNode: true,
          }],
          width: 100,
          height: 80,
          surfaceShape: { type: "rect", width: 100, height: 80, cornerRadius: 12 },
          cornerRadius: 12,
          fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 }],
          clipsContent: true,
          children: [{
            type: "rect",
            id: createNodeId("card-child"),
            transform: { m00: 1, m01: 0, m02: -5, m10: 0, m11: 1, m12: 4 },
            opacity: 1,
            visible: true,
            effects: [],
            width: 20,
            height: 20,
            fills: [{ type: "solid", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('filter="url(#filter-');
    expect(svg).not.toContain('shape-rendering="crispEdges"');
  });

  it("renders FRAME background fills with the frame surface path", () => {
    const sceneGraph: SceneGraph = {
      width: 100,
      height: 80,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "frame",
          id: createNodeId("path-surface-frame"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 100,
          height: 80,
          surfaceShape: {
            type: "path",
            contours: [{
              commands: [
                { type: "M", x: 0, y: 0 },
                { type: "L", x: 40, y: 0 },
                { type: "L", x: 40, y: 20 },
                { type: "L", x: 0, y: 20 },
                { type: "Z" },
              ],
              windingRule: "nonzero",
            }],
          },
          fills: [{ type: "solid", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 }],
          clipsContent: false,
          children: [],
        }],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('<path d="M0 0L40 0L40 20L0 20Z" fill="#ff0000"');
    expect(svg).not.toContain('<rect x="0" y="0" width="100" height="80" fill="#ff0000"');
  });

  it("clamps SVG rect corner radius to the rect half extent", () => {
    const sceneGraph: SceneGraph = {
      width: 133,
      height: 24,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "rect",
          id: createNodeId("badge"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 133,
          height: 24,
          cornerRadius: 31,
          fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
        }],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('<rect x="0" y="0" width="133" height="24" rx="12" fill="#000000"');
    expect(svg).not.toContain('rx="31"');
  });

  it("uses the FRAME surface path bounds for surface effect filter bounds", () => {
    const sceneGraph: SceneGraph = {
      width: 100,
      height: 80,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "frame",
          id: createNodeId("path-surface-frame-shadow"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [{
            type: "drop-shadow",
            offset: { x: 0, y: 0 },
            radius: 4,
            color: { r: 0, g: 0, b: 0, a: 0.5 },
            showShadowBehindNode: true,
          }],
          width: 100,
          height: 80,
          surfaceShape: {
            type: "path",
            contours: [{
              commands: [
                { type: "M", x: 0, y: 0 },
                { type: "L", x: 40, y: 0 },
                { type: "L", x: 40, y: 20 },
                { type: "L", x: 0, y: 20 },
                { type: "Z" },
              ],
              windingRule: "nonzero",
            }],
          },
          fills: [{ type: "solid", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 }],
          clipsContent: false,
          children: [],
        }],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('<filter id="filter-');
    expect(svg).toContain('x="-4" y="-4" width="48" height="28"');
    expect(svg).not.toContain('width="108" height="88"');
  });

  it("applies FRAME surface effects outside the clipped surface content", () => {
    const svg = renderSceneGraphToSvg(createFrameSurfaceEffectClipSceneGraph()) as string;
    const filterGroupIndex = svg.indexOf("<g filter=\"url(#filter-");
    const clippedSurfaceIndex = svg.indexOf("<g clip-path=\"url(#clip-");

    expect(filterGroupIndex).toBeGreaterThanOrEqual(0);
    expect(clippedSurfaceIndex).toBeGreaterThan(filterGroupIndex);
    expect(svg.slice(filterGroupIndex, clippedSurfaceIndex)).not.toContain('clip-path="url(#clip-');
  });

  it("renders GROUP geometry as a child clip path", () => {
    const sceneGraph: SceneGraph = {
      width: 100,
      height: 80,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "group",
          id: createNodeId("screen-group"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          clip: {
            type: "path",
            contours: [{
              commands: [
                { type: "M", x: 0, y: 0 },
                { type: "L", x: 40, y: 0 },
                { type: "L", x: 40, y: 20 },
                { type: "L", x: 0, y: 20 },
                { type: "Z" },
              ],
              windingRule: "nonzero",
            }],
          },
          children: [{
            type: "rect",
            id: createNodeId("oversized-child"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            width: 100,
            height: 80,
            fills: [{ type: "solid", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };
    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toMatch(/<clipPath[^>]*id="group-clip-/);
    expect(svg).toMatch(/<g clip-path="url\(#group-clip-/);
    expect(svg).toContain('<path d="M0 0L40 0L40 20L0 20Z"');
  });

  it("exports a viewport-local SVG viewBox while preserving world-space content", () => {
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
    expect(svg).toContain('viewBox="0 0 300 200"');
    expect(svg).toContain('transform="translate(120 40)"');
    expect(svg).toContain('fill="none"');
  });

  it("rounds path coordinates by viewport-local magnitude", () => {
    const sceneGraph: SceneGraph = {
      width: 402,
      height: 388,
      viewport: { x: 165, y: 1047, width: 402, height: 388 },
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "group",
          id: createNodeId("world-root"),
          transform: { m00: 1, m01: 0, m02: 165, m10: 0, m11: 1, m12: 1047 },
          opacity: 1,
          visible: true,
          effects: [],
          children: [{
            type: "path",
            id: createNodeId("local-path"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            contours: [{
              commands: [
                { type: "M", x: 33.77539, y: 172.125 },
                { type: "L", x: 86.79462, y: 181.625 },
                { type: "Z" },
              ],
              windingRule: "nonzero",
            }],
            fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('viewBox="0 0 402 388"');
    expect(svg).toContain('transform="translate(-165 -1047)"');
    expect(svg).toContain('d="M33.7754 172.125L86.7946 181.625Z"');
  });

  it("rounds large exported coordinates to six significant figures", () => {
    const sceneGraph: SceneGraph = {
      width: 3454,
      height: 1236,
      viewport: { x: 0, y: 0, width: 3454, height: 1236 },
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "path",
          id: createNodeId("framed-local-path"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          contours: [{
            commands: [
              { type: "M", x: 2662.432, y: 366.789 },
              { type: "L", x: 1000.125, y: 0.4018264 },
              { type: "Z" },
            ],
            windingRule: "nonzero",
          }],
          fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('d="M2662.43 366.789L1000.13 0.401826Z"');
  });

  it("does not carry sub-millipixel transform residue into flattened path coordinates", () => {
    const sceneGraph: SceneGraph = {
      width: 3454,
      height: 1236,
      viewport: { x: 4207, y: -119, width: 3454, height: 1236 },
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "group",
          id: createNodeId("display-instance"),
          transform: { m00: 1, m01: 0, m02: 4654.000152587890625, m10: 0, m11: 1, m12: 245 },
          opacity: 1,
          visible: true,
          effects: [],
          children: [{
            type: "path",
            id: createNodeId("headline-glyph"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            contours: [{
              commands: [
                { type: "M", x: 25.146359, y: 30 },
                { type: "L", x: 26.146359, y: 30 },
                { type: "Z" },
              ],
              windingRule: "nonzero",
            }],
            fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('<g transform="matrix(1,0,0,1,4654,245)">');
    expect(svg).toContain('d="M25.146 30L26.146 30Z"');
    expect(svg).not.toContain('d="M25.147 30');
  });

  it("keeps serialized transform fractions in the path coordinate basis", () => {
    const sceneGraph: SceneGraph = {
      width: 3454,
      height: 1236,
      viewport: { x: 4207, y: -119, width: 3454, height: 1236 },
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "group",
          id: createNodeId("tab-label"),
          transform: { m00: 1, m01: 0, m02: 5565.666748046875, m10: 0, m11: 1, m12: 892 },
          opacity: 1,
          visible: true,
          effects: [],
          children: [{
            type: "path",
            id: createNodeId("tab-label-glyph"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            contours: [{
              commands: [
                { type: "M", x: 17.206, y: 10.17 },
                { type: "L", x: 18.206, y: 10.17 },
                { type: "Z" },
              ],
              windingRule: "nonzero",
            }],
            fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain('<g transform="matrix(1,0,0,1,5565.67,892)">');
    expect(svg).toContain('d="M17.2 10.17L18.2 10.17Z"');
    expect(svg).not.toContain('d="M17.21 10.17');
  });

  it("rounds gradient coordinate attributes with numeric suffixes", () => {
    const sourceRect: RectNode = {
      type: "rect",
      id: createNodeId("gradient-rect"),
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      fills: [],
    };
    const renderTree: RenderTree = {
      width: 402,
      height: 388,
      viewport: { x: 165, y: 1047, width: 402, height: 388 },
      children: [{
        type: "rect",
        id: sourceRect.id,
        wrapper: { transform: "matrix(1,0,0,1,165,1047)" },
        defs: [{
          type: "linear-gradient",
          def: {
            type: "linear-gradient",
            id: "lg-test",
            x1: "33.77539",
            y1: "0",
            x2: "86.79462",
            y2: "0",
            gradientUnits: "userSpaceOnUse",
            stops: [
              { offset: "0%", stopColor: "#000000" },
              { offset: "100%", stopColor: "#ffffff" },
            ],
          },
        }],
        source: sourceRect,
        width: 100,
        height: 100,
        fill: { attrs: { fill: "url(#lg-test)" } },
        needsWrapper: true,
        sourceFills: [],
      }],
    };

    const svg = formatRenderTreeToSvg(renderTree) as string;

    expect(svg).toContain('x1="33.7754"');
    expect(svg).toContain('x2="86.7946"');
    expect(svg).not.toContain('x1="33.77539"');
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
            imageHash: "img-ref",
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

  it("omits the redundant per-frame child clip wrapper for viewport-sized root frames", () => {
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
          surfaceShape: { type: "rect", width: 100, height: 100 },
          fills: [],
          clipsContent: true,
          children: [{
            type: "rect",
            id: createNodeId("child"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            width: 80,
            height: 80,
            fills: [],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    // The only omitted clip here is the viewport-sized root frame clip:
    // the SVG viewBox already owns that rectangular boundary. Non-root
    // frame clips remain driven by Kiwi `clipsContent`.
    expect(svg).not.toContain('id="root-viewport-clip"');
    expect(svg).not.toContain('clip-path="url(#clip-');
  });

  it("emits OUTLINE masks with mask-type:luminance + fill=white to match Figma's exporter", () => {
    // Figma's SVG exporter writes the iPhone "Screen mask" BOOLEAN_OPERATION
    // — a flattened outer outline + interior cutouts joined as one compound
    // path — as `mask-type:luminance` with `fill="white"`. The App Store
    // template carries this distinction in Kiwi `maskType`; geometry shape
    // does not decide the mode.
    const sceneGraph: SceneGraph = {
      width: 200,
      height: 200,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "group",
          id: createNodeId("masked"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          mask: {
            maskId: createNodeId("mask-source"),
            maskType: "OUTLINE",
            // A path with two disjoint subpaths — outer rect, inner hole —
            // joined inside one contour by a second `M` command. Mirrors
            // a flattened BOOLEAN_OPERATION result.
            maskContent: {
              type: "path",
              id: createNodeId("mask-source"),
              transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
              opacity: 1,
              visible: true,
              effects: [],
              fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
              contours: [{
                windingRule: "evenodd",
                commands: [
                  { type: "M", x: 0, y: 0 },
                  { type: "L", x: 100, y: 0 },
                  { type: "L", x: 100, y: 100 },
                  { type: "L", x: 0, y: 100 },
                  { type: "Z" },
                  { type: "M", x: 25, y: 25 },
                  { type: "L", x: 75, y: 25 },
                  { type: "L", x: 75, y: 75 },
                  { type: "L", x: 25, y: 75 },
                  { type: "Z" },
                ],
              }],
            },
          },
          children: [{
            type: "rect",
            id: createNodeId("masked-rect"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            width: 100,
            height: 100,
            fills: [{ type: "solid", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;
    // OUTLINE mask should be emitted as luminance + white.
    expect(svg).toMatch(/<mask[^>]*style="mask-type:luminance"[^>]*>[^<]*<path[^>]*fill="white"/);
    expect(svg).not.toMatch(/<mask[^>]*style="mask-type:alpha"[^>]*>[^<]*<path[^>]*fill="#D9D9D9"/);
  });

  it("includes Kiwi strokeGeometry in OUTLINE mask source bounds and shape", () => {
    const maskSource: PathNode = {
      type: "path",
      id: createNodeId("mask-source"),
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      opacity: 1,
      visible: true,
      effects: [],
      fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
      stroke: {
        width: 2,
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        linecap: "butt",
        linejoin: "miter",
      },
      contours: [{
        windingRule: "nonzero",
        commands: [
          { type: "M", x: 0, y: 0 },
          { type: "L", x: 100, y: 0 },
          { type: "L", x: 100, y: 100 },
          { type: "L", x: 0, y: 100 },
          { type: "Z" },
        ],
      }],
      strokeContours: [{
        windingRule: "nonzero",
        commands: [
          { type: "M", x: -1, y: -1 },
          { type: "L", x: 101, y: -1 },
          { type: "L", x: 101, y: 101 },
          { type: "L", x: -1, y: 101 },
          { type: "Z" },
        ],
      }],
    };
    const sceneGraph: SceneGraph = {
      width: 120,
      height: 120,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "group",
          id: createNodeId("masked"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          mask: {
            maskId: maskSource.id,
            maskType: "OUTLINE",
            maskContent: maskSource,
          },
          children: [{
            type: "rect",
            id: createNodeId("masked-rect"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            width: 100,
            height: 100,
            fills: [{ type: "solid", color: { r: 0.2, g: 0.2, b: 0.2, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toMatch(/<mask[^>]*x="-1"[^>]*y="-1"[^>]*width="102"[^>]*height="102"/);
    expect(svg).toContain('d="M-1 -1L101 -1L101 101L-1 101Z"');
  });

  it("emits SVG mask regions from the authored mask source bounds", () => {
    const sceneGraph: SceneGraph = {
      width: 80,
      height: 80,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "rect",
          id: createNodeId("masked"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 40,
          height: 40,
          fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
          mask: {
            maskId: createNodeId("mask-source"),
            maskType: "ALPHA",
            maskContent: {
              type: "rect",
              id: createNodeId("mask-source"),
              transform: { m00: 1, m01: 0, m02: 10.4, m10: 0, m11: 1, m12: 20.2 },
              opacity: 1,
              visible: true,
              effects: [],
              width: 9.2,
              height: 7.6,
              fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 }],
            },
          },
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;
    expect(svg).toMatch(/<mask[^>]*x="10"[^>]*y="20"[^>]*width="10"[^>]*height="8"/);
  });

  it("preserves source alpha paints for Kiwi ALPHA masks", () => {
    // Tab Bar's background fade is a Kiwi ALPHA mask whose source fill is
    // an authored gradient. The alpha gradient is the mask signal; forcing
    // a constant mask fill erases the SoT and makes the exported fade
    // diverge from Figma.
    const sceneGraph: SceneGraph = {
      width: 200,
      height: 200,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "group",
          id: createNodeId("masked"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          mask: {
            maskId: createNodeId("mask-source"),
            maskType: "ALPHA",
            maskContent: {
              type: "rect",
              id: createNodeId("mask-source"),
              transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
              opacity: 1,
              visible: true,
              effects: [],
              width: 100,
              height: 100,
              cornerRadius: 12,
              fills: [{
                type: "linear-gradient",
                start: { x: 0, y: 0 },
                end: { x: 0, y: 1 },
                stops: [
                  { position: 0, color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } },
                  { position: 1, color: { r: 0.45, g: 0.45, b: 0.45, a: 0 } },
                ],
                opacity: 1,
              }],
            },
          },
          children: [{
            type: "rect",
            id: createNodeId("masked-rect"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            width: 100,
            height: 100,
            fills: [{ type: "solid", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;
    expect(svg).toMatch(/<mask[^>]*style="mask-type:alpha"[^>]*>[\s\S]*<linearGradient/);
    expect(svg).toMatch(/<mask[^>]*style="mask-type:alpha"[^>]*>[\s\S]*stop-opacity="0"/);
    expect(svg).not.toMatch(/<mask[^>]*style="mask-type:alpha"[^>]*>[\s\S]*fill="#D9D9D9"/);
    expect(svg).not.toMatch(/<mask[^>]*style="mask-type:luminance"/);
  });

  it("preserves source black and white fills for Kiwi LUMINANCE masks", () => {
    const sceneGraph: SceneGraph = {
      width: 120,
      height: 80,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "group",
          id: createNodeId("masked"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          mask: {
            maskId: createNodeId("luminance-mask"),
            maskType: "LUMINANCE",
            maskContent: {
              type: "frame",
              id: createNodeId("luminance-mask"),
              transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
              opacity: 1,
              visible: true,
              effects: [],
              width: 100,
              height: 60,
              surfaceShape: { type: "rect", width: 100, height: 60 },
              fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 }],
              clipsContent: false,
              children: [{
                type: "rect",
                id: createNodeId("luminance-hole"),
                transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 15 },
                opacity: 1,
                visible: true,
                effects: [],
                width: 60,
                height: 30,
                fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
              }],
            },
          },
          children: [{
            type: "rect",
            id: createNodeId("masked-rect"),
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            opacity: 1,
            visible: true,
            effects: [],
            width: 100,
            height: 60,
            fills: [{ type: "solid", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, opacity: 1 }],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toMatch(/<mask[^>]*style="mask-type:luminance"/);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toMatch(/<mask[^>]*>[\s\S]*fill="#D9D9D9"[\s\S]*<\/mask>/);
  });

  it("keeps per-corner frame radii on individual stroke clips", () => {
    const sceneGraph: SceneGraph = {
      width: 120,
      height: 80,
      root: {
        type: "group",
        id: createNodeId("root"),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true,
        effects: [],
        children: [{
          type: "frame",
          id: createNodeId("frame"),
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 120,
          height: 80,
          cornerRadius: [0, 24, 0, 0],
          surfaceShape: { type: "rect", width: 120, height: 80, cornerRadius: [0, 24, 0, 0] },
          fills: [],
          stroke: {
            width: 6,
            linecap: "butt",
            linejoin: "miter",
            align: "INSIDE",
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
          },
          individualStrokeWeights: { top: 6, right: 0, bottom: 0, left: 0 },
          clipsContent: false,
          children: [],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    expect(svg).toContain("<clipPath");
    expect(svg).toMatch(/<clipPath[^>]*>[^<]*<path[^>]*d="/);
    expect(svg).not.toContain('rx="24"');
  });

  it("prepends Figma's empty-frame purple dashed indicator when requested", () => {
    // Figma's SVG exporter writes a 1-px purple dashed rectangle —
    // `<rect x="0.5" y="0.5" width="W-1" height="H-1" rx="4.5"
    //  stroke="#9747FF" stroke-dasharray="10 5"/>` — as a visual cue
    // when the exported root is a FRAME whose `fillPaints` array is
    // empty (or contains only invisible paints). The App Store
    // Community template's `Metadata`, `Event metadata`, and `Tab Bar`
    // fixtures are all such FRAMEs; matching the byte pattern collapses
    // their residual diff. The rect is positioned in the viewport's
    // coordinate frame, not the canvas one, so non-origin viewports
    // (e.g. cropped slide renders) still place the indicator at the
    // visible boundary.
    const sceneGraph: SceneGraph = {
      width: 384,
      height: 196,
      viewport: { x: 0, y: 0, width: 384, height: 196 },
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

    const renderTree = resolveRenderTree(sceneGraph);
    const svg = formatRenderTreeToSvg(renderTree, { figmaEmptyFrameIndicator: true }) as string;

    expect(svg).toContain('<rect x="0.5" y="0.5" width="383" height="195" rx="4.5"');
    expect(svg).toContain('stroke="#9747FF"');
    expect(svg).toContain('stroke-dasharray="10 5"');

    // Sanity: without the flag, no indicator is emitted.
    const plainSvg = formatRenderTreeToSvg(renderTree) as string;
    expect(plainSvg).not.toContain('#9747FF');
  });
});
