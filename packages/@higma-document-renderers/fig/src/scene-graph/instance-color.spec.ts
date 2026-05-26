/** @file INSTANCE color inheritance through scene graph. */

import { buildSceneGraph } from "./builder";
import type { FrameNode, SceneNode } from "@higma-document-renderers/fig/scene-graph";
import { createKiwiRenderFixture, KIWI_RENDER_COLORS } from "../testing/kiwi-render-fixture";

function findSceneNode(nodes: readonly SceneNode[], name: string): SceneNode {
  const found = findOptionalSceneNode(nodes, name);
  if (found !== undefined) {
    return found;
  }
  throw new Error(`Scene graph does not contain ${name}`);
}

function findChildrenNode(node: SceneNode, name: string): SceneNode | undefined {
  if (!("children" in node)) {
    return undefined;
  }
  return findOptionalSceneNode(node.children, name);
}

function findOptionalSceneNode(nodes: readonly SceneNode[], name: string): SceneNode | undefined {
  for (const node of nodes) {
    if (node.name === name) {
      return node;
    }
    const found = findChildrenNode(node, name);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function buildScene() {
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

describe("INSTANCE color inheritance in scene graph", () => {
  it("default INSTANCE inherits SYMBOL fills", () => {
    const defaultButton = findSceneNode(buildScene().root.children, "Default") as FrameNode;

    expect(defaultButton.type).toBe("frame");
    expect(defaultButton.fills.length).toBeGreaterThan(0);
    expect(defaultButton.fills[0].type).toBe("solid");
    if (defaultButton.fills[0].type === "solid") {
      expect(defaultButton.fills[0].color.r).toBeCloseTo(KIWI_RENDER_COLORS.blue.r, 2);
      expect(defaultButton.fills[0].color.b).toBeCloseTo(KIWI_RENDER_COLORS.blue.b, 2);
    }
  });

  it("direct INSTANCE fillPaints do not override SYMBOL fills", () => {
    const dangerButton = findSceneNode(buildScene().root.children, "Danger") as FrameNode;

    expect(dangerButton.type).toBe("frame");
    expect(dangerButton.fills[0].type).toBe("solid");
    if (dangerButton.fills[0].type === "solid") {
      expect(dangerButton.fills[0].color.r).toBeCloseTo(KIWI_RENDER_COLORS.blue.r, 2);
      expect(dangerButton.fills[0].color.b).toBeCloseTo(KIWI_RENDER_COLORS.blue.b, 2);
    }
  });
});
