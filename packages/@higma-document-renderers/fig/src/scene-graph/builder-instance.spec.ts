/** @file Scene graph INSTANCE rendering tests using SymbolResolver as the SoT. */

import { buildSceneGraph } from "./builder";
import type { FrameNode } from "@higma-document-renderers/fig/scene-graph";
import {
  createKiwiRenderFixture,
  KIWI_RENDER_COLORS,
  kiwiGuid,
  kiwiNode,
  kiwiRenderResources,
  kiwiSolidPaint,
} from "../testing/kiwi-render-fixture";
import { STACK_COUNTER_ALIGN_VALUES, STACK_MODE_VALUES } from "@higma-document-models/fig/constants";

function buildComponentsPage(): ReturnType<typeof buildSceneGraph> {
  const fixture = createKiwiRenderFixture();
  return buildSceneGraph(fixture.resources.childrenOf(fixture.pages.components), {
    blobs: fixture.resources.blobs,
    images: fixture.resources.images,
    canvasSize: { width: 1200, height: 800 },
    viewport: { x: 0, y: 0, width: 1200, height: 800 },
    sourceDocumentReference: fixture.document,
    sourceRevision: 0,
    symbolResolver: fixture.resources.symbolResolver,
    childrenOf: fixture.resources.childrenOf,
    styleRegistry: fixture.resources.styleRegistry,
    showHiddenNodes: false,
    warnings: [],
    textFontResolver: undefined,
  });
}

function findFrameByName(nodes: readonly FrameNode[], name: string): FrameNode {
  const match = nodes.find((node) => node.name === name);
  if (match === undefined) {
    throw new Error(`Expected frame ${name} in scene graph`);
  }
  return match;
}

describe("buildSceneGraph INSTANCE resolution", () => {
  it("inherits SYMBOL fills and children through SymbolResolver", () => {
    const sceneGraph = buildComponentsPage();
    const frames = sceneGraph.root.children.filter((node): node is FrameNode => node.type === "frame");
    const defaultButton = findFrameByName(frames, "Default");

    expect(defaultButton.children.length).toBe(1);
    expect(defaultButton.cornerRadius).toBe(8);
    expect(defaultButton.fills[0].type).toBe("solid");
    if (defaultButton.fills[0].type === "solid") {
      expect(defaultButton.fills[0].color.r).toBeCloseTo(KIWI_RENDER_COLORS.blue.r, 2);
      expect(defaultButton.fills[0].color.b).toBeCloseTo(KIWI_RENDER_COLORS.blue.b, 2);
    }
  });

  it("does not let direct INSTANCE fillPaints override the SYMBOL root", () => {
    const sceneGraph = buildComponentsPage();
    const frames = sceneGraph.root.children.filter((node): node is FrameNode => node.type === "frame");
    const dangerButton = findFrameByName(frames, "Danger");

    expect(dangerButton.fills[0].type).toBe("solid");
    if (dangerButton.fills[0].type === "solid") {
      expect(dangerButton.fills[0].color.r).toBeCloseTo(KIWI_RENDER_COLORS.blue.r, 2);
      expect(dangerButton.fills[0].color.b).toBeCloseTo(KIWI_RENDER_COLORS.blue.b, 2);
    }
  });

  it("applies a self override that is routed through symbolData.symbolOverrides", () => {
    const page = kiwiNode({ guid: kiwiGuid(50, 1), type: "CANVAS", name: "Page" });
    const symbol = kiwiNode({
      guid: kiwiGuid(50, 10),
      type: "SYMBOL",
      name: "Symbol",
      parentGuid: page.guid,
      position: "a",
      visible: false,
      width: 100,
      height: 50,
      fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.red)],
    });
    const instance = kiwiNode({
      guid: kiwiGuid(50, 20),
      type: "INSTANCE",
      name: "Instance",
      parentGuid: page.guid,
      position: "b",
      width: 100,
      height: 50,
      symbolData: {
        symbolID: symbol.guid,
        symbolOverrides: [{
          guidPath: { guids: [symbol.guid] },
          fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.green)],
        }],
      },
    });
    const resources = kiwiRenderResources([page, symbol, instance]);
    const sceneGraph = buildSceneGraph(resources.childrenOf(page), {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 200, height: 100 },
      viewport: { x: 0, y: 0, width: 200, height: 100 },
      sourceDocumentReference: resources.document,
      sourceRevision: 0,
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const frame = sceneGraph.root.children[0] as FrameNode;

    expect(frame.fills[0].type).toBe("solid");
    if (frame.fills[0].type === "solid") {
      expect(frame.fills[0].color.g).toBeCloseTo(KIWI_RENDER_COLORS.green.g, 2);
    }
  });

  it("consumes the model autolayout solver for counter-axis stretch", () => {
    const page = kiwiNode({ guid: kiwiGuid(60, 1), type: "CANVAS", name: "Page" });
    const frame = kiwiNode({
      guid: kiwiGuid(60, 2),
      type: "FRAME",
      name: "Stack",
      parentGuid: page.guid,
      position: "a",
      width: 370,
      height: 52,
      stackMode: { value: STACK_MODE_VALUES.VERTICAL, name: "VERTICAL" },
    });
    const separator = kiwiNode({
      guid: kiwiGuid(60, 3),
      type: "RECTANGLE",
      name: "Separator",
      parentGuid: frame.guid,
      position: "a",
      width: 129,
      height: 1,
      stackChildAlignSelf: { value: STACK_COUNTER_ALIGN_VALUES.STRETCH, name: "STRETCH" },
      fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.dark)],
    });
    const resources = kiwiRenderResources([page, frame, separator]);
    const sceneGraph = buildSceneGraph(resources.childrenOf(page), {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: 400, height: 80 },
      viewport: { x: 0, y: 0, width: 400, height: 80 },
      sourceDocumentReference: resources.document,
      sourceRevision: 0,
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    });
    const stack = sceneGraph.root.children[0] as FrameNode;

    expect(stack.children[0].type).toBe("rect");
    if (stack.children[0].type === "rect") {
      expect(stack.children[0].width).toBe(370);
    }
  });
});
