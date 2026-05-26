/** @file RenderTree RenderNode visual coverage tests. */

import type { RenderFrameNode, RenderGroupNode, RenderPathNode, RenderRectNode } from "./types";
import { resolveEffectBounds } from "@higma-document-renderers/fig/scene-graph";
import type { Effect, FrameNode, GroupNode, PathContour, PathNode, RectNode, SceneNodeId } from "@higma-document-renderers/fig/scene-graph";
import {
  canRenderContainerOpacityWithInheritedOpacity,
  canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary,
  getRenderFrameLocalSurfaceFilterInputBounds,
  getRenderNodeLocalAuthoredBounds,
  getRenderNodeLocalFrameChildClipBounds,
  RENDER_NODE_SOURCE_TRANSFORMS,
  renderNodeIntersectsViewport,
  resolveRenderNodeLocalSourceEffectInputBounds,
  resolveRenderNodeLocalSubtreeVisualBounds,
  resolveRenderNodeOutputBoundsAffectedByTranslatedNode,
} from "./render-node-visual-coverage";

function makeRect(overrides: Partial<RenderRectNode> = {}): RenderRectNode {
  const source: RectNode = {
    id: "rect" as SceneNodeId,
    type: "rect",
    name: "Rect",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    width: 100,
    height: 80,
    fills: [],
    stroke: undefined,
    effects: [],
    opacity: 1,
  };
  return {
    id: "rect" as SceneNodeId,
    type: "rect",
    width: 100,
    height: 80,
    fill: { attrs: { fill: "none" } },
    wrapper: {},
    defs: [],
    needsWrapper: false,
    source,
    sourceFills: [],
    ...overrides,
  };
}

function makeTranslatedRect(x: number, y: number, overrides: Partial<RenderRectNode> = {}): RenderRectNode {
  const rect = makeRect(overrides);
  return {
    ...rect,
    source: {
      ...rect.source,
      transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y },
    },
  };
}

function makeTranslatedRectWithId(id: string, x: number, y: number, overrides: Partial<RenderRectNode> = {}): RenderRectNode {
  return makeTranslatedRect(x, y, {
    id: id as SceneNodeId,
    source: {
      ...makeRect().source,
      id: id as SceneNodeId,
      name: id,
    },
    ...overrides,
  });
}

function makeResolvedPath(): RenderPathNode {
  const source: PathNode = {
    id: "path" as SceneNodeId,
    type: "path",
    name: "Path",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    contours: [],
    fills: [],
    effects: [],
    opacity: 1,
  };
  return {
    id: "path" as SceneNodeId,
    type: "path",
    paths: [{ d: "M 1200 1200 L 1300 1200 L 1300 1300 Z" }],
    fill: { attrs: { fill: "none" } },
    wrapper: {},
    defs: [],
    needsWrapper: false,
    source,
    sourceContours: [rectContour(1200, 1200, 100, 100)],
    sourceFills: [],
  };
}

function makeGroup(children: RenderGroupNode["children"]): RenderGroupNode {
  const source: GroupNode = {
    id: "group" as SceneNodeId,
    type: "group",
    name: "Group",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    effects: [],
    children: [],
  };
  return {
    id: "group" as SceneNodeId,
    type: "group",
    children,
    wrapper: {},
    defs: [],
    source,
    canUnwrapSingleChild: false,
  };
}

function rectContour(x: number, y: number, width: number, height: number): PathContour {
  return {
    commands: [
      { type: "M", x, y },
      { type: "L", x: x + width, y },
      { type: "L", x: x + width, y: y + height },
      { type: "L", x, y: y + height },
      { type: "Z" },
    ],
    windingRule: "nonzero",
  };
}

function makeFrame(
  children: RenderFrameNode["children"],
  overrides: Partial<RenderFrameNode> = {},
): RenderFrameNode {
  const source: FrameNode = {
    id: "frame" as SceneNodeId,
    type: "frame",
    name: "Frame",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    effects: [],
    width: 320,
    height: 240,
    surfaceShape: { type: "rect", width: 320, height: 240 },
    fills: [],
    clipsContent: false,
    children: [],
  };
  return {
    id: "frame" as SceneNodeId,
    type: "frame",
    children,
    background: null,
    wrapper: {},
    defs: [],
    width: 320,
    height: 240,
    surfaceShape: { kind: "rect", width: 320, height: 240 },
    sourceSurfaceShape: { type: "rect", width: 320, height: 240 },
    sourceFills: [],
    source,
    ...overrides,
  };
}

describe("RenderTree RenderNode visual coverage", () => {
  it("resolves authored bounds from RenderNode geometry without stroke or effects", () => {
    const node = makeRect({
      sourceStroke: {
        width: 20,
        linecap: "butt",
        linejoin: "miter",
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        align: "OUTSIDE",
      },
      source: {
        ...makeRect().source,
        stroke: {
          width: 20,
          linecap: "butt",
          linejoin: "miter",
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          align: "OUTSIDE",
        },
        effects: [{
          type: "drop-shadow",
          offset: { x: 200, y: 0 },
          radius: 40,
          color: { r: 0, g: 0, b: 0, a: 1 },
          showShadowBehindNode: true,
        }],
      },
    });

    expect(getRenderNodeLocalAuthoredBounds(node)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 80,
    });
  });

  it("resolves frame child clip bounds from RenderNode geometry and stroke without source effects", () => {
    const node = makeRect({
      sourceStroke: {
        width: 20,
        linecap: "butt",
        linejoin: "miter",
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        align: "OUTSIDE",
      },
      source: {
        ...makeRect().source,
        stroke: {
          width: 20,
          linecap: "butt",
          linejoin: "miter",
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          align: "OUTSIDE",
        },
        effects: [{
          type: "drop-shadow",
          offset: { x: 200, y: 0 },
          radius: 40,
          color: { r: 0, g: 0, b: 0, a: 1 },
          showShadowBehindNode: true,
        }],
      },
    });

    expect(getRenderNodeLocalFrameChildClipBounds(node)).toEqual({
      minX: -20,
      minY: -20,
      maxX: 120,
      maxY: 100,
    });
  });

  it("skips a rectangular frame child clip when every child visual subtree is contained", () => {
    expect(canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
      node: makeFrame([
        makeTranslatedRect(24, 32),
      ], {
        childClipId: "frame-children",
      }),
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    })).toBe(true);
  });

  it("keeps a rectangular frame child clip when a child visual subtree crosses the frame edge", () => {
    expect(canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
      node: makeFrame([
        makeTranslatedRect(260, 32),
      ], {
        childClipId: "frame-children",
      }),
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    })).toBe(false);
  });

  it("keeps a rectangular frame child clip when an effect crosses the frame edge", () => {
    const child = makeTranslatedRect(220, 32, {
      source: {
        ...makeRect().source,
        effects: [{
          type: "drop-shadow",
          offset: { x: 40, y: 0 },
          radius: 24,
          color: { r: 0, g: 0, b: 0, a: 1 },
          showShadowBehindNode: true,
        }],
      },
    });

    expect(canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
      node: makeFrame([child], {
        childClipId: "frame-children",
      }),
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    })).toBe(false);
  });

  it("skips a rounded frame child clip when child visual bounds cannot reach rounded corners", () => {
    expect(canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
      node: makeFrame([
        makeTranslatedRect(80, 80),
      ], {
        childClipId: "frame-children",
        sourceSurfaceShape: { type: "rect", width: 320, height: 240, cornerRadius: 16 },
      }),
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    })).toBe(true);
  });

  it("keeps a rounded frame child clip when child visual bounds can reach a rounded corner", () => {
    expect(canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
      node: makeFrame([
        makeTranslatedRect(4, 4),
      ], {
        childClipId: "frame-children",
        sourceSurfaceShape: { type: "rect", width: 320, height: 240, cornerRadius: 32 },
      }),
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    })).toBe(false);
  });

  it("skips visual nodes outside the padded viewport", () => {
    const node = makeRect();

    expect(renderNodeIntersectsViewport({
      node,
      transform: { m00: 1, m01: 0, m02: 1200, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 100 },
    })).toBe(false);
  });

  it("keeps nodes whose shared effect bounds reach the viewport", () => {
    const node = makeRect({
      source: {
        ...makeRect().source,
        effects: [{ type: "drop-shadow", offset: { x: 200, y: 0 }, radius: 40, color: { r: 0, g: 0, b: 0, a: 1 }, showShadowBehindNode: true }],
      },
    });

    expect(renderNodeIntersectsViewport({
      node,
      transform: { m00: 1, m01: 0, m02: -260, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0 },
    })).toBe(true);
  });

  it("uses stroke-expanded node content as the source-effect input before applying the node source effects", () => {
    const node = makeRect({
      sourceStroke: {
        width: 20,
        linecap: "butt",
        linejoin: "miter",
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
      },
      source: {
        ...makeRect().source,
        effects: [{
          type: "drop-shadow",
          offset: { x: 200, y: 0 },
          radius: 40,
          color: { r: 0, g: 0, b: 0, a: 1 },
          showShadowBehindNode: true,
        }],
      },
    });

    expect(resolveRenderNodeLocalSourceEffectInputBounds({ node: node, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toEqual({
      minX: -10,
      minY: -10,
      maxX: 110,
      maxY: 90,
    });
  });

  it("uses the frame source surface as the frame base visual bounds", () => {
    const surfaceShape = { type: "path", contours: [rectContour(20, 30, 70, 40)] } as const;
    const base = makeFrame([]);
    const frame: RenderFrameNode = {
      ...base,
      sourceSurfaceShape: surfaceShape,
      source: {
        ...base.source,
        surfaceShape,
      },
    };

    expect(resolveRenderNodeLocalSourceEffectInputBounds({ node: frame, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toEqual({
      minX: 20,
      minY: 30,
      maxX: 90,
      maxY: 70,
    });
  });

  it("resolves frame surface filter input from the RenderFrameNode surface paint only", () => {
    const frame = makeFrame([makeTranslatedRect(280, 0)], {
      surfaceFilterAttr: "url(#frame-surface-filter)",
      childClipId: "frame-children",
      background: {
        fill: { attrs: { fill: "#ffffff" } },
      },
      sourceFills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 }],
    });

    expect(getRenderFrameLocalSurfaceFilterInputBounds(frame)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 320,
      maxY: 240,
    });
  });

  it("does not invent a frame surface filter input when the RenderFrameNode has no surface filter", () => {
    expect(getRenderFrameLocalSurfaceFilterInputBounds(makeFrame([makeTranslatedRect(0, 0)]))).toBeNull();
  });

  it("clips frame child visual contribution with the RenderFrameNode child clip", () => {
    const child = makeTranslatedRect(280, 0, {
      source: {
        ...makeRect().source,
        effects: [{
          type: "drop-shadow",
          offset: { x: 120, y: 0 },
          radius: 0,
          color: { r: 0, g: 0, b: 0, a: 1 },
          showShadowBehindNode: true,
        }],
      },
    });
    const frame = makeFrame([child], {
      childClipId: "frame-children",
    });

    expect(resolveRenderNodeLocalSourceEffectInputBounds({ node: frame, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 320,
      maxY: 240,
    });
  });

  it("clips group child visual contribution with the RenderGroupNode source clip", () => {
    const base = makeGroup([makeTranslatedRect(70, 0)]);
    const group: RenderGroupNode = {
      ...base,
      childClipId: "group-clip",
      source: {
        ...base.source,
        clip: { type: "rect", width: 100, height: 100 },
      },
    };

    expect(resolveRenderNodeLocalSubtreeVisualBounds({ node: group, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toEqual({
      minX: 70,
      minY: 0,
      maxX: 100,
      maxY: 80,
    });
  });

  it("resolves translated-descendant subtree visual bounds from the full RenderNode parent content", () => {
    const parentEffects: readonly Effect[] = [{
      type: "drop-shadow",
      offset: { x: 200, y: 0 },
      radius: 40,
      color: { r: 0, g: 0, b: 0, a: 1 },
      showShadowBehindNode: true,
    }];
    const baseParent = makeGroup([
      makeTranslatedRectWithId("target", 0, 0),
      makeTranslatedRectWithId("sibling", 300, 0),
    ]);
    const parent = {
      ...baseParent,
      source: {
        ...baseParent.source,
        effects: parentEffects,
      },
    };
    const expected = resolveEffectBounds(parentEffects, {
      x: 300,
      y: 0,
      width: 200,
      height: 80,
    });

    expect(resolveRenderNodeLocalSubtreeVisualBounds({
      node: parent,
      visualTransform: { type: "scene-graph-node-translation", translation: { nodeId: "target" as SceneNodeId, dx: 400, dy: 0 } },
    })).toEqual({
      minX: expected.x,
      minY: expected.y,
      maxX: expected.x + expected.width,
      maxY: expected.y + expected.height,
    });
  });

  it("resolves translated target and dependent ancestor visual bounds from RenderTree parent-child dependencies", () => {
    const parentEffects: readonly Effect[] = [{
      type: "drop-shadow",
      offset: { x: 220, y: 0 },
      radius: 40,
      color: { r: 0, g: 0, b: 0, a: 1 },
      showShadowBehindNode: true,
    }];
    const baseParent = makeGroup([
      makeTranslatedRectWithId("target", -260, 20),
    ]);
    const parent: RenderGroupNode = {
      ...baseParent,
      source: {
        ...baseParent.source,
        effects: parentEffects,
      },
    };
    const previousParentBounds = resolveEffectBounds(parentEffects, { x: -260, y: 20, width: 100, height: 80 });
    const translatedParentBounds = resolveEffectBounds(parentEffects, { x: -140, y: 20, width: 100, height: 80 });

    expect(resolveRenderNodeOutputBoundsAffectedByTranslatedNode({
      children: [parent],
      outputTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      translation: { nodeId: "target" as SceneNodeId, dx: 120, dy: 0 },
    })).toEqual({
      targetNode: parent.children[0],
      previousTargetOutputBounds: { minX: -260, minY: 20, maxX: -160, maxY: 100 },
      translatedTargetOutputBounds: { minX: -140, minY: 20, maxX: -40, maxY: 100 },
      ancestorCompositedOutputBounds: [
        {
          minX: previousParentBounds.x,
          minY: previousParentBounds.y,
          maxX: previousParentBounds.x + previousParentBounds.width,
          maxY: previousParentBounds.y + previousParentBounds.height,
        },
        {
          minX: translatedParentBounds.x,
          minY: translatedParentBounds.y,
          maxX: translatedParentBounds.x + translatedParentBounds.width,
          maxY: translatedParentBounds.y + translatedParentBounds.height,
        },
      ],
      backdropDependentOutputBounds: [],
    });
  });

  it("keeps background blur sampling bounds out of visual output bounds", () => {
    const node = makeRect({
      source: {
        ...makeRect().source,
        effects: [{
          type: "background-blur",
          radius: 40,
        }],
      },
      backgroundBlur: {
        stdDeviation: 20,
        clipId: "blur-clip",
        backdropBounds: { x: -40, y: -40, width: 180, height: 160 },
      },
    });

    expect(resolveRenderNodeLocalSubtreeVisualBounds({ node: node, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 80,
    });
  });

  it("includes later sibling background blur output when a moved node intersects its backdrop sampling bounds", () => {
    const blurSource = {
      ...makeRect().source,
      id: "background-blur" as SceneNodeId,
      name: "background-blur",
      effects: [{
        type: "background-blur",
        radius: 40,
      }],
    } satisfies RectNode;
    const parent = makeGroup([
      makeTranslatedRectWithId("target", 0, 0),
      makeTranslatedRectWithId("background-blur", 160, 0, {
        source: blurSource,
        backgroundBlur: {
          stdDeviation: 20,
          clipId: "background-blur-clip",
          backdropBounds: { x: -40, y: -40, width: 180, height: 160 },
        },
      }),
    ]);

    expect(resolveRenderNodeOutputBoundsAffectedByTranslatedNode({
      children: [parent],
      outputTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      translation: { nodeId: "target" as SceneNodeId, dx: 160, dy: 0 },
    })?.backdropDependentOutputBounds).toEqual([
      { minX: 160, minY: 0, maxX: 260, maxY: 80 },
    ]);
  });

  it("skips nodes whose shared effect bounds stay outside the viewport", () => {
    const node = makeRect({
      source: {
        ...makeRect().source,
        effects: [{ type: "drop-shadow", offset: { x: 200, y: 0 }, radius: 40, color: { r: 0, g: 0, b: 0, a: 1 }, showShadowBehindNode: true }],
      },
    });

    expect(renderNodeIntersectsViewport({
      node,
      transform: { m00: 1, m01: 0, m02: 620, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0 },
    })).toBe(false);
  });

  it("does not drop tiny visible nodes unless a min pixel area is explicitly requested", () => {
    const node = makeRect();

    expect(renderNodeIntersectsViewport({
      node,
      transform: { m00: 0.001, m01: 0, m02: 10, m10: 0, m11: 0.001, m12: 10 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0 },
    })).toBe(true);
  });

  it("uses explicit min pixel area as a caller-owned cutoff", () => {
    const node = makeRect();

    expect(renderNodeIntersectsViewport({
      node,
      transform: { m00: 0.001, m01: 0, m02: 10, m10: 0, m11: 0.001, m12: 10 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0, minPixelArea: 1 },
    })).toBe(false);
  });

  it("keeps tiny transformed stroke-only geometry when stroke width is still visible", () => {
    const node = makeRect({
      sourceStroke: {
        width: 1000,
        linecap: "butt",
        linejoin: "miter",
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
      },
      source: {
        ...makeRect().source,
        stroke: {
          width: 1000,
          linecap: "butt",
          linejoin: "miter",
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
        },
      },
    });

    expect(renderNodeIntersectsViewport({
      node,
      transform: { m00: 0.001, m01: 0, m02: 10, m10: 0, m11: 0.001, m12: 10 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0, minPixelArea: 1 },
    })).toBe(true);
  });

  it("uses RenderNode source contours for path bounds", () => {
    expect(renderNodeIntersectsViewport({
      node: makeResolvedPath(),
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0 },
    })).toBe(false);
  });

  it("skips a group subtree when every child is outside the padded viewport", () => {
    const group = makeGroup([makeRect({
      source: {
        ...makeRect().source,
        transform: { m00: 1, m01: 0, m02: 1200, m10: 0, m11: 1, m12: 0 },
      },
    })]);

    expect(renderNodeIntersectsViewport({
      node: group,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 100 },
    })).toBe(false);
  });

  it("keeps a group subtree when one child intersects the padded viewport", () => {
    const group = makeGroup([
      makeRect({
        source: {
          ...makeRect().source,
          transform: { m00: 1, m01: 0, m02: 1200, m10: 0, m11: 1, m12: 0 },
        },
      }),
      makeRect({
        source: {
          ...makeRect().source,
          transform: { m00: 1, m01: 0, m02: 100, m10: 0, m11: 1, m12: 0 },
        },
      }),
    ]);

    expect(renderNodeIntersectsViewport({
      node: group,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 100 },
    })).toBe(true);
  });

  it("keeps a group subtree when the group source effect moves child output into the viewport", () => {
    const base = makeGroup([
      makeTranslatedRect(-260, 20),
    ]);
    const group: RenderGroupNode = {
      ...base,
      source: {
        ...base.source,
        effects: [{
          type: "drop-shadow",
          offset: { x: 220, y: 0 },
          radius: 40,
          color: { r: 0, g: 0, b: 0, a: 1 },
          showShadowBehindNode: true,
        }],
      },
    };

    expect(renderNodeIntersectsViewport({
      node: group,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0 },
    })).toBe(true);
  });

  it("uses the active SceneGraph node translation when testing a container subtree against the viewport", () => {
    const group = makeGroup([
      makeTranslatedRectWithId("target", -220, 0),
    ]);
    const viewport = { x: 0, y: 0, width: 100, height: 100 };

    expect(renderNodeIntersectsViewport({
      node: group,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      viewport,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0 },
    })).toBe(false);
    expect(renderNodeIntersectsViewport({
      node: group,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      viewport,
      visualTransform: { type: "scene-graph-node-translation", translation: { nodeId: "target" as SceneNodeId, dx: 260, dy: 0 } },
      options: { paddingPx: 0 },
    })).toBe(true);
  });

  it("uses the active SceneGraph node translation when deciding inherited container opacity", () => {
    const group = makeGroup([
      makeTranslatedRectWithId("first", 0, 0),
      makeTranslatedRectWithId("second", 140, 0),
    ]);

    expect(canRenderContainerOpacityWithInheritedOpacity({
      node: group,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    })).toBe(true);
    expect(canRenderContainerOpacityWithInheritedOpacity({
      node: group,
      visualTransform: { type: "scene-graph-node-translation", translation: { nodeId: "second" as SceneNodeId, dx: -80, dy: 0 } },
    })).toBe(false);
  });

  it("uses the active SceneGraph node translation when deciding whether a frame child clip can be omitted", () => {
    const frame = makeFrame([
      makeTranslatedRectWithId("target", 80, 80),
    ], {
      childClipId: "frame-children",
      sourceSurfaceShape: { type: "rect", width: 320, height: 240, cornerRadius: 32 },
    });

    expect(canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
      node: frame,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    })).toBe(true);
    expect(canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
      node: frame,
      visualTransform: { type: "scene-graph-node-translation", translation: { nodeId: "target" as SceneNodeId, dx: -90, dy: -90 } },
    })).toBe(false);
  });

  it("memoises path bounds so pan/zoom rerenders reuse the same RenderPathNode source contours", () => {
    // Pan/zoom only changes the viewport transform. The RenderTree
    // cache hands the same `RenderPathNode` instance back to the
    // renderer every frame, so the visual bounds cache must be keyed by
    // that RenderNode object and must not re-read path geometry after
    // the first local-bounds resolution.
    const node = makeResolvedPath();
    // First call populates the bounds cache.
    const transformA = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const transformB = { m00: 2, m01: 0, m02: -100, m10: 0, m11: 2, m12: -100 };
    expect(renderNodeIntersectsViewport({
      node,
      transform: transformA,
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0 },
    })).toBe(false);

    // Once cached, mutating `sourceContours` must not affect the
    // visibility decision for the same RenderNode object.
    const mutableContours = node.sourceContours as PathContour[];
    mutableContours[0] = rectContour(0, 0, 10, 10);
    expect(renderNodeIntersectsViewport({
      node,
      transform: transformB,
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: { paddingPx: 0 },
    })).toBe(false);
  });

  it("allows inherited opacity for non-overlapping children that do not need isolation", () => {
    const group = makeGroup([
      makeTranslatedRect(0, 0),
      makeTranslatedRect(140, 0),
    ]);

    expect(canRenderContainerOpacityWithInheritedOpacity({ node: group, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toBe(true);
  });

  it("keeps isolated opacity when child visual bounds overlap", () => {
    const group = makeGroup([
      makeTranslatedRect(0, 0),
      makeTranslatedRect(80, 0),
    ]);

    expect(canRenderContainerOpacityWithInheritedOpacity({ node: group, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toBe(false);
  });

  it("keeps isolated opacity when a child carries effect output", () => {
    const shadowed = makeTranslatedRect(0, 0, {
      source: {
        ...makeRect().source,
        effects: [{
          type: "drop-shadow",
          offset: { x: 40, y: 0 },
          radius: 10,
          color: { r: 0, g: 0, b: 0, a: 0.4 },
          showShadowBehindNode: true,
        }],
      },
    });
    const group = makeGroup([
      shadowed,
      makeTranslatedRect(120, 0),
    ]);

    expect(canRenderContainerOpacityWithInheritedOpacity({ node: group, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toBe(false);
  });

  it("keeps isolated opacity for frames with their own surface paint", () => {
    const frame = makeFrame([makeTranslatedRect(140, 0)], {
      background: {
        fill: { attrs: { fill: "#000000" } },
      },
      sourceFills: [{ type: "solid", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
    });

    expect(canRenderContainerOpacityWithInheritedOpacity({ node: frame, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS })).toBe(false);
  });
});
