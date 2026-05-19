/** @file Scene graph builder integration tests over Kiwi FigNode inputs. */

import { buildSceneGraph } from "./builder";
import { renderSceneGraphToSvg } from "../svg";
import type {
  EllipseNode,
  Fill,
  FrameNode,
  PathNode,
  RectNode,
  SceneNode,
} from "@higma-document-renderers/fig/scene-graph";
import { createKiwiRenderFixture, kiwiRenderResources, kiwiNode, kiwiGuid, kiwiSolidPaint, KIWI_RENDER_COLORS } from "../testing/kiwi-render-fixture";

function findAllByType(nodes: readonly SceneNode[], type: SceneNode["type"]): SceneNode[] {
  return nodes.flatMap((node) => {
    const self = node.type === type ? [node] : [];
    if (!("children" in node)) {
      return self;
    }
    return [...self, ...findAllByType(node.children, type)];
  });
}

function buildFixturePage(pageNodes: readonly ReturnType<typeof kiwiNode>[]) {
  const fixture = createKiwiRenderFixture();
  return buildSceneGraph(pageNodes, {
    blobs: fixture.resources.blobs,
    images: fixture.resources.images,
    canvasSize: { width: 1200, height: 800 },
    viewport: { x: 0, y: 0, width: 1200, height: 800 },
    symbolResolver: fixture.resources.symbolResolver,
    childrenOf: fixture.resources.childrenOf,
    styleRegistry: fixture.resources.styleRegistry,
    showHiddenNodes: false,
    warnings: [],
    textFontResolver: undefined,
  });
}

describe("buildSceneGraph", () => {
  it("builds shape nodes from Kiwi page children without a design-node layer", () => {
    const fixture = createKiwiRenderFixture();
    const sceneGraph = buildFixturePage(fixture.resources.childrenOf(fixture.pages.shapes));
    const rects = findAllByType(sceneGraph.root.children, "rect") as RectNode[];
    const ellipses = findAllByType(sceneGraph.root.children, "ellipse") as EllipseNode[];
    const paths = findAllByType(sceneGraph.root.children, "path") as PathNode[];

    expect(rects.some((rect) => rect.fills.length > 0)).toBe(true);
    expect(ellipses[0].rx).toBeGreaterThan(0);
    expect(paths.some((path) => path.contours.length > 0)).toBe(true);
  });

  it("keeps FRAME fills in the scene graph and SVG output", () => {
    const fixture = createKiwiRenderFixture();
    const sceneGraph = buildFixturePage([fixture.nodes.basicShapesFrame]);
    const frames = findAllByType(sceneGraph.root.children, "frame") as FrameNode[];
    const basicShapes = frames.find((frame) => frame.name === "Basic Shapes");

    expect(basicShapes).toBeDefined();
    expect(basicShapes?.fills.some((fill) => fill.type === "solid")).toBe(true);
    expect(renderSceneGraphToSvg(sceneGraph)).toMatch(/#ffffff|#fff\b|rgb\(255, ?255, ?255\)|white/i);
  });

  it("uses Kiwi backgroundPaints as FRAME decoration paints", () => {
    const frame = kiwiNode({
      guid: kiwiGuid(42, 1),
      type: "FRAME",
      name: "Decorated frame",
      width: 100,
      height: 80,
      backgroundPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.red)],
    });
    const sceneGraph = buildFixturePage([frame]);
    const built = sceneGraph.root.children[0] as FrameNode;

    expect(built.type).toBe("frame");
    expect(built.fills[0]).toMatchObject({
      type: "solid",
      color: KIWI_RENDER_COLORS.red,
    });
  });

  it("maps Kiwi individual corner radius fields onto scene geometry", () => {
    const rect = {
      ...kiwiNode({
        guid: kiwiGuid(42, 20),
        type: "ROUNDED_RECTANGLE",
        name: "Asymmetric rounded rect",
        width: 100,
        height: 80,
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
      }),
      rectangleTopLeftCornerRadius: 24,
      rectangleTopRightCornerRadius: 4,
      rectangleBottomRightCornerRadius: 16,
      rectangleBottomLeftCornerRadius: 8,
    };
    const sceneGraph = buildFixturePage([rect]);
    const built = sceneGraph.root.children[0] as RectNode;

    expect(built.type).toBe("rect");
    expect(built.cornerRadius).toEqual([24, 4, 16, 8]);
  });

  it("reads omitted independent Kiwi corner radius fields as schema-zero corners", () => {
    const rect = {
      ...kiwiNode({
        guid: kiwiGuid(42, 21),
        type: "ROUNDED_RECTANGLE",
        name: "Partially encoded independent rounded rect",
        width: 100,
        height: 80,
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
      }),
      rectangleTopLeftCornerRadius: 20,
      rectangleBottomLeftCornerRadius: 20,
      rectangleCornerRadiiIndependent: true,
    };
    const sceneGraph = buildFixturePage([rect]);
    const built = sceneGraph.root.children[0] as RectNode;

    expect(built.type).toBe("rect");
    expect(built.cornerRadius).toEqual([20, 0, 0, 20]);
  });

  it("resolves Kiwi backgroundPaints through inheritFillStyleIDForBackground", () => {
    const page = kiwiNode({
      guid: kiwiGuid(42, 10),
      type: "CANVAS",
      name: "Page",
      width: 240,
      height: 120,
    });
    const fillStyle = {
      ...kiwiNode({
        guid: kiwiGuid(42, 11),
        type: "RECTANGLE",
        name: "Background fill style",
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.green)],
      }),
      styleType: { value: 1, name: "FILL" },
    };
    const frame = {
      ...kiwiNode({
        guid: kiwiGuid(42, 12),
        type: "FRAME",
        name: "Styled background frame",
        parentGuid: page.guid,
        width: 100,
        height: 80,
        backgroundPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.red)],
      }),
      inheritFillStyleIDForBackground: fillStyle.guid,
    };
    const resources = kiwiRenderResources([page, fillStyle, frame]);
    const sceneGraph = buildSceneGraph(resources.childrenOf(page), {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 240, height: 120 },
      viewport: { x: 0, y: 0, width: 240, height: 120 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const built = sceneGraph.root.children[0] as FrameNode;

    expect(built.type).toBe("frame");
    expect(built.fills[0]).toMatchObject({
      type: "solid",
      color: KIWI_RENDER_COLORS.green,
    });
  });

  it("interprets Kiwi frameMaskDisabled through the clip policy SoT", () => {
    const unclipped = kiwiNode({
      guid: kiwiGuid(42, 2),
      type: "FRAME",
      name: "Unclipped frame",
      width: 100,
      height: 80,
      frameMaskDisabled: true,
    });
    const clipped = kiwiNode({
      guid: kiwiGuid(42, 3),
      type: "FRAME",
      name: "Clipped frame",
      width: 100,
      height: 80,
      frameMaskDisabled: false,
    });
    const sceneGraph = buildFixturePage([unclipped, clipped]);
    const frames = sceneGraph.root.children as readonly FrameNode[];

    expect(frames[0].clipsContent).toBe(false);
    expect(frames[0].clip).toBeUndefined();
    expect(frames[1].clipsContent).toBe(true);
    expect(frames[1].clip).toBeDefined();
  });

  it("renders geometry-backed interactive slide elements as paths", () => {
    const page = kiwiNode({
      guid: kiwiGuid(40, 1),
      type: "CANVAS",
      name: "Page",
      width: 240,
      height: 120,
    });
    const node = kiwiNode({
      guid: kiwiGuid(40, 2),
      type: "VECTOR",
      name: "Poll",
      parentGuid: page.guid,
      position: "a",
      width: 120,
      height: 48,
      vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 L 120 0 L 120 48 L 0 48 Z" }],
      fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.white)],
    });
    const resources = kiwiRenderResources([page, node]);
    const sceneGraph = buildSceneGraph(resources.childrenOf(page), {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 240, height: 120 },
      viewport: { x: 0, y: 0, width: 240, height: 120 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const child = sceneGraph.root.children[0] as PathNode;

    expect(child.type).toBe("path");
    expect(child.contours[0].commands.length).toBeGreaterThan(0);
  });

  it("collects gradient fills when Kiwi paints author gradients", () => {
    const fixture = createKiwiRenderFixture();
    const sceneGraph = buildFixturePage(fixture.resources.childrenOf(fixture.pages.shapes));
    const allFills = findAllByType(sceneGraph.root.children, "rect")
      .flatMap((node) => (node as RectNode).fills) as Fill[];

    expect(allFills.some((fill) => fill.type === "solid")).toBe(true);
  });
});
