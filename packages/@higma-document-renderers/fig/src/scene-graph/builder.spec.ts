/**
 * @file Scene graph builder integration tests
 *
 * Verifies that the full pipeline from FigDesignDocument → SceneGraph
 * correctly produces renderable nodes for all content types in the demo.
 */


import { createDemoFigDesignDocument } from "../testing/demo-document";
import { EMPTY_FIG_STYLE_REGISTRY, toNodeId, type FigBlob, type FigDesignDocument, type FigDesignNode } from "@higma-document-models/fig/domain";
import { buildSceneGraph } from "./builder";
import { renderSceneGraphToSvg } from "../svg/scene-renderer";
import type { SceneGraph, SceneNode, RectNode, EllipseNode, PathNode, TextNode, FrameNode, Fill } from "@higma-document-models/fig/scene-graph";

const docRef = { value: undefined as FigDesignDocument | undefined };
const sceneGraphsRef = { value: [] as SceneGraph[] };
const IDENTITY_TRANSFORM = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

beforeAll(async () => {
  const doc = await createDemoFigDesignDocument();
  docRef.value = doc;
  sceneGraphsRef.value = doc.pages.map((page) =>
    buildSceneGraph(page.children, {
      blobs: doc.blobs,
      images: doc.images,
      canvasSize: { width: 1200, height: 800 },
      viewport: { x: 0, y: 0, width: 1200, height: 800 },
      symbolMap: doc.components,
      styleRegistry: doc.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: undefined,
    }),
  );
});

function findAllByType(nodes: readonly SceneNode[], type: string): SceneNode[] {
  const result: SceneNode[] = [];
  for (const node of nodes) {
    if (node.type === type) {result.push(node);}
    if ("children" in node && node.children) {
      result.push(...findAllByType(node.children, type));
    }
  }
  return result;
}

function encodeFloat32LE(value: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return Array.from(new Uint8Array(buf));
}

function encodeMoveTo(x: number, y: number): number[] {
  return [0x01, ...encodeFloat32LE(x), ...encodeFloat32LE(y)];
}

function encodeLineTo(x: number, y: number): number[] {
  return [0x02, ...encodeFloat32LE(x), ...encodeFloat32LE(y)];
}

function buildRectGeometryBlob(width: number, height: number): FigBlob {
  return {
    bytes: [
      ...encodeMoveTo(0, 0),
      ...encodeLineTo(width, 0),
      ...encodeLineTo(width, height),
      ...encodeLineTo(0, height),
      0x06,
    ],
  };
}

function buildSingleNodeSceneGraph(node: FigDesignNode, blobs: readonly FigBlob[]): SceneGraph {
  return buildSceneGraph([node], {
    blobs,
    images: new Map(),
    canvasSize: { width: 1200, height: 800 },
    viewport: { x: 0, y: 0, width: 1200, height: 800 },
    symbolMap: new Map(),
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
    showHiddenNodes: false,
    warnings: [],
    textFontResolver: undefined,
  });
}

describe("Scene graph builder - demo document", () => {
  it("builds scene graphs for all pages (3 visible + 1 internal)", () => {
    expect(sceneGraphsRef.value.length).toBeGreaterThanOrEqual(3);
  });

  describe("Page 1: Shapes & Fills", () => {
    it("produces rect nodes for rectangles", () => {
      const sg = sceneGraphsRef.value[0];
      const rects = findAllByType(sg.root.children, "rect");
      expect(rects.length).toBeGreaterThan(0);
      const rectWithFill = rects.find((r) => (r as RectNode).fills.length > 0);
      expect(rectWithFill).toBeDefined();
    });

    it("produces ellipse nodes", () => {
      const sg = sceneGraphsRef.value[0];
      const ellipses = findAllByType(sg.root.children, "ellipse");
      expect(ellipses.length).toBeGreaterThan(0);
      const ellipse = ellipses[0] as EllipseNode;
      expect(ellipse.rx).toBeGreaterThan(0);
    });

    it("produces path nodes with contours for star/polygon", () => {
      const sg = sceneGraphsRef.value[0];
      const paths = findAllByType(sg.root.children, "path");
      // Star and polygon should produce paths with synthesized geometry
      expect(paths.length).toBeGreaterThan(0);
      // All path nodes should have renderable contours
      const withContours = paths.filter((p) => (p as PathNode).contours.length > 0);
      expect(withContours.length).toBeGreaterThan(0);
      for (const p of withContours) {
        const pathNode = p as PathNode;
        expect(pathNode.contours[0].commands.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("produces gradient fills in Gradient Fills artboard", () => {
      const sg = sceneGraphsRef.value[0];
      const allFills: Fill[] = [];

      function collectFills(nodes: readonly SceneNode[]) {
        for (const node of nodes) {
          // TextNode's `fills` is a stacked `{ color, opacity }[]`
          // (the resolved per-paint passes, not raw `Fill` objects).
          // Only nodes whose `fills` field is `readonly Fill[]` (frame /
          // rect / ellipse / path / image) contribute to the gradient
          // collection here.
          if ("fills" in node && node.type !== "text") {
            allFills.push(...node.fills);
          }
          if ("children" in node && node.children) {
            collectFills(node.children);
          }
        }
      }
      collectFills(sg.root.children);

      const gradientFills = allFills.filter(
        (f) => f.type === "linear-gradient" || f.type === "radial-gradient",
      );
      expect(gradientFills.length).toBeGreaterThan(0);

      // Verify gradient fills have stops
      for (const gf of gradientFills) {
        switch (gf.type) {
          case "linear-gradient":
            expect(gf.stops.length).toBeGreaterThanOrEqual(2);
            expect(typeof gf.start.x).toBe("number");
            expect(typeof gf.end.x).toBe("number");
            break;
          case "radial-gradient":
            expect(gf.stops.length).toBeGreaterThanOrEqual(2);
            expect(typeof gf.center.x).toBe("number");
            expect(typeof gf.radius).toBe("number");
            break;
          default:
            break;
        }
      }
    });
  });

  describe("Page 2: Typography", () => {
    it("produces text nodes with textLineLayout text data", () => {
      const sg = sceneGraphsRef.value[1];
      const textNodes = findAllByType(sg.root.children, "text");
      expect(textNodes.length).toBeGreaterThan(0);

      // Each text node should have either glyphContours or textLineLayout
      for (const tn of textNodes) {
        const text = tn as TextNode;
        const hasGlyphs = text.glyphContours && text.glyphContours.length > 0;
        const hasLineLayout = text.textLineLayout && text.textLineLayout.lines.length > 0;
        expect(hasGlyphs || hasLineLayout).toBe(true);
      }
    });

    it("text nodes have non-empty textLineLayout text content", () => {
      const sg = sceneGraphsRef.value[1];
      const textNodes = findAllByType(sg.root.children, "text") as TextNode[];
      expect(textNodes.length).toBeGreaterThan(0);

      // Debug: check what the text nodes contain
      for (const t of textNodes) {
        const hasLineLayout = t.textLineLayout !== undefined;
        const hasGlyphs = t.glyphContours && t.glyphContours.length > 0;
        // At least one rendering path should be available
        expect(hasLineLayout || hasGlyphs).toBe(true);
      }

      // Check domain textData on original nodes
      const page = docRef.value!.pages[1];
      function collectTextNodes(nodes: readonly FigDesignNode[]): FigDesignNode[] {
        const result: FigDesignNode[] = [];
        for (const n of nodes) {
          if (n.type === "TEXT") {result.push(n);}
          if (n.children) {result.push(...collectTextNodes(n.children));}
        }
        return result;
      }
      const domainTextNodes = collectTextNodes(page.children);
      expect(domainTextNodes.length).toBeGreaterThan(0);
      // Check if textData.characters has content
      for (const dn of domainTextNodes) {
        const chars = dn.textData?.characters ?? "";
        expect(chars.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Page 3: Components & Effects", () => {
    it("produces frame nodes for component instances", () => {
      const sg = sceneGraphsRef.value[2];
      const frames = findAllByType(sg.root.children, "frame");
      expect(frames.length).toBeGreaterThan(0);
    });

    it("produces nodes with effects", () => {
      const sg = sceneGraphsRef.value[2];
      const allNodes: SceneNode[] = [];
      function collect(nodes: readonly SceneNode[]) {
        for (const n of nodes) {
          allNodes.push(n);
          if ("children" in n && n.children) {collect(n.children);}
        }
      }
      collect(sg.root.children);

      const withEffects = allNodes.filter((n) => n.effects.length > 0);
      expect(withEffects.length).toBeGreaterThan(0);

      // Check that effects have the right shape
      for (const n of withEffects) {
        for (const eff of n.effects) {
          expect(["drop-shadow", "inner-shadow", "layer-blur", "background-blur"]).toContain(eff.type);
        }
      }
    });
  });

  describe("FRAME decoration preservation", () => {
    function collectFrames(nodes: readonly SceneNode[]): FrameNode[] {
      const result: FrameNode[] = [];
      for (const n of nodes) {
        if (n.type === "frame") {result.push(n);}
        if ("children" in n && n.children) {result.push(...collectFrames(n.children));}
      }
      return result;
    }

    it("every FRAME built with .background(color) has a solid fill in the scene graph", () => {
      // Page 0 "Shapes & Fills" has FRAMEs built with .background(WHITE) —
      // each artboard FRAME calls .background(WHITE) in demo-document.ts.
      // If fills drop between builder and scene graph, this test fails.
      const sg = sceneGraphsRef.value[0];
      const frames = collectFrames(sg.root.children);
      expect(frames.length).toBeGreaterThan(0);

      const namedArtboards = frames.filter((f) => f.name === "Basic Shapes" || f.name === "Gradient Fills");
      expect(namedArtboards.length).toBeGreaterThan(0);
      for (const f of namedArtboards) {
        expect(f.fills.length, `FRAME "${f.name}" must carry its .background(WHITE) fill`).toBeGreaterThan(0);
        const solid = f.fills.find((fill) => fill.type === "solid");
        expect(solid, `FRAME "${f.name}" fill must be a solid paint`).toBeDefined();
      }
    });

    it("FRAME decoration survives through to SVG output", () => {
      // End-to-end: the SVG string must contain the FRAME's fill colour.
      // .background(WHITE) emits r=g=b=1 → "#ffffff" or "rgb(255,255,255)".
      const sg = sceneGraphsRef.value[0];
      const svg = renderSceneGraphToSvg(sg);
      const frames = collectFrames(sg.root.children);
      const whiteFrame = frames.find((f) =>
        f.name === "Basic Shapes" &&
        f.fills.some((fill) => fill.type === "solid" && fill.color.r === 1 && fill.color.g === 1 && fill.color.b === 1),
      );
      expect(whiteFrame, "Demo Basic Shapes FRAME must have WHITE solid fill").toBeDefined();
      // SVG must mention white somewhere — either as hex or named.
      const mentionsWhite = /#ffffff|#fff\b|rgb\(255, ?255, ?255\)|white/i.test(svg);
      expect(mentionsWhite, "FRAME background fill must appear in SVG output").toBe(true);
    });
  });

  describe("interactive slide elements", () => {
    it("renders geometry-backed empty interactive elements as paths", () => {
      const blob = buildRectGeometryBlob(120, 48);
      const node: FigDesignNode = {
        id: toNodeId("1:1"),
        type: "INTERACTIVE_SLIDE_ELEMENT" as FigDesignNode["type"],
        name: "Poll",
        visible: true,
        opacity: 1,
        transform: IDENTITY_TRANSFORM,
        size: { x: 120, y: 48 },
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
        strokes: [],
        strokeWeight: 0,
        effects: [],
        fillGeometry: [{ commandsBlob: 0, windingRule: "NONZERO", styleID: 0 }],
      };

      const sceneGraph = buildSingleNodeSceneGraph(node, [blob]);
      const child = sceneGraph.root.children[0];

      expect(child?.type).toBe("path");
      expect((child as PathNode).contours[0].commands.length).toBeGreaterThan(0);
    });
  });
});
