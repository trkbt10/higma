/** @file React scene renderer regression tests over Kiwi-built SceneGraph. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSceneGraph, createNodeId, type FrameNode, type GroupNode, type RectNode, type SceneGraph } from "../scene-graph";
import { FigSceneRenderer, FigSceneSvgRenderer } from "./FigSceneRenderer";
import { createKiwiRenderFixture } from "../testing/kiwi-render-fixture";
import { createFrameSurfaceEffectClipSceneGraph } from "../testing/frame-surface-effect-clip-scene";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

function renderSceneGraph(sceneGraph: SceneGraph): string {
  return renderToStaticMarkup(createElement("svg", null, createElement(FigSceneRenderer, { sceneGraph })));
}

function renderSceneGraphSvgRoot(sceneGraph: SceneGraph): string {
  return renderToStaticMarkup(createElement(FigSceneSvgRenderer, { sceneGraph }));
}

function requireFirstTag(html: string, tagName: string): string {
  const match = new RegExp(`<${tagName}\\b[^>]*>`).exec(html);
  if (match === null) {
    throw new Error(`expected <${tagName}> in rendered markup`);
  }
  return match[0];
}

function requireFirstElementMarkup(html: string, tagName: string): string {
  const tag = requireFirstTag(html, tagName);
  const start = html.indexOf(tag);
  const end = html.indexOf(`</${tagName}>`, start);
  if (end < 0) {
    throw new Error(`expected </${tagName}> in rendered markup`);
  }
  return html.slice(start, end + tagName.length + 3);
}

function rectNode(id: string, width: number, height: number): RectNode {
  return {
    type: "rect",
    id: createNodeId(id),
    transform: IDENTITY,
    opacity: 1,
    visible: true,
    effects: [],
    width,
    height,
    fills: [{ type: "solid", color: BLACK, opacity: 1 }],
  };
}

function sceneWithChildren(children: readonly SceneGraph["root"]["children"][number][]): SceneGraph {
  return {
    width: 100,
    height: 100,
    viewport: { x: 0, y: 0, width: 100, height: 100 },
    version: 1,
    root: {
      type: "group",
      id: createNodeId("root"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      children,
    },
  };
}

function renderFixtureNodes(nodeNames: readonly string[]): string {
  const fixture = createKiwiRenderFixture();
  const nodes = fixture.resources.childrenOf(fixture.pages.shapes)
    .filter((node) => nodeNames.includes(node.name ?? ""));
  const componentNodes = fixture.resources.childrenOf(fixture.pages.components)
    .filter((node) => nodeNames.includes(node.name ?? ""));
  const sceneGraph = buildSceneGraph([...nodes, ...componentNodes], {
    blobs: fixture.resources.blobs,
    images: fixture.resources.images,
    canvasSize: { width: 480, height: 320 },
    viewport: { x: 0, y: 0, width: 480, height: 320 },
    symbolResolver: fixture.resources.symbolResolver,
    childrenOf: fixture.resources.childrenOf,
    styleRegistry: fixture.resources.styleRegistry,
    showHiddenNodes: false,
    warnings: [],
    textFontResolver: undefined,
  });
  return renderToStaticMarkup(createElement("svg", null, createElement(FigSceneRenderer, { sceneGraph })));
}

describe("FigSceneRenderer", () => {
  it("preserves FRAME fills in the React SVG path", () => {
    const html = renderFixtureNodes(["Basic Shapes"]);

    expect(html).toMatch(/<rect[^>]+fill="#ffffff"/i);
    expect(html).toMatch(/<rect[^>]+width="480"[^>]+height="320"/);
  });

  it("preserves single FRAME fill blend mode in the React SVG path", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("single-frame-fill-blend"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 44,
      height: 44,
      surfaceShape: { type: "rect", width: 44, height: 44, cornerRadius: 22 },
      fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, blendMode: "multiply" }],
      clipsContent: false,
      children: [],
    };
    const html = renderSceneGraph(sceneWithChildren([frame]));

    expect(html).toMatch(/style="mix-blend-mode:multiply"/);
  });

  it("preserves node-level blend mode on a simple React SVG rect", () => {
    const node: RectNode = {
      ...rectNode("node-level-linear-burn", 6, 9),
      blendMode: "plus-darker",
      fills: [{ type: "solid", color: BLACK, opacity: 0.1 }],
    };
    const html = renderSceneGraph(sceneWithChildren([node]));

    expect(html).toMatch(/style="mix-blend-mode:plus-darker"/);
    expect(html).toMatch(/<rect[^>]+width="6"[^>]+height="9"/);
  });

  it("renders the structured SVG formatter root through React without string style props", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("svg-root-fill-blend"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 44,
      height: 44,
      surfaceShape: { type: "rect", width: 44, height: 44, cornerRadius: 22 },
      fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, blendMode: "multiply" }],
      clipsContent: false,
      children: [],
    };
    const html = renderSceneGraphSvgRoot(sceneWithChildren([frame]));

    expect(html).toMatch(/^<svg[^>]+viewBox="0 0 100 100"/);
    expect(html).toMatch(/style="mix-blend-mode:multiply"/);
    expect(html).not.toContain("[object Object]");
  });

  it("keeps CSS-class-backed plus-darker blend mode through the structured SVG React bridge", () => {
    const node: RectNode = {
      ...rectNode("paint-level-linear-burn", 6, 9),
      fills: [{ type: "solid", color: BLACK, opacity: 0.1, blendMode: "plus-darker" }],
    };
    const html = renderSceneGraphSvgRoot(sceneWithChildren([node]));

    expect(html).toContain(".higma-svg-blend-plus-darker{mix-blend-mode:plus-darker}");
    expect(html).toMatch(/class="higma-svg-blend-plus-darker"/);
    expect(html).not.toContain('style="mix-blend-mode:plus-darker"');
  });

  it("formats baked rounded frame surface paths through the shared rect primitive", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("baked-rounded-surface"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 165.8087615966797,
      height: 360.4897155761719,
      surfaceShape: {
        type: "path",
        contours: [{
          windingRule: "nonzero",
          commands: [
            { type: "M", x: 0, y: 23.51 },
            { type: "C", x1: 0, y1: 10.526, x2: 10.526, y2: 0, x: 23.51, y: 0 },
            { type: "L", x: 142.299, y: 0 },
            { type: "C", x1: 155.283, y1: 0, x2: 165.809, y2: 10.526, x: 165.809, y: 23.51 },
            { type: "L", x: 165.809, y: 336.979 },
            { type: "C", x1: 165.809, y1: 349.965, x2: 155.283, y2: 360.485, x: 142.299, y: 360.485 },
            { type: "L", x: 23.51, y: 360.485 },
            { type: "C", x1: 10.526, y1: 360.485, x2: 0, y2: 349.965, x: 0, y: 336.98 },
            { type: "L", x: 0, y: 23.51 },
          ],
        }],
      },
      fills: [{ type: "solid", color: BLACK, opacity: 1 }],
      clipsContent: false,
      children: [],
    };
    const html = renderSceneGraph(sceneWithChildren([frame]));

    expect(html).toContain('<rect x="0" y="0" width="165.8087615966797" height="360.4897155761719" rx="23.51"');
    expect(html).not.toContain("<path");
  });

  it("preserves baked rounded frame surface paths for multi-fill layers", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("baked-rounded-multi-fill-surface"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 226,
      height: 48,
      surfaceShape: {
        type: "path",
        contours: [{
          windingRule: "nonzero",
          commands: [
            { type: "M", x: 0, y: 24 },
            { type: "C", x1: 0, y1: 10.7452, x2: 10.7452, y2: 0, x: 24, y: 0 },
            { type: "L", x: 202, y: 0 },
            { type: "C", x1: 215.255, y1: 0, x2: 226, y2: 10.7452, x: 226, y: 24 },
            { type: "L", x: 226, y: 24 },
            { type: "C", x1: 226, y1: 37.2548, x2: 215.255, y2: 48, x: 202, y: 48 },
            { type: "L", x: 24, y: 48 },
            { type: "C", x1: 10.7452, y1: 48, x2: 0, y2: 37.2548, x: 0, y: 24 },
            { type: "Z" },
          ],
        }],
      },
      fills: [
        { type: "solid", color: BLACK, opacity: 1, blendMode: "color-dodge" },
        { type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 0.5 },
      ],
      clipsContent: false,
      children: [],
    };
    const html = renderSceneGraph(sceneWithChildren([frame]));

    expect(html).toContain('<path d="M0 24C0 10.7452 10.7452 0 24 0');
    expect(html).not.toContain('<rect x="0" y="0" width="226" height="48" rx="24"');
  });

  it("uses canonical inner-shadow primitives", () => {
    const html = renderFixtureNodes(["Inner Shadow Card"]);

    expect(html).toMatch(/<feFlood[^>]+result="BackgroundImageFix"/);
    expect(html).toMatch(/<feBlend[^>]+mode="normal"[^>]+in="SourceGraphic"[^>]+in2="BackgroundImageFix"[^>]+result="shape-/);
    expect(html).toMatch(/<feColorMatrix[^>]+in="SourceAlpha"[^>]+result="hardAlpha-/);
    expect(html).toMatch(/<feOffset[^>]+in="hardAlpha-/);
    expect(html).toMatch(/<feComposite[^>]+operator="arithmetic"[^>]+k2="-1"[^>]+k3="1"/);
    expect(html).toMatch(/<feColorMatrix[^>]+result="inner-tinted-/);
    expect(html).toMatch(/<feBlend[^>]+mode="normal"[^>]+in="inner-tinted-[^"]+"[^>]+in2="shape-/);
    expect(html).not.toMatch(/<feMerge\b/);
  });

  it("does not put fill directly on stroke mask elements", () => {
    const html = renderFixtureNodes(["Basic Shapes"]);

    expect(html).not.toMatch(/<mask\b[^>]*\sfill=/);
    if (/<mask\b/.test(html)) {
      expect(html).toMatch(/<mask\b[^>]*mask-?[Tt]ype/);
      expect(html).toMatch(/<g\s+fill="white"/);
    }
  });

  it("emits user-space mask regions from the RenderTree mask definition", () => {
    const maskContent = rectNode("mask-source", 10, 10);
    const maskedGroup: GroupNode = {
      type: "group",
      id: createNodeId("masked-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      mask: { maskId: maskContent.id, maskType: "ALPHA", maskContent },
      children: [rectNode("masked-rect", 20, 20)],
    };
    const html = renderSceneGraph(sceneWithChildren([maskedGroup]));
    const maskTag = requireFirstTag(html, "mask");

    expect(maskTag).toContain('maskUnits="userSpaceOnUse"');
    expect(maskTag).toContain('x="0"');
    expect(maskTag).toContain('y="0"');
    expect(maskTag).toContain('width="10"');
    expect(maskTag).toContain('height="10"');
  });

  it("preserves source paint for Kiwi ALPHA masks in the React SVG formatter", () => {
    const maskFills: RectNode["fills"] = [{ type: "solid", color: BLACK, opacity: 0.25 }];
    const maskContent: RectNode = {
      ...rectNode("alpha-mask-source", 10, 10),
      fills: maskFills,
    };
    const maskedGroup: GroupNode = {
      type: "group",
      id: createNodeId("alpha-masked-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      mask: { maskId: maskContent.id, maskType: "ALPHA", maskContent },
      children: [rectNode("alpha-masked-rect", 20, 20)],
    };
    const html = renderSceneGraph(sceneWithChildren([maskedGroup]));
    const maskMarkup = requireFirstElementMarkup(html, "mask");

    expect(maskMarkup).toMatch(/mask-?[Tt]ype:alpha/);
    expect(maskMarkup).toContain('fill="#000000"');
    expect(maskMarkup).toContain('fill-opacity="0.25"');
    expect(maskMarkup).not.toContain('<g fill="white"');
  });

  it("formats paintless Kiwi ALPHA mask geometry as coverage in React SVG", () => {
    const maskContent: RectNode = {
      ...rectNode("paintless-alpha-mask-source", 10, 10),
      fills: [],
    };
    const maskedGroup: GroupNode = {
      type: "group",
      id: createNodeId("paintless-alpha-masked-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      mask: { maskId: maskContent.id, maskType: "ALPHA", maskContent },
      children: [rectNode("paintless-alpha-masked-rect", 20, 20)],
    };
    const html = renderSceneGraph(sceneWithChildren([maskedGroup]));
    const maskMarkup = requireFirstElementMarkup(html, "mask");

    expect(maskMarkup).toMatch(/mask-?[Tt]ype:alpha/);
    expect(maskMarkup).toContain('fill="white"');
    expect(maskMarkup).not.toContain('fill="none"');
  });

  it("formats Kiwi OUTLINE masks as white luminance geometry in React SVG", () => {
    const maskContent = rectNode("outline-mask-source", 10, 10);
    const maskedGroup: GroupNode = {
      type: "group",
      id: createNodeId("outline-masked-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      mask: { maskId: maskContent.id, maskType: "OUTLINE", maskContent },
      children: [rectNode("outline-masked-rect", 20, 20)],
    };
    const html = renderSceneGraph(sceneWithChildren([maskedGroup]));
    const maskMarkup = requireFirstElementMarkup(html, "mask");

    expect(maskMarkup).toMatch(/mask-?[Tt]ype:luminance/);
    expect(maskMarkup).toContain('fill="white"');
    expect(maskMarkup).not.toContain('fill="#000000"');
  });

  it("applies GROUP child clip definitions in the React SVG formatter", () => {
    const clippedGroup: GroupNode = {
      type: "group",
      id: createNodeId("clipped-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      clip: { type: "rect", width: 10, height: 10 },
      children: [rectNode("overflowing-rect", 20, 20)],
    };
    const html = renderSceneGraph(sceneWithChildren([clippedGroup]));

    expect(html).toContain("<clipPath");
    expect(html).toMatch(/<g clip-path="url\(#group-clip-/);
  });

  it("formats uniform rounded clip primitives as native SVG rect clips", () => {
    const clippedGroup: GroupNode = {
      type: "group",
      id: createNodeId("rounded-clip-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      clip: { type: "rect", width: 20, height: 20, cornerRadius: 10 },
      children: [rectNode("rounded-clip-child", 20, 20)],
    };
    const html = renderSceneGraph(sceneWithChildren([clippedGroup]));
    const clipPathMarkup = requireFirstElementMarkup(html, "clipPath");

    expect(clipPathMarkup).toContain("<rect");
    expect(clipPathMarkup).toContain('rx="10"');
    expect(clipPathMarkup).not.toContain("<path");
  });

  it("emits stroke masks in user space in the React SVG formatter", () => {
    const strokedRect: RectNode = {
      ...rectNode("outside-stroke", 20, 20),
      fills: [],
      stroke: {
        width: 4,
        linecap: "butt",
        linejoin: "miter",
        align: "OUTSIDE",
        color: BLACK,
        opacity: 1,
      },
    };
    const html = renderSceneGraph(sceneWithChildren([strokedRect]));
    const maskTag = requireFirstTag(html, "mask");

    expect(maskTag).toContain('maskUnits="userSpaceOnUse"');
  });

  it("applies FRAME surface effects outside the clipped surface content", () => {
    const html = renderToStaticMarkup(createElement("svg", null, createElement(FigSceneRenderer, {
      sceneGraph: createFrameSurfaceEffectClipSceneGraph(),
    })));
    const filterGroupIndex = html.indexOf('<g filter="url(#filter-');
    const clippedSurfaceIndex = html.indexOf('<g clip-path="url(#clip-');

    expect(filterGroupIndex).toBeGreaterThanOrEqual(0);
    expect(clippedSurfaceIndex).toBeGreaterThan(filterGroupIndex);
    expect(html.slice(filterGroupIndex, clippedSurfaceIndex)).not.toContain('clip-path="url(#clip-');
  });
});
