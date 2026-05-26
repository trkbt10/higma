/** @file Transient node translation redraw-region tests. */

import { createNodeId, type Effect, type RectNode } from "@higma-document-renderers/fig/scene-graph";
import type { RenderGroupNode, RenderRectNode } from "../../scene-graph";
import {
  resolveTransientNodeTranslationRedrawRegion,
  resolveTransientNodeTranslationRedrawViewport,
  type TransientNodeTranslationRedrawRegion,
} from "./transient-node-translation-redraw-region";

const IDENTITY = Object.freeze({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 });

function rectNode(id: string, x: number, y: number): RenderRectNode {
  const source: RectNode = {
    id: createNodeId(id),
    type: "rect",
    name: id,
    visible: true,
    transform: { ...IDENTITY, m02: x, m12: y },
    opacity: 1,
    effects: [],
    width: 100,
    height: 50,
    fills: [],
  };
  return {
    id: createNodeId(id),
    type: "rect",
    source,
    width: 100,
    height: 50,
    fill: { attrs: { fill: "none" } },
    wrapper: {},
    defs: [],
    needsWrapper: false,
    sourceFills: [],
  };
}

function groupNode(
  id: string,
  x: number,
  y: number,
  children: readonly RenderRectNode[],
  effects: readonly Effect[] = [],
): RenderGroupNode {
  return {
    id: createNodeId(id),
    type: "group",
    source: {
      id: createNodeId(id),
      type: "group",
      name: id,
      visible: true,
      transform: { ...IDENTITY, m02: x, m12: y },
      opacity: 1,
      effects,
      children: [],
    },
    children,
    wrapper: {},
    defs: [],
    canUnwrapSingleChild: false,
  };
}

function redrawRegion(id: string, x: number, y: number, width: number, height: number): TransientNodeTranslationRedrawRegion {
  const redrawBounds = { minX: x, minY: y, maxX: x + width, maxY: y + height };
  return {
    nodeId: id,
    oldBounds: redrawBounds,
    translatedBounds: redrawBounds,
    redrawBounds,
    redrawViewport: { x, y, width, height },
  };
}

describe("resolveTransientNodeTranslationRedrawRegion", () => {
  it("returns the union of the old and translated visual bounds in viewport coordinates", () => {
    expect(resolveTransientNodeTranslationRedrawRegion({
      children: [rectNode("target", 10, 20)],
      viewportTransform: IDENTITY,
      viewport: { x: 0, y: 0, width: 300, height: 200 },
      translation: { nodeId: createNodeId("target"), dx: 30, dy: 10 },
    })).toMatchObject({
      nodeId: "target",
      oldBounds: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
      translatedBounds: { minX: 40, minY: 30, maxX: 140, maxY: 80 },
      redrawBounds: { minX: 10, minY: 20, maxX: 140, maxY: 80 },
      redrawViewport: { x: 10, y: 20, width: 130, height: 60 },
    });
  });

  it("uses ancestor transforms from the same RenderNode tree", () => {
    expect(resolveTransientNodeTranslationRedrawRegion({
      children: [groupNode("parent", 100, 50, [rectNode("target", 10, 20)])],
      viewportTransform: IDENTITY,
      viewport: { x: 0, y: 0, width: 300, height: 200 },
      translation: { nodeId: createNodeId("target"), dx: 30, dy: 10 },
    })?.redrawViewport).toEqual({ x: 110, y: 70, width: 130, height: 60 });
  });

  it("includes parent composited output when parent source effects depend on the moved child", () => {
    expect(resolveTransientNodeTranslationRedrawRegion({
      children: [
        groupNode("parent", 0, 0, [rectNode("target", -260, 20)], [{
          type: "drop-shadow",
          offset: { x: 220, y: 0 },
          radius: 40,
          color: { r: 0, g: 0, b: 0, a: 1 },
          showShadowBehindNode: true,
        }]),
      ],
      viewportTransform: IDENTITY,
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      translation: { nodeId: createNodeId("target"), dx: 120, dy: 0 },
    })?.redrawViewport).toEqual({ x: 0, y: 0, width: 220, height: 110 });
  });

  it("clips the redraw region to the current renderer viewport", () => {
    expect(resolveTransientNodeTranslationRedrawRegion({
      children: [rectNode("target", 250, 20)],
      viewportTransform: IDENTITY,
      viewport: { x: 0, y: 0, width: 300, height: 200 },
      translation: { nodeId: createNodeId("target"), dx: 30, dy: 0 },
    })?.redrawViewport).toEqual({ x: 250, y: 20, width: 50, height: 50 });
  });

  it("returns null when the translated node is not visible in the viewport", () => {
    expect(resolveTransientNodeTranslationRedrawRegion({
      children: [rectNode("target", 500, 20)],
      viewportTransform: IDENTITY,
      viewport: { x: 0, y: 0, width: 300, height: 200 },
      translation: { nodeId: createNodeId("target"), dx: 30, dy: 0 },
    })).toBeNull();
  });
});

describe("resolveTransientNodeTranslationRedrawViewport", () => {
  it("uses the current redraw viewport when there is no previous preview", () => {
    expect(resolveTransientNodeTranslationRedrawViewport({
      current: redrawRegion("target", 10, 20, 30, 40),
      previous: null,
    })).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("unions the previous and current redraw viewports so previous preview pixels are restored", () => {
    expect(resolveTransientNodeTranslationRedrawViewport({
      current: redrawRegion("target", 40, 20, 30, 40),
      previous: redrawRegion("target", 10, 20, 20, 30),
    })).toEqual({ x: 10, y: 20, width: 60, height: 40 });
  });

  it("returns null when neither previous nor current preview touched the viewport", () => {
    expect(resolveTransientNodeTranslationRedrawViewport({
      current: null,
      previous: null,
    })).toBeNull();
  });
});
