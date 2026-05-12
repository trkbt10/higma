/** @file Tests for shared fig editor viewport layout planning. */

import type { SceneGraph } from "@higma-document-models/fig/scene-graph";
import { resolveViewportLayerFrame, resolveViewportRenderWindow } from "./viewport-render-plan";

function makeSceneGraph(): SceneGraph {
  return {
    width: 980,
    height: 700,
    viewport: {
      x: 125,
      y: -50,
      width: 490,
      height: 350,
    },
    root: {
      id: "root" as SceneGraph["root"]["id"],
      type: "group",
      name: "root",
      visible: true,
      opacity: 1,
      effects: [],
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      children: [],
    },
    version: 1,
  };
}

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

describe("resolveViewportLayerFrame", () => {
  it("places viewport-rendered SVG and WebGL backends in screen pixels", () => {
    expect(resolveViewportLayerFrame({ sceneGraph: makeSceneGraph(), placement: "screen" })).toEqual({
      left: 0,
      top: 0,
      width: 980,
      height: 700,
    });
  });

  it("uses the world viewport only for content inside a transformed page layer", () => {
    expect(resolveViewportLayerFrame({ sceneGraph: makeSceneGraph(), placement: "world" })).toEqual({
      left: 125,
      top: -50,
      width: 490,
      height: 350,
    });
  });
});
