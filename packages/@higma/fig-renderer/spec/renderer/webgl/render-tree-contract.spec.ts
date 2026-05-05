/** @file RenderTree-to-WebGL SoT contract audits across renderer fixtures. */

import path from "node:path";
import { resolveRenderTree, type RenderTree } from "../../../src/scene-graph/render-tree";
import { auditWebGLRenderTreeContract } from "../../../src/webgl/render-tree-contract";
import { buildFrameSceneGraph, loadFigFixture } from "./test-utils";

const FIXTURE_ROOT = path.resolve(__dirname, "../../../fixtures");

type FixtureCase = {
  readonly label: string;
  readonly figPath: string;
};

type FixtureIssue = {
  readonly fixture: string;
  readonly frameName: string;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly message: string;
};

const FIXTURES: readonly FixtureCase[] = [
  { label: "frames", figPath: path.join(FIXTURE_ROOT, "frame-properties/frame-properties.fig") },
  { label: "clips", figPath: path.join(FIXTURE_ROOT, "clips/clips.fig") },
  { label: "components", figPath: path.join(FIXTURE_ROOT, "components/components.fig") },
  { label: "symbol-resolution", figPath: path.join(FIXTURE_ROOT, "symbol-resolution/symbol-resolution.fig") },
  { label: "sections", figPath: path.join(FIXTURE_ROOT, "section/section.fig") },
  { label: "vectors", figPath: path.join(FIXTURE_ROOT, "shapes/shapes.fig") },
  { label: "vector-winding", figPath: path.join(FIXTURE_ROOT, "vector-winding/vector-winding.fig") },
  { label: "image-fill", figPath: path.join(FIXTURE_ROOT, "image-fill/image-fill.fig") },
  { label: "text-webgl", figPath: path.join(FIXTURE_ROOT, "text-webgl/text-webgl.fig") },
];

describe("WebGL RenderTree contract", () => {
  it("reports RenderTextLines as an error", () => {
    const renderTree: RenderTree = {
      width: 20,
      height: 20,
      viewport: { x: 0, y: 0, width: 20, height: 20 },
      children: [{
        type: "text",
        id: "line-text",
        wrapper: {},
        defs: [],
        source: {
          type: "text",
          id: "line-text",
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 20,
          height: 20,
          textAutoResize: "WIDTH_AND_HEIGHT",
          fill: { color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 },
          textLineLayout: {
            lines: [{ text: "A", x: 0, y: 10 }],
            fontFamily: "sans-serif",
            fontSize: 10,
            lineHeight: 10,
            textAnchor: "start",
          },
        },
        width: 20,
        height: 20,
        fillColor: "#000000",
        content: {
          mode: "lines",
          layout: {
            lines: [{ text: "A", x: 0, y: 10 }],
            fontFamily: "sans-serif",
            fontSize: 10,
            lineHeight: 10,
            textAnchor: "start",
          },
        },
        sourceFillColor: { r: 0, g: 0, b: 0, a: 1 },
        sourceFillOpacity: 1,
        sourceTextAutoResize: "WIDTH_AND_HEIGHT",
      }],
    };

    const stats = auditWebGLRenderTreeContract(renderTree);

    expect(stats.issues).toEqual([{
      nodeId: "line-text",
      nodeType: "text",
      message: "WebGL requires glyph text; RenderTextLines must be resolved before WebGL rendering",
    }]);
  });

  it("keeps WebGL consumption aligned with RenderTree node units across fixtures", async () => {
    const aggregate = {
      frames: 0,
      rects: 0,
      ellipses: 0,
      paths: 0,
      texts: 0,
      images: 0,
      clippedFrames: 0,
      pathContours: 0,
      pathFillInstructions: 0,
      lineTexts: 0,
    };
    const issues: FixtureIssue[] = [];

    for (const fixture of FIXTURES) {
      const data = await loadFigFixture(fixture.figPath);
      for (const frame of data.frames.values()) {
        const sceneGraph = buildFrameSceneGraph(frame, data);
        const renderTree = resolveRenderTree(sceneGraph);
        const stats = auditWebGLRenderTreeContract(renderTree);
        for (const issue of stats.issues) {
          issues.push({
            fixture: fixture.label,
            frameName: frame.name,
            nodeId: issue.nodeId,
            nodeType: issue.nodeType,
            message: issue.message,
          });
        }
        aggregate.frames += stats.frames;
        aggregate.rects += stats.rects;
        aggregate.ellipses += stats.ellipses;
        aggregate.paths += stats.paths;
        aggregate.texts += stats.texts;
        aggregate.images += stats.images;
        aggregate.clippedFrames += stats.clippedFrames;
        aggregate.pathContours += stats.pathContours;
        aggregate.pathFillInstructions += stats.pathFillInstructions;
        aggregate.lineTexts += stats.lineTexts;
      }
    }

    expect(aggregate.frames).toBeGreaterThan(0);
    expect(aggregate.rects).toBeGreaterThan(0);
    expect(aggregate.ellipses).toBeGreaterThan(0);
    expect(aggregate.paths).toBeGreaterThan(0);
    expect(aggregate.texts).toBeGreaterThan(0);
    expect(aggregate.clippedFrames).toBeGreaterThan(0);
    expect(aggregate.pathContours).toBe(aggregate.pathFillInstructions);
    expect(issues).toEqual([
      {
        fixture: "components",
        frameName: "Button",
        nodeId: "0:12",
        nodeType: "text",
        message: "WebGL requires glyph text; RenderTextLines must be resolved before WebGL rendering",
      },
      {
        fixture: "components",
        frameName: "Card",
        nodeId: "0:23",
        nodeType: "text",
        message: "WebGL requires glyph text; RenderTextLines must be resolved before WebGL rendering",
      },
    ]);
  }, 120_000);
});
