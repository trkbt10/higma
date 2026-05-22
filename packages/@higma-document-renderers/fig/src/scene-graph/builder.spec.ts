/** @file Scene graph builder integration tests over Kiwi FigNode inputs. */

import { buildSceneGraph } from "./builder";
import { renderSceneGraphToSvg } from "../svg";
import { encodeSvgPathBlob } from "@higma-document-models/fig/node-factory";
import { STACK_COUNTER_ALIGN_VALUES, STACK_MODE_VALUES, STROKE_ALIGN_VALUES, STYLE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigNode } from "@higma-document-models/fig/types";
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

function buildFixturePage(pageNodes: readonly FigNode[]) {
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

  it("renders Kiwi variant-set FRAME chrome as Figma's dashed component-set outline", () => {
    const frame = {
      ...kiwiNode({
        guid: kiwiGuid(42, 4),
        type: "FRAME",
        name: "State group",
        width: 384,
        height: 196,
        strokePaints: [kiwiSolidPaint({ r: 0.5921568870544434, g: 0.27843138575553894, b: 1, a: 1 })],
        strokeWeight: 1,
        cornerRadius: 5,
      }),
      strokeAlign: { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" as const },
      isStateGroup: true,
      componentPropDefs: [{
        id: kiwiGuid(42, 5),
        name: "Property 1",
        type: { value: 4, name: "VARIANT" as const },
      }],
    };

    const sceneGraph = buildFixturePage([frame]);
    const built = sceneGraph.root.children[0] as FrameNode;
    const svg = String(renderSceneGraphToSvg(sceneGraph));

    expect(built.stroke?.dashPattern).toEqual([10, 5]);
    expect(svg).toContain('stroke-dasharray="10 5"');
  });

  it("preserves raw Kiwi FRAME child positions instead of replaying auto-layout", () => {
    const frame = {
      ...kiwiNode({
        guid: kiwiGuid(42, 40),
        type: "FRAME",
        name: "Authored auto-layout frame",
        width: 402,
        height: 48,
      }),
      stackMode: { value: STACK_MODE_VALUES.HORIZONTAL, name: "HORIZONTAL" },
      stackCounterAlignItems: { value: STACK_COUNTER_ALIGN_VALUES.CENTER, name: "CENTER" },
      stackSpacing: 8,
      stackVerticalPadding: 10,
      stackHorizontalPadding: 20,
      stackPaddingRight: 20,
    };
    const first = kiwiNode({
      guid: kiwiGuid(42, 41),
      type: "FRAME",
      name: "First chip",
      parentGuid: frame.guid,
      position: "a",
      x: 20,
      y: 10,
      width: 110,
      height: 38,
    });
    const second = kiwiNode({
      guid: kiwiGuid(42, 42),
      type: "FRAME",
      name: "Second chip",
      parentGuid: frame.guid,
      position: "b",
      x: 138,
      y: 10,
      width: 186,
      height: 38,
    });
    const resources = kiwiRenderResources([frame, first, second]);
    const sceneGraph = buildSceneGraph([frame], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 402, height: 48 },
      viewport: { x: 0, y: 0, width: 402, height: 48 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const built = sceneGraph.root.children[0] as FrameNode;

    expect(built.children[0]!.transform.m12).toBe(10);
    expect(built.children[1]!.transform.m12).toBe(10);
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

  it("keeps Kiwi strokeGeometry as authored stroke outline geometry", () => {
    const fillBlob = encodeSvgPathBlob("M 0 0 L 20 0 L 20 20 L 0 20 Z");
    const strokeBlob = encodeSvgPathBlob("M -1 -1 L 21 -1 L 21 21 L -1 21 Z");
    const vector = {
      ...kiwiNode({
        guid: kiwiGuid(42, 222),
        type: "VECTOR",
        name: "Geometry stroked vector",
        width: 20,
        height: 20,
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
        strokePaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.dark)],
        strokeWeight: 1,
      }),
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
      strokeGeometry: [{ commandsBlob: 1, styleID: 0 }],
      strokeAlign: { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" as const },
    };
    const resources = kiwiRenderResources([vector], [{ bytes: fillBlob.bytes }, { bytes: strokeBlob.bytes }]);
    const sceneGraph = buildSceneGraph([vector], {
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
    expect(built.contours[0].commands[0]).toEqual({ type: "M", x: 0, y: 0 });
    expect(built.strokeContours?.[0].commands[0]).toEqual({ type: "M", x: -1, y: -1 });
    expect(built.stroke?.align).toBe("INSIDE");
  });

  it("keeps ELLIPSE nodes parametric even when Kiwi carries fillGeometry", () => {
    const blob = encodeSvgPathBlob("M 4 0 L 96 0 L 80 80 L 0 64 Z");
    const ellipse = {
      ...kiwiNode({
        guid: kiwiGuid(42, 220),
        type: "ELLIPSE",
        name: "Geometry-backed ellipse",
        width: 100,
        height: 100,
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
      }),
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const resources = kiwiRenderResources([ellipse], [{ bytes: blob.bytes }]);
    const sceneGraph = buildSceneGraph([ellipse], {
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
    const built = sceneGraph.root.children[0] as EllipseNode;

    expect(built.type).toBe("ellipse");
    expect(built.rx).toBe(50);
    expect(renderSceneGraphToSvg(sceneGraph)).toContain('<circle cx="50" cy="50" r="50"');
  });

  it("keeps nested smoothed rounded rectangles parametric even when Kiwi carries fillGeometry", () => {
    const blob = encodeSvgPathBlob("M 0 41.6 C 0 18.6 18.6 0 41.6 0 L 118 0 L 118 118 L 0 118 Z");
    const frame = kiwiNode({
      guid: kiwiGuid(42, 23),
      type: "FRAME",
      name: "Container",
      width: 140,
      height: 140,
    });
    const rect = {
      ...kiwiNode({
        guid: kiwiGuid(42, 24),
        parentGuid: frame.guid,
        type: "ROUNDED_RECTANGLE",
        name: "Nested app icon mask",
        width: 118,
        height: 118,
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
      }),
      cornerRadius: 26,
      cornerSmoothing: 0.6,
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const resources = kiwiRenderResources([frame, rect], [{ bytes: blob.bytes }]);
    const sceneGraph = buildSceneGraph([frame], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 140, height: 140 },
      viewport: { x: 0, y: 0, width: 140, height: 140 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const builtFrame = sceneGraph.root.children[0] as FrameNode;
    const built = builtFrame.children[0] as RectNode;

    expect(built.type).toBe("rect");
    expect(built.cornerRadius).toBe(26);
    expect(built.cornerSmoothing).toBeUndefined();
  });

  it("keeps effect-bearing smoothed rounded rectangle roots parametric when Kiwi carries fillGeometry", () => {
    const blob = encodeSvgPathBlob("M 0 32 C 0 14.3 14.3 0 32 0 L 100 0 L 100 80 L 0 80 Z");
    const rect = {
      ...kiwiNode({
        guid: kiwiGuid(42, 25),
        type: "ROUNDED_RECTANGLE",
        name: "Shadowed card",
        width: 100,
        height: 80,
        fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
        effects: [kiwiInnerShadow()],
      }),
      cornerRadius: 20,
      cornerSmoothing: 0.6,
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const resources = kiwiRenderResources([rect], [{ bytes: blob.bytes }]);
    const sceneGraph = buildSceneGraph([rect], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 120, height: 100 },
      viewport: { x: 0, y: 0, width: 120, height: 100 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const built = sceneGraph.root.children[0] as RectNode;

    expect(built.type).toBe("rect");
    expect(built.cornerRadius).toBe(20);
    expect(built.cornerSmoothing).toBeUndefined();
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

  it("keeps nested smoothed FRAME surfaces parametric even when Kiwi carries fillGeometry", () => {
    const clipBlob = encodeSvgPathBlob("M 0 32 C 0 14.3 14.3 0 32 0 L 120 0 L 120 96 L 0 96 Z");
    const parent = kiwiNode({
      guid: kiwiGuid(42, 32),
      type: "FRAME",
      name: "Parent",
      width: 160,
      height: 120,
    });
    const frame = {
      ...kiwiNode({
        guid: kiwiGuid(42, 33),
        parentGuid: parent.guid,
        type: "FRAME",
        name: "Nested smoothed frame",
        width: 120,
        height: 96,
        frameMaskDisabled: false,
      }),
      cornerRadius: 20,
      cornerSmoothing: 0.6,
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const resources = kiwiRenderResources([parent, frame], [{ bytes: clipBlob.bytes }]);
    const sceneGraph = buildSceneGraph([parent], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 160, height: 120 },
      viewport: { x: 0, y: 0, width: 160, height: 120 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const builtParent = sceneGraph.root.children[0] as FrameNode;
    const built = builtParent.children[0] as FrameNode;

    expect(built.surfaceShape.type).toBe("rect");
    expect(built.clip?.type).toBe("rect");
    expect(built.cornerSmoothing).toBeUndefined();
  });

  it("uses Kiwi smoothed geometry for resolved INSTANCE roots", () => {
    const clipBlob = encodeSvgPathBlob("M 0 38.4 C 0 24.9587 0 18.2381 2.61584 13.1042 C 4.9168 8.58834 8.58834 4.9168 13.1042 2.61584 C 18.2381 0 24.9587 0 38.4 0 L 314.6 0 C 328.041 0 334.762 0 339.896 2.61584 C 344.412 4.9168 348.083 8.58834 350.384 13.1042 C 353 18.2381 353 24.9587 353 38.4 L 353 588.6 C 353 602.041 353 608.762 350.384 613.896 C 348.083 618.412 344.412 622.083 339.896 624.384 C 334.762 627 328.041 627 314.6 627 L 38.4 627 C 24.9587 627 18.2381 627 13.1042 624.384 C 8.58834 622.083 4.9168 618.412 2.61584 613.896 C 0 608.762 0 602.041 0 588.6 Z");
    const parent = kiwiNode({
      guid: kiwiGuid(42, 38),
      type: "FRAME",
      name: "Parent",
      width: 402,
      height: 874,
    });
    const symbol = {
      ...kiwiNode({
        guid: kiwiGuid(42, 39),
        type: "SYMBOL",
        name: "Smoothed symbol",
        width: 353,
        height: 627,
        frameMaskDisabled: false,
      }),
      cornerRadius: 24,
      cornerSmoothing: 0.6,
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const instance = {
      ...kiwiNode({
        guid: kiwiGuid(42, 40),
        parentGuid: parent.guid,
        type: "INSTANCE",
        name: "Nested smoothed instance",
        width: 353,
        height: 627,
        frameMaskDisabled: false,
        symbolData: { symbolID: symbol.guid },
      }),
      cornerSmoothing: 0.6,
    };
    const resources = kiwiRenderResources([parent, symbol, instance], [{ bytes: clipBlob.bytes }]);
    const sceneGraph = buildSceneGraph([parent], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 402, height: 874 },
      viewport: { x: 0, y: 0, width: 402, height: 874 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const builtParent = sceneGraph.root.children[0] as FrameNode;
    const built = builtParent.children[0] as FrameNode;

    expect(built.surfaceShape.type).toBe("path");
    expect(built.clip?.type).toBe("path");
    expect(built.cornerSmoothing).toBe(0.6);
  });

  it("keeps effect-bearing smoothed FRAME roots parametric when Kiwi carries fillGeometry", () => {
    const clipBlob = encodeSvgPathBlob("M 0 32 C 0 14.3 14.3 0 32 0 L 120 0 L 120 96 L 0 96 Z");
    const frame = {
      ...kiwiNode({
        guid: kiwiGuid(42, 34),
        type: "FRAME",
        name: "Shadowed smoothed frame",
        width: 120,
        height: 96,
        frameMaskDisabled: false,
        effects: [kiwiInnerShadow()],
      }),
      cornerRadius: 20,
      cornerSmoothing: 0.6,
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
    };
    const resources = kiwiRenderResources([frame], [{ bytes: clipBlob.bytes }]);
    const sceneGraph = buildSceneGraph([frame], {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 120, height: 96 },
      viewport: { x: 0, y: 0, width: 120, height: 96 },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const built = sceneGraph.root.children[0] as FrameNode;

    expect(built.surfaceShape.type).toBe("rect");
    expect(built.clip?.type).toBe("rect");
    expect(built.cornerSmoothing).toBeUndefined();
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
    expect(maskedGroup.mask?.maskType).toBe("ALPHA");
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
