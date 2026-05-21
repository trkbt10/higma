/** @file React scene renderer regression tests over Kiwi-built SceneGraph. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSceneGraph } from "../scene-graph";
import { FigSceneRenderer } from "./FigSceneRenderer";
import { createKiwiRenderFixture } from "../testing/kiwi-render-fixture";
import { createFrameSurfaceEffectClipSceneGraph } from "../testing/frame-surface-effect-clip-scene";

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
