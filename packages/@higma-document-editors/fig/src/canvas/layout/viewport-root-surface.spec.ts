/** @file Root render surface projection tests. */
import type { FigNode } from "@higma-document-models/fig/types";
import { resolveViewportRootSurfacePlan } from "./viewport-root-surface";

function frame(): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: { value: 0, name: "PAINT" },
    type: { value: 1, name: "FRAME" },
    name: "Frame",
    transform: { m00: 1, m01: 0, m02: 100, m10: 0, m11: 1, m12: 50 },
    size: { x: 400, y: 300 },
  };
}

describe("resolveViewportRootSurfacePlan", () => {
  it("clips a root frame surface to the visible viewport", () => {
    const plan = resolveViewportRootSurfacePlan({
      node: frame(),
      renderWindow: { x: 250, y: 100, width: 200, height: 100, surfaceWidth: 400, surfaceHeight: 200 },
      viewportScale: 2,
    });

    expect(plan).toEqual({
      cssBox: { x: 0, y: 0, width: 400, height: 200 },
      canvasWidth: 400,
      canvasHeight: 200,
      viewport: { x: 250, y: 100, width: 200, height: 100 },
    });
  });

  it("returns undefined for a supported frame outside the viewport", () => {
    const plan = resolveViewportRootSurfacePlan({
      node: frame(),
      renderWindow: { x: 600, y: 100, width: 100, height: 100, surfaceWidth: 100, surfaceHeight: 100 },
      viewportScale: 1,
    });

    expect(plan).toBeUndefined();
  });
});
