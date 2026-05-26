/** @file WebGL geometry cache memoisation tests. */

import type { ClipPathShape, Fill, PathNode, SceneNodeId, StrokeShape, TextNode } from "@higma-document-renderers/fig/scene-graph";
import type { RenderPathNode, RenderTextNode } from "../../scene-graph";
import { createWebGLGeometryCache } from "./geometry-cache";

function makeRenderPathNode(overrides: Partial<RenderPathNode> = {}): RenderPathNode {
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
  const solidFill: Fill = {
    type: "solid",
    color: { r: 1, g: 0, b: 0, a: 1 },
    opacity: 1,
  };
  return {
    id: "path" as SceneNodeId,
    type: "path",
    paths: [{ d: "M 0 0 L 100 0 L 100 100 L 0 100 Z" }],
    fill: { attrs: { fill: "#ff0000", fillOpacity: 1 } },
    wrapper: {},
    defs: [],
    needsWrapper: false,
    source,
    sourceContours: [],
    sourceFills: [solidFill],
    ...overrides,
  };
}

function makeRenderTextNode(overrides: Partial<RenderTextNode> = {}): RenderTextNode {
  const source: TextNode = {
    id: "text" as SceneNodeId,
    type: "text",
    name: "Text",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    effects: [],
    width: 100,
    height: 40,
    textAutoResize: "NONE",
    glyphContours: [],
    runs: [],
    fills: [{ color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
  };
  return {
    id: "text" as SceneNodeId,
    type: "text",
    width: 100,
    height: 40,
    fillColor: "#000000",
    fillOpacity: 1,
    content: {
      mode: "glyphs",
      runs: [{
        fillColor: "#000000",
        fillOpacity: 1,
        d: "M 0 0 L 10 0 L 10 10 L 0 10 Z",
      }],
    },
    wrapper: {},
    defs: [],
    source,
    sourceTextAutoResize: "NONE",
    ...overrides,
  };
}

describe("createWebGLGeometryCache — viewport-only rerender memoisation", () => {
  it("returns identical PathGeometry references for repeated lookups (so pan/zoom never re-flattens)", () => {
    const cache = createWebGLGeometryCache();
    const node = makeRenderPathNode();
    const first = cache.getPathGeometry(node);
    const second = cache.getPathGeometry(node);
    expect(second).toBe(first);
    expect(second.parsedContours).toBe(first.parsedContours);
    expect(second.elementSize).toBe(first.elementSize);
  });

  it("invalidates PathGeometry when a rebuilt RenderPathNode changes path content", () => {
    const cache = createWebGLGeometryCache();
    const firstNode = makeRenderPathNode();
    const changedNode = makeRenderPathNode({
      paths: [{ d: "M 0 0 L 50 0 L 50 50 L 0 50 Z" }],
    });

    const first = cache.getPathGeometry(firstNode);
    const changed = cache.getPathGeometry(changedNode);

    expect(changed).not.toBe(first);
    expect(changed.elementSize).toEqual({ width: 50, height: 50 });
  });

  it("returns identical fill-plan instructions across rerenders, including prepared fan vertices and cover quads", () => {
    const cache = createWebGLGeometryCache();
    const node = makeRenderPathNode();
    const first = cache.getPathFillPlanGeometry(node);
    const second = cache.getPathFillPlanGeometry(node);
    expect(second).toBe(first);
    expect(second.instructions).toBe(first.instructions);
    expect(second.instructions[0]?.prepared).toBe(first.instructions[0]?.prepared);
    expect(second.instructions[0]?.coverQuad).toBe(first.instructions[0]?.coverQuad);
  });

  it("uses RenderNode references as the fill-plan cache key", () => {
    const cache = createWebGLGeometryCache();
    const firstNode = makeRenderPathNode();

    const first = cache.getPathFillPlanGeometry(firstNode);
    const rebuilt = cache.getPathFillPlanGeometry(makeRenderPathNode());

    expect(rebuilt).not.toBe(first);
  });

  it("exposes a control-hull element size that matches the path's outer extent", () => {
    const cache = createWebGLGeometryCache();
    const node = makeRenderPathNode();
    const { elementSize } = cache.getPathGeometry(node);
    expect(elementSize).toEqual({ width: 100, height: 100 });
  });

  it("keys rect vertices by corner smoothing as part of the geometry key", () => {
    const cache = createWebGLGeometryCache();
    const radii = [24, 4, 16, 8] as const;
    const standard = cache.getRectVertices(100, 80, radii);
    const smoothed = cache.getRectVertices(100, 80, radii, 0.6);
    const smoothedAgain = cache.getRectVertices(100, 80, radii, 0.6);

    expect(smoothed).toBe(smoothedAgain);
    expect(smoothed).not.toBe(standard);
    expect(smoothed.length).toBeGreaterThan(0);
  });

  it("keeps value-keyed rect geometry until renderer disposal instead of releasing by entry count", () => {
    const cache = createWebGLGeometryCache();
    const first = cache.getRectVertices(100, 80);
    const distinctRectGeometryCount = 4096;

    for (let index = 0; index < distinctRectGeometryCount; index += 1) {
      cache.getRectVertices(101 + index, 80);
    }

    expect(cache.getRectVertices(100, 80)).toBe(first);
  });

  it("returns identical rect stroke vertices for repeated stroke dependencies", () => {
    const cache = createWebGLGeometryCache();
    const first = cache.getRectStrokeVertices({
      width: 100,
      height: 80,
      cornerRadius: [8, 4, 8, 4],
      strokeWidth: 2,
      dashPattern: [4, 2],
    });
    const second = cache.getRectStrokeVertices({
      width: 100,
      height: 80,
      cornerRadius: [8, 4, 8, 4],
      strokeWidth: 2,
      dashPattern: [4, 2],
    });

    expect(second).toBe(first);
  });

  it("invalidates rect stroke vertices when stroke dependencies change", () => {
    const cache = createWebGLGeometryCache();
    const first = cache.getRectStrokeVertices({
      width: 100,
      height: 80,
      cornerRadius: 8,
      strokeWidth: 2,
    });
    const changed = cache.getRectStrokeVertices({
      width: 100,
      height: 80,
      cornerRadius: 8,
      strokeWidth: 4,
    });

    expect(changed).not.toBe(first);
  });

  it("returns identical ellipse stroke vertices for repeated stroke dependencies", () => {
    const cache = createWebGLGeometryCache();
    const first = cache.getEllipseStrokeVertices({
      cx: 50,
      cy: 40,
      rx: 30,
      ry: 20,
      strokeWidth: 2,
    });
    const second = cache.getEllipseStrokeVertices({
      cx: 50,
      cy: 40,
      rx: 30,
      ry: 20,
      strokeWidth: 2,
    });

    expect(second).toBe(first);
  });

  it("returns identical stroke-shape vertices for rebuilt stroke shape objects with the same content", () => {
    const cache = createWebGLGeometryCache();
    const firstShape: StrokeShape = { kind: "rect", width: 100, height: 80, cornerRadius: 8 };
    const rebuiltShape: StrokeShape = { kind: "rect", width: 100, height: 80, cornerRadius: 8 };

    const first = cache.getStrokeShapeStrokeVertices({ shape: firstShape, strokeWidth: 2 });
    const rebuilt = cache.getStrokeShapeStrokeVertices({ shape: rebuiltShape, strokeWidth: 2 });

    expect(rebuilt).toBe(first);
  });

  it("returns identical clip-path shape vertices for rebuilt clip shape objects with the same content", () => {
    const cache = createWebGLGeometryCache();
    const firstShape: ClipPathShape = { kind: "rect", x: 4, y: 8, width: 100, height: 80, rx: 6 };
    const rebuiltShape: ClipPathShape = { kind: "rect", x: 4, y: 8, width: 100, height: 80, rx: 6 };

    const first = cache.getClipPathShapeVertices(firstShape);
    const rebuilt = cache.getClipPathShapeVertices(rebuiltShape);

    expect(rebuilt).toBe(first);
  });

  it("invalidates text glyph geometry when a rebuilt RenderTextNode changes glyph paths", () => {
    const cache = createWebGLGeometryCache();
    const firstNode = makeRenderTextNode();
    const changedNode = makeRenderTextNode({
      content: {
        mode: "glyphs",
        runs: [{
          fillColor: "#000000",
          fillOpacity: 1,
          d: "M 0 0 L 20 0 L 20 20 L 0 20 Z",
        }],
      },
    });

    const first = cache.getTextGlyphGeometry(firstNode);
    const changed = cache.getTextGlyphGeometry(changedNode);

    expect(changed).not.toBe(first);
    expect(changed.runs[0]?.vertices).not.toBe(first.runs[0]?.vertices);
  });

  it("invalidates text glyph geometry when a rebuilt RenderTextNode changes glyph paint data", () => {
    const cache = createWebGLGeometryCache();
    const firstNode = makeRenderTextNode();
    const changedNode = makeRenderTextNode({
      content: {
        mode: "glyphs",
        runs: [{
          fillColor: "#ff0000",
          fillOpacity: 1,
          d: "M 0 0 L 10 0 L 10 10 L 0 10 Z",
        }],
      },
    });

    const first = cache.getTextGlyphGeometry(firstNode);
    const changed = cache.getTextGlyphGeometry(changedNode);

    expect(changed).not.toBe(first);
    expect(changed.runs[0]?.fillColor).toBe("#ff0000");
  });

  it("invalidates path stroke vertices when a rebuilt RenderPathNode changes stroke dependencies", () => {
    const cache = createWebGLGeometryCache();
    const firstNode = makeRenderPathNode();
    const rebuiltNode = makeRenderPathNode();
    const firstContours = cache.getPathGeometry(firstNode).parsedContours;
    const rebuiltContours = cache.getPathGeometry(rebuiltNode).parsedContours;

    const first = cache.getPathStrokeVertices({ node: firstNode, contours: firstContours, strokeWidth: 2 });
    const changed = cache.getPathStrokeVertices({ node: rebuiltNode, contours: rebuiltContours, strokeWidth: 4 });

    expect(changed).not.toBe(first);
  });
});
