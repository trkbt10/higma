/** @file SceneGraph SVG renderer viewport tests. */
import { renderSceneGraphToSvg, formatRenderTreeToSvg } from "./scene-renderer";
import { resolveRenderTree } from "../scene-graph/render-tree/resolve";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import { createNodeId } from "@higma-document-renderers/fig/scene-graph";
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
            // Child sits entirely inside the FRAME bounds — the
            // overflow-aware optimization in `resolveFrameChildClipId`
            // must omit the redundant `<clipPath>` here, matching
            // Figma's exporter behaviour on no-overflow FRAMEs (e.g.
            // App Store template's Event metadata 385×206 FRAME).
            width: 80,
            height: 80,
            fills: [],
          }],
        }],
      },
      version: 1,
    };

    const svg = renderSceneGraphToSvg(sceneGraph) as string;

    // The renderer no longer emits a root-level `<g clip-path>` wrapper —
    // `pruneSceneGraphToViewport` strips off-viewport subtrees before the
    // render tree is even built, and `<svg viewBox>` handles the residual
    // visual clip. The wrapper used to isolate descendants for compositing
    // (resvg quirk on `<g clip-path>`) which broke `mix-blend-mode`
    // overlay paints — the App Store template's Event metadata Light-
    // variant Description / "Special event" text relied on its absence.
    //
    // The per-FRAME clip is also omitted because every child fits within
    // the FRAME's bounds (`frameChildrenFitWithinBounds` returns true),
    // so a `<clipPath>` would be a structural no-op. Matches Figma's
    // exporter: clip-path is emitted only when descendant geometry
    // actually overflows the FRAME.
    expect(svg).not.toContain('id="root-viewport-clip"');
    expect(svg).not.toContain('clip-path="url(#clip-');
  });

  it("emits compound-path masks with mask-type:luminance + fill=white to match Figma's exporter", () => {
    // Figma's SVG exporter writes the iPhone "Screen mask" BOOLEAN_OPERATION
    // — a flattened outer outline + interior cutouts joined as one compound
    // path — as `mask-type:luminance` with `fill="white"`. A single-subpath
    // rounded-rect mask, by contrast, uses `mask-type:alpha` with
    // `fill="#D9D9D9"`. The distinction matters because resvg always reads
    // mask alpha from RGB luminance, so stacked alpha+#D9D9D9 masks
    // compound to ~72% pass-through instead of the ~85% Figma's export
    // produces under the same rasteriser. The App Store template's Phone
    // symbol nests an outer-iPhone alpha mask inside a Screen-mask compound
    // mask — flattening both to alpha+#D9D9D9 made the speaker cutout
    // render at ~#5E instead of Figma's ~#41 and accounted for the 1.32%
    // App page screenshots diff.
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
    // Compound mask should be emitted as luminance + white.
    expect(svg).toMatch(/<mask[^>]*style="mask-type:luminance"[^>]*>[^<]*<path[^>]*fill="white"/);
    expect(svg).not.toMatch(/<mask[^>]*style="mask-type:alpha"[^>]*>[^<]*<path[^>]*fill="#D9D9D9"/);
  });

  it("emits single-subpath masks with mask-type:alpha + fill=#D9D9D9 to match Figma's exporter", () => {
    // A simple rounded-rect mask source (e.g. the iPhone outer-outline
    // "Mask" ROUNDED_RECTANGLE) uses Figma's alpha + #D9D9D9 byte
    // pattern. resvg reads the #D9D9D9 luminance as ~0.85, matching
    // Figma's own export pass-through.
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
              fills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
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
    // Mask source is a simple rounded rect with uniform corner radius,
    // so it emits as a native `<rect rx>` (matching Figma's exporter
    // byte pattern). Either path-form or rect-form is acceptable —
    // both express the same masked region.
    expect(svg).toMatch(/<mask[^>]*style="mask-type:alpha"[^>]*>[^<]*<(rect|path)[^>]*fill="#D9D9D9"/);
    expect(svg).not.toMatch(/<mask[^>]*style="mask-type:luminance"/);
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
