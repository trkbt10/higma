/** @file Tests for fig editor renderer viewport region resolution. */

import { resolveViewportRenderRegion } from "./viewport-render-region";

describe("resolveViewportRenderRegion", () => {
  it("derives one renderer surface and world viewport from the editor viewport", () => {
    const region = resolveViewportRenderRegion({
      context: {
        viewport: {
          translateX: -250,
          translateY: 100,
          scale: 2,
        },
        viewportSize: {
          width: 1000,
          height: 720,
        },
        rulerThickness: 20,
      },
    });

    expect(region).toEqual({
      x: 125,
      y: -50,
      width: 490,
      height: 350,
      surfaceWidth: 980,
      surfaceHeight: 700,
    });
  });
});
