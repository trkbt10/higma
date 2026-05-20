/** @file Scene graph builder integration tests over Kiwi FigNode inputs. */

import { buildSceneGraph } from "./builder";
import { renderSceneGraphToSvg } from "../svg";
import { encodeSvgPathBlob } from "@higma-document-models/fig/node-factory";
import { STYLE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type {
  EllipseNode,
  Fill,
  FrameNode,
  GroupNode,
  PathNode,
  RectNode,
  SceneNode,
} from "@higma-document-renderers/fig/scene-graph";
import { createKiwiRenderFixture, kiwiRenderResources, kiwiNode, kiwiGuid, kiwiSolidPaint, kiwiInnerShadow, KIWI_RENDER_COLORS } from "../testing/kiwi-render-fixture";

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
  it("builds shape nodes directly from Kiwi page children", () => {
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

  it("uses Kiwi shape geometry instead of re-synthesizing rounded rectangles", () => {
    const blob = encodeSvgPathBlob("M 4 0 L 96 0 L 80 80 L 0 64 Z");
    const rect = {
      ...kiwiNode({
        guid: kiwiGuid(42, 22),
        type: "ROUNDED_RECTANGLE",
        name: "Geometry rounded rect",
        width: 100,
        height: 80,
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
      }),
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const resources = kiwiRenderResources([rect], [{ bytes: blob.bytes }]);
    const sceneGraph = buildSceneGraph([rect], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 1200, height: 800 },
      viewport: { x: 0, y: 0, width: 1200, height: 800 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const built = sceneGraph.root.children[0] as PathNode;

    expect(built.type).toBe("path");
    expect(built.contours[0].commands).toEqual([
      { type: "M", x: 4, y: 0 },
      { type: "L", x: 96, y: 0 },
      { type: "L", x: 80, y: 80 },
      { type: "L", x: 0, y: 64 },
      { type: "L", x: 4, y: 0 },
    ]);
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

  it("resolves Kiwi styleIdForEffect through the style registry for FRAME decorations", () => {
    const effectStyle = {
      ...kiwiNode({
        guid: kiwiGuid(42, 13),
        type: "RECTANGLE",
        name: "Frame effect style",
        effects: [{ ...kiwiInnerShadow(), radius: 12 }],
      }),
      styleType: { value: STYLE_TYPE_VALUES.EFFECT, name: "EFFECT" },
    };
    const frame = {
      ...kiwiNode({
        guid: kiwiGuid(42, 14),
        type: "FRAME",
        name: "Styled effect frame",
        width: 100,
        height: 80,
        effects: [{ ...kiwiInnerShadow(), radius: 2 }],
      }),
      styleIdForEffect: { guid: effectStyle.guid },
    };
    const resources = kiwiRenderResources([effectStyle, frame]);
    const sceneGraph = buildSceneGraph([frame], {
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
    expect(built.effects[0]).toMatchObject({
      type: "inner-shadow",
      radius: 12,
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

  it("uses Kiwi FRAME fillGeometry as the frame surface shape", () => {
    const clipBlob = encodeSvgPathBlob("M 0 0 L 96 0 L 96 72 L 0 72 Z");
    const frame = {
      ...kiwiNode({
        guid: kiwiGuid(42, 31),
        type: "FRAME",
        name: "Geometry clipped frame",
        width: 100,
        height: 80,
        frameMaskDisabled: false,
      }),
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const resources = kiwiRenderResources([frame], [{ bytes: clipBlob.bytes }]);
    const sceneGraph = buildSceneGraph([frame], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 1200, height: 800 },
      viewport: { x: 0, y: 0, width: 1200, height: 800 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const built = sceneGraph.root.children[0] as FrameNode;

    expect(built.surfaceShape.type).toBe("path");
    expect(built.clip?.type).toBe("path");
  });

  it("uses Kiwi GROUP fillGeometry as the child clip shape", () => {
    const clipBlob = encodeSvgPathBlob("M 0 0 L 80 0 L 80 60 L 0 60 Z");
    const group = {
      ...kiwiNode({
        guid: kiwiGuid(42, 36),
        type: "GROUP",
        name: "Geometry clipped group",
      }),
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const child = kiwiNode({
      guid: kiwiGuid(42, 37),
      type: "RECTANGLE",
      name: "Oversized child",
      parentGuid: group.guid,
      width: 100,
      height: 100,
      fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
    });
    const resources = kiwiRenderResources([group, child], [{ bytes: clipBlob.bytes }]);
    const sceneGraph = buildSceneGraph([group], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 1200, height: 800 },
      viewport: { x: 0, y: 0, width: 1200, height: 800 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const built = sceneGraph.root.children[0] as GroupNode;

    expect(built.type).toBe("group");
    expect(built.clip?.type).toBe("path");
    if (built.clip?.type === "path") {
      expect(built.clip.contours[0].commands).toEqual([
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 80, y: 0 },
        { type: "L", x: 80, y: 60 },
        { type: "L", x: 0, y: 60 },
        { type: "L", x: 0, y: 0 },
      ]);
    }
  });

  it("uses explicit Kiwi mask nodes as mask sources", () => {
    const maskSource = {
      ...kiwiNode({
        guid: kiwiGuid(42, 32),
        type: "VECTOR",
        name: "Explicit mask contour",
        width: 100,
        height: 100,
        mask: true,
      }),
      vectorPaths: [{
        windingRule: { value: 0, name: "NONZERO" },
        data: "M 0 0 L 100 0 L 100 100 L 0 100 Z M 20 20 L 80 20 L 80 80 L 20 80 Z M 40 40 L 60 40 L 60 60 L 40 60 Z",
      }],
    };
    const maskedRect = kiwiNode({
      guid: kiwiGuid(42, 33),
      type: "RECTANGLE",
      name: "Masked rect",
      width: 100,
      height: 100,
      fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
    });
    const resources = kiwiRenderResources([maskSource, maskedRect]);
    const sceneGraph = buildSceneGraph([maskSource, maskedRect], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 1200, height: 800 },
      viewport: { x: 0, y: 0, width: 1200, height: 800 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const maskedGroup = sceneGraph.root.children[0] as GroupNode;

    expect(sceneGraph.root.children).toHaveLength(1);
    expect(maskedGroup.type).toBe("group");
    expect(maskedGroup.mask?.maskContent.id).toBe("42:32");
    expect(maskedGroup.children.map((child) => child.id)).toEqual(["42:33"]);
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

  it("renders precomputed vector geometry even when Kiwi omits node size", () => {
    const node = {
      ...kiwiNode({
        guid: kiwiGuid(40, 3),
        type: "VECTOR",
        name: "Size omitted vector",
        width: 120,
        height: 48,
        vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 L 120 0 L 120 48 L 0 48 Z" }],
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.white)],
      }),
      size: undefined,
    };
    const sceneGraph = buildFixturePage([node]);
    const child = sceneGraph.root.children[0] as PathNode;

    expect(child.type).toBe("path");
    expect(child.contours[0].commands.length).toBeGreaterThan(0);
    expect(child.width).toBeUndefined();
    expect(child.height).toBeUndefined();
  });

  it("collects gradient fills when Kiwi paints author gradients", () => {
    const fixture = createKiwiRenderFixture();
    const sceneGraph = buildFixturePage(fixture.resources.childrenOf(fixture.pages.shapes));
    const allFills = findAllByType(sceneGraph.root.children, "rect")
      .flatMap((node) => (node as RectNode).fills) as Fill[];

    expect(allFills.some((fill) => fill.type === "solid")).toBe(true);
  });
});
