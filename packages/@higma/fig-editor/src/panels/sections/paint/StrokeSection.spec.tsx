/** @file Stroke property section tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrokeSection } from "./StrokeSection";
import { createPropertyMutationTarget } from "../../properties/property-mutation-target";
import { createTestDesignNode } from "../../../../spec/unit/shared/test-fixtures";

describe("StrokeSection", () => {
  it("renders gradient stroke controls", () => {
    const node = createTestDesignNode({
      strokeWeight: 2,
      strokes: [{
        type: "GRADIENT_RADIAL",
        opacity: 0.8,
        gradientStops: [
          { position: 0, color: { r: 0, g: 1, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      }],
    });
    const html = renderToStaticMarkup(createElement(StrokeSection, {
      node,
      target: createPropertyMutationTarget({ primaryNode: node, selectedNodes: [node] }),
      images: new Map(),
      dispatch: () => undefined,
    }));

    expect(html).toContain('value="GRADIENT_RADIAL"');
    expect(html).toContain('aria-label="Stroke weight"');
    expect(html).toContain('aria-label="Stroke paint type 1"');
    expect(html).toContain('aria-label="Stroke opacity 1"');
    expect(html).toContain('aria-label="Stroke gradient stop 1 color 1"');
    expect(html).toContain('value="#00ff00"');
    expect(html).toContain('value="#000000"');
  });

  it("renders image stroke scale controls", () => {
    const node = createTestDesignNode({
      strokeWeight: 2,
      strokes: [{
        type: "IMAGE",
        opacity: 1,
        imageRef: "stroke-image",
        scaleMode: "TILE",
        scalingFactor: 0.75,
        rotation: Math.PI,
      }],
    });
    const html = renderToStaticMarkup(createElement(StrokeSection, {
      node,
      target: createPropertyMutationTarget({ primaryNode: node, selectedNodes: [node] }),
      images: new Map([["stroke-image", { ref: "stroke-image", data: new Uint8Array([1]), mimeType: "image/png" }]]),
      dispatch: () => undefined,
    }));

    expect(html).toContain('value="stroke-image"');
    expect(html).toContain('aria-label="Stroke image 1"');
    expect(html).toContain('aria-label="Stroke image scale mode 1"');
    expect(html).toContain('aria-label="Stroke image scale 1"');
    expect(html).toContain('aria-label="Stroke image rotation 1"');
    expect(html).toContain('value="TILE"');
    expect(html).toContain('value="0.75"');
    expect(html).toContain('value="180"');
  });
});
