/** @file Tests for fig editor renderer viewport window resolution. */

import { resolveViewportRenderWindow } from "./viewport-render-window";

describe("resolveViewportRenderWindow", () => {
  it("derives one renderer surface and world viewport from the editor viewport", () => {
    const window = resolveViewportRenderWindow({
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

    expect(window).toEqual({
      x: 125,
      y: -50,
      width: 490,
      height: 350,
      surfaceWidth: 980,
      surfaceHeight: 700,
    });
  });
});
