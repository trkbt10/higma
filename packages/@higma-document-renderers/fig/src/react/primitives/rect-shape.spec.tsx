/** @file RectShape rendering invariants. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSmoothedRoundedRectPathD } from "@higma-primitives/path";
import { RectShape } from "./rect-shape";

describe("RectShape", () => {
  it("renders smoothed asymmetric rounded rectangles from RenderTree radius data", () => {
    const radii = [24, 4, 16, 8] as const;
    const expectedD = buildSmoothedRoundedRectPathD(100, 80, radii, 0.6);
    const html = renderToStaticMarkup(createElement(RectShape, {
      width: 100,
      height: 80,
      cornerRadius: radii,
      cornerSmoothing: 0.6,
      fill: "#000000",
    }));

    expect(html).toContain(`<path d="${expectedD}"`);
  });
});
