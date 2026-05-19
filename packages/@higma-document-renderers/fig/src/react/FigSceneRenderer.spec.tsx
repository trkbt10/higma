/** @file React scene renderer regression tests over Kiwi-built SceneGraph. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSceneGraph } from "../scene-graph";
import { FigSceneRenderer } from "./FigSceneRenderer";
import { createKiwiRenderFixture } from "../testing/kiwi-render-fixture";

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
  return renderToStaticMarkup(createElement(FigSceneRenderer, { sceneGraph }));
}

describe("FigSceneRenderer", () => {
  it("preserves FRAME fills in the React SVG path", () => {
    const html = renderFixtureNodes(["Basic Shapes"]);

    expect(html).toMatch(/<rect[^>]+fill="#ffffff"/i);
    expect(html).toMatch(/<rect[^>]+width="480"[^>]+height="320"/);
  });

  it("uses canonical inner-shadow primitives", () => {
    const html = renderFixtureNodes(["Inner Shadow Card"]);

    expect(html).toMatch(/<feFlood\b/);
    expect(html).toMatch(/<feComposite[^>]+operator="in"/);
    expect(html).toMatch(/<feComposite[^>]+operator="out"/);
    expect(html).toMatch(/<feMerge\b/);
    expect(html).not.toContain("0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0");
  });

  it("does not put fill directly on stroke mask elements", () => {
    const html = renderFixtureNodes(["Basic Shapes"]);

    expect(html).not.toMatch(/<mask\b[^>]*\sfill=/);
    if (/<mask\b/.test(html)) {
      expect(html).toMatch(/<mask\b[^>]*mask-?[Tt]ype/);
      expect(html).toMatch(/<g\s+fill="white"/);
    }
  });
});
