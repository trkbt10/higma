/** @file Spec for WebGL effect backing-buffer region derivation. */

import {
  expandWebGLEffectRenderRegionForShaderSampling,
  intersectWebGLEffectRenderRegions,
  resolveWebGLEffectBackdropCopyRegion,
  resolveWebGLRenderNodeEffectStackOutputRegion,
  resolveWebGLRenderNodeSubtreeVisualOutputRegion,
} from "./effect-render-region";
import { buildEffectStack, createNodeId, RENDER_NODE_SOURCE_TRANSFORMS, type GroupNode, type RectNode } from "@higma-document-renderers/fig/scene-graph";
import type { RenderGroupNode, RenderRectNode } from "../../scene-graph";

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

function rectNodeWithDropShadow(id: string, x: number, y: number): RenderRectNode {
  const node = rectNode(id, x, y);
  return {
    ...node,
    source: {
      ...node.source,
      effects: [{
        type: "drop-shadow",
        offset: { x: 150, y: 0 },
        radius: 10,
        color: { r: 0, g: 0, b: 0, a: 1 },
        showShadowBehindNode: true,
      }],
    },
  };
}

function rectNodeWithBackgroundBlur(id: string, x: number, y: number): RenderRectNode {
  const node = rectNode(id, x, y);
  return {
    ...node,
    source: {
      ...node.source,
      effects: [{
        type: "background-blur",
        radius: 20,
      }],
    },
    backgroundBlur: {
      stdDeviation: 10,
      clipId: `${id}-background-blur`,
      backdropBounds: { x: -20, y: -20, width: 140, height: 90 },
    },
  };
}

function groupNode(id: string, child: RenderRectNode): RenderGroupNode {
  const source: GroupNode = {
    id: createNodeId(id),
    type: "group",
    name: id,
    visible: true,
    transform: IDENTITY,
    opacity: 1,
    effects: [{
      type: "drop-shadow",
      offset: { x: 220, y: 0 },
      radius: 40,
      color: { r: 0, g: 0, b: 0, a: 1 },
      showShadowBehindNode: true,
    }],
    children: [],
  };
  return {
    id: createNodeId(id),
    type: "group",
    source,
    children: [child],
    wrapper: {},
    defs: [],
    canUnwrapSingleChild: false,
  };
}

function groupNodeWithoutEffects(id: string, child: RenderRectNode): RenderGroupNode {
  const source: GroupNode = {
    id: createNodeId(id),
    type: "group",
    name: id,
    visible: true,
    transform: IDENTITY,
    opacity: 1,
    effects: [],
    children: [],
  };
  return {
    id: createNodeId(id),
    type: "group",
    source,
    children: [child],
    wrapper: {},
    defs: [],
    canUnwrapSingleChild: false,
  };
}

describe("resolveWebGLEffectBackdropCopyRegion", () => {
  it("uses the effect scissor region as the WebGL backdrop copy source and texture destination", () => {
    expect(resolveWebGLEffectBackdropCopyRegion({
      x: 12,
      y: 34,
      width: 56,
      height: 78,
    })).toEqual({
      textureX: 12,
      textureY: 34,
      sourceX: 12,
      sourceY: 34,
      width: 56,
      height: 78,
    });
  });

  it("does not request a WebGL copy for an empty effect region", () => {
    expect(resolveWebGLEffectBackdropCopyRegion({
      x: 12,
      y: 34,
      width: 0,
      height: 78,
    })).toBeNull();
    expect(resolveWebGLEffectBackdropCopyRegion({
      x: 12,
      y: 34,
      width: 56,
      height: 0,
    })).toBeNull();
  });
});

describe("intersectWebGLEffectRenderRegions", () => {
  it("returns the shared backing-buffer region", () => {
    expect(intersectWebGLEffectRenderRegions(
      { x: 10, y: 20, width: 80, height: 60 },
      { x: 30, y: 10, width: 40, height: 50 },
    )).toEqual({
      x: 30,
      y: 20,
      width: 40,
      height: 40,
    });
  });

  it("returns null when two backing-buffer regions do not overlap", () => {
    expect(intersectWebGLEffectRenderRegions(
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 50, y: 20, width: 30, height: 40 },
    )).toBeNull();
  });
});

describe("expandWebGLEffectRenderRegionForShaderSampling", () => {
  it("expands the WebGL effect region by the explicit shader sampling padding", () => {
    expect(expandWebGLEffectRenderRegionForShaderSampling({
      region: { x: 12, y: 34, width: 56, height: 78 },
      canvasWidth: 200,
      canvasHeight: 180,
      paddingInBackingPixels: 16,
    })).toEqual({
      x: 0,
      y: 18,
      width: 84,
      height: 110,
    });
  });

  it("clips the expanded WebGL effect region to the canvas backing store", () => {
    expect(expandWebGLEffectRenderRegionForShaderSampling({
      region: { x: 180, y: 170, width: 40, height: 20 },
      canvasWidth: 200,
      canvasHeight: 180,
      paddingInBackingPixels: 16,
    })).toEqual({
      x: 164,
      y: 154,
      width: 36,
      height: 26,
    });
  });

  it("rejects non-finite shader sampling padding", () => {
    expect(() => expandWebGLEffectRenderRegionForShaderSampling({
      region: { x: 12, y: 34, width: 56, height: 78 },
      canvasWidth: 200,
      canvasHeight: 180,
      paddingInBackingPixels: Number.NaN,
    })).toThrow("non-negative finite paddingInBackingPixels");
  });
});

describe("resolveWebGLRenderNodeSubtreeVisualOutputRegion", () => {
  it("uses the RenderNode subtree visual output bounds, including parent source effects", () => {
    expect(resolveWebGLRenderNodeSubtreeVisualOutputRegion({
      node: groupNode("group", rectNode("child", -260, 20)),
      transform: IDENTITY,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      canvasWidth: 500,
      canvasHeight: 500,
      pixelRatio: 1,
    })).toEqual({
      x: 0,
      y: 390,
      width: 100,
      height: 110,
    });
  });

  it("uses the RenderNode subtree visual output bounds, including child source effects", () => {
    expect(resolveWebGLRenderNodeSubtreeVisualOutputRegion({
      node: groupNodeWithoutEffects("group", rectNodeWithDropShadow("child", 0, 0)),
      transform: IDENTITY,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      canvasWidth: 500,
      canvasHeight: 500,
      pixelRatio: 1,
    })).toEqual({
      x: 0,
      y: 440,
      width: 260,
      height: 60,
    });
  });

  it("uses visual output bounds instead of background blur sampling bounds", () => {
    expect(resolveWebGLRenderNodeSubtreeVisualOutputRegion({
      node: groupNodeWithoutEffects("group", rectNodeWithBackgroundBlur("child", 0, 0)),
      transform: IDENTITY,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      canvasWidth: 500,
      canvasHeight: 500,
      pixelRatio: 1,
    })).toEqual({
      x: 0,
      y: 450,
      width: 100,
      height: 50,
    });
  });
});

describe("resolveWebGLRenderNodeEffectStackOutputRegion", () => {
  it("uses the RenderNode source-effect input bounds, including stroke expansion", () => {
    const node: RenderRectNode = {
      ...rectNode("stroked", 0, 0),
      sourceStroke: {
        width: 20,
        linecap: "butt",
        linejoin: "miter",
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
      },
    };

    expect(resolveWebGLRenderNodeEffectStackOutputRegion({
      node,
      effectStack: buildEffectStack([]),
      transform: IDENTITY,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      canvasWidth: 500,
      canvasHeight: 500,
      pixelRatio: 1,
    })).toEqual({
      x: 0,
      y: 440,
      width: 110,
      height: 60,
    });
  });

  it("uses RenderNode parent-child visual dependencies before applying the requested effect stack", () => {
    const layerBlurStack = buildEffectStack([{
      type: "layer-blur",
      radius: 20,
    }]);

    const region = resolveWebGLRenderNodeEffectStackOutputRegion({
      node: groupNodeWithoutEffects("group", rectNodeWithDropShadow("child", 0, 0)),
      effectStack: layerBlurStack,
      transform: IDENTITY,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      canvasWidth: 500,
      canvasHeight: 500,
      pixelRatio: 1,
    });

    expect(region).toEqual({
      x: 0,
      y: 420,
      width: 280,
      height: 80,
    });
  });
});
