/** @file React scene renderer regression tests over Kiwi-built SceneGraph. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSceneGraph, createNodeId, type GroupNode, type RectNode, type SceneGraph } from "../scene-graph";
import { FigSceneRenderer } from "./FigSceneRenderer";
import { createKiwiRenderFixture } from "../testing/kiwi-render-fixture";
import { createFrameSurfaceEffectClipSceneGraph } from "../testing/frame-surface-effect-clip-scene";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

function renderSceneGraph(sceneGraph: SceneGraph): string {
  return renderToStaticMarkup(createElement("svg", null, createElement(FigSceneRenderer, { sceneGraph })));
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
