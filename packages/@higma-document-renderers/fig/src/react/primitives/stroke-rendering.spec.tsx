/** @file StrokeRenderingElements rendering invariants. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StrokeRendering } from "../../scene-graph";
import { StrokeRenderingElements } from "./stroke-rendering";

describe("StrokeRenderingElements", () => {
  it("formats rounded path strokes through the shared rect primitive", () => {
    const strokeRendering: StrokeRendering = {
      mode: "layers",
      shape: {
        kind: "path",
        paths: [{
          d: "M1 3C1 1.895 1.895 1 3 1L16 1C17.105 1 18 1.895 18 3L18 21C18 22.105 17.105 23 16 23L3 23C1.895 23 1 22.105 1 21Z",
        }],
      },
      layers: [{
        attrs: {
          stroke: "#999999",
          strokeWidth: 2,
          strokeLinecap: "square",
        },
      }],
    };

    const html = renderToStaticMarkup(createElement(StrokeRenderingElements, { sr: strokeRendering }));

    expect(html).toContain('<rect x="1" y="1" width="17" height="22" rx="2" fill="none" stroke="#999999" stroke-width="2" stroke-linecap="square">');
    expect(html).not.toContain("<path");
  });
});
