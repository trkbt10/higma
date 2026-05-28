/**
 * @file RenderTree resolver unit tests
 *
 * Tests the data flow from SceneGraph nodes to RenderTree nodes,
 * verifying that all features are correctly resolved.
 */

import { resolveRenderTree } from "./resolve";
import type {
  RenderEllipseNode,
  RenderFrameNode,
  RenderGroupNode,
  RenderMaskDef,
  RenderPathNode,
  RenderRectNode,
  RenderTextNode,
} from "./types";
import type {
  SceneGraph, GroupNode, RectNode, EllipseNode, PathNode, FrameNode, TextNode, Fill, Stroke } from "@higma-document-renderers/fig/scene-graph";
import { createNodeId } from "@higma-document-renderers/fig/scene-graph";
import type { AffineMatrix } from "@higma-primitives/path";

// =============================================================================
// Local Routines
// =============================================================================

const IDENTITY: AffineMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const RESOLVE_RENDER_TREE_SPEC_SOURCE_DOCUMENT_REFERENCE = Object.freeze({});

function makeSceneGraph(children: GroupNode["children"], viewport?: SceneGraph["viewport"]): SceneGraph {
  return {
    width: 100,
    height: 100,
    viewport,
    root: {
      type: "group",
      id: createNodeId("root"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      children,
    },
    version: 1,
    sourceDocumentReference: RESOLVE_RENDER_TREE_SPEC_SOURCE_DOCUMENT_REFERENCE,
  };
}

const RED_SOLID: Fill = { type: "solid", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 };
const BLUE_SOLID: Fill = { type: "solid", color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 0.5, blendMode: "multiply" };
const GREEN_SOLID: Fill = { type: "solid", color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 1 };

const BASIC_STROKE: Stroke = {
  width: 2,
  linecap: "butt",
  linejoin: "miter",
  color: { r: 0, g: 0, b: 0, a: 1 },
  opacity: 1,
};

function makeRect(id: string, transform: AffineMatrix = IDENTITY): RectNode {
  return {
    type: "rect",
    id: createNodeId(id),
    transform,
    opacity: 1,
    visible: true,
    effects: [],
    width: 20,
    height: 20,
    fills: [RED_SOLID],
  };
}

function makeFrameSurface(width: number, height: number, cornerRadius?: FrameNode["cornerRadius"]): FrameNode["surfaceShape"] {
  return { type: "rect", width, height, cornerRadius };
}

function makeGlyphText(id: string, fills: TextNode["fills"] = []): TextNode {
  return {
    type: "text",
    id: createNodeId(id),
    transform: IDENTITY,
    opacity: 1,
    visible: true,
    effects: [],
    width: 10,
    height: 10,
    textAutoResize: "NONE",
    glyphContours: [{
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 10, y: 0 },
        { type: "L", x: 10, y: 10 },
        { type: "L", x: 0, y: 10 },
        { type: "Z" },
      ],
      firstCharacter: 0,
      windingRule: "nonzero",
    }],
    runs: [{ start: 0, end: 1, fillColor: "#112233", fillOpacity: 0.75 }],
    fills,
  };
}

// =============================================================================
// Multi-paint fill tests
// =============================================================================

describe("resolveRenderTree — text fill SoT", () => {
  it("uses text runs as the base fill when Kiwi carries no fillPaints", () => {
    const sg = makeSceneGraph([makeGlyphText("text-without-fills")]);
    const tree = resolveRenderTree(sg);
    const node = tree.children[0] as RenderTextNode;

    expect(node.type).toBe("text");
    expect(node.fillColor).toBe("#112233");
    expect(node.fillOpacity).toBe(0.75);
    expect(node.content.mode).toBe("glyphs");
    if (node.content.mode !== "glyphs") {
      return;
    }
    expect(node.content.runs[0]).toMatchObject({
      fillColor: "#112233",
      fillOpacity: 0.75,
    });
  });

  it("throws when renderable text content has no base text run", () => {
    const node: TextNode = {
      ...makeGlyphText("line-text-without-runs"),
      glyphContours: undefined,
      runs: [],
      textLineLayout: {
        lines: [{ text: "A", x: 0, y: 10 }],
        fontFamily: "Inter",
        fontSize: 16,
        lineHeight: 20,
        textAnchor: "start",
      },
    };

    expect(() => resolveRenderTree(makeSceneGraph([node]))).toThrow(
      "resolveRenderTree: text node line-text-without-runs has renderable text content but no base text run",
    );
  });

  it("omits a TEXT clip when glyph contours fit inside the text box", () => {
    const sg = makeSceneGraph([makeGlyphText("contained-text")]);
    const tree = resolveRenderTree(sg);
    const node = tree.children[0] as RenderTextNode;

    expect(node.textClipId).toBeUndefined();
  });

  it("does not infer a TEXT clip from glyph contours exceeding the text box", () => {
    const sg = makeSceneGraph([{
      ...makeGlyphText("overflowing-text"),
      width: 5,
    }]);
    const tree = resolveRenderTree(sg);
    const node = tree.children[0] as RenderTextNode;

    expect(node.textClipId).toBeUndefined();
  });

  it("uses Kiwi truncation height as the only TEXT clip source", () => {
    const sg = makeSceneGraph([{
      ...makeGlyphText("truncated-text"),
      textTruncation: "ENDING",
      textTruncationClipHeight: 6,
    }]);
    const tree = resolveRenderTree(sg);
    const node = tree.children[0] as RenderTextNode;

    expect(node.textClipId).toBeDefined();
    expect(node.defs).toContainEqual({
      type: "clip-path",
      id: node.textClipId,
      shape: {
        kind: "rect",
        x: 0,
        y: 0,
        width: 10,
        height: 6,
      },
    });
  });
});

describe("resolveRenderTree — multi-paint fills", () => {
  it("resolves single fill without fillLayers", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-1"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 50,
      height: 30,
      fills: [RED_SOLID],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.type).toBe("rect");
    expect(node.fill.attrs.fill).toBe("#ff0000");
    expect(node.fillLayers).toBeUndefined();
  });

  it("resolves multiple fills as fillLayers", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-2"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 50,
      height: 30,
      fills: [RED_SOLID, BLUE_SOLID],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.fillLayers).toBeDefined();
    expect(node.fillLayers).toHaveLength(2);
    // First layer (bottom) = RED
    expect(node.fillLayers![0].attrs.fill).toBe("#ff0000");
    // Second layer (top) = BLUE with blend mode
    expect(node.fillLayers![1].attrs.fill).toBe("#0000ff");
    expect(node.fillLayers![1].blendMode).toBe("multiply");
    // needsWrapper should be true for multi-fill
    expect(node.needsWrapper).toBe(true);
  });

  it("resolves frame background with multiple fills", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("frame-1"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 80,
      surfaceShape: makeFrameSurface(100, 80),
      fills: [RED_SOLID, GREEN_SOLID],
      clipsContent: false,
      children: [],
    };
    const sg = makeSceneGraph([frame]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderFrameNode;
    expect(node.background).toBeDefined();
    expect(node.background!.fillLayers).toBeDefined();
    expect(node.background!.fillLayers).toHaveLength(2);
  });

  it("resolves frame background against the Kiwi surface shape", () => {
    const surfaceShape: FrameNode["surfaceShape"] = {
      type: "path",
      contours: [{
        commands: [
          { type: "M", x: 0, y: 0 },
          { type: "L", x: 40, y: 0 },
          { type: "L", x: 40, y: 20 },
          { type: "L", x: 0, y: 20 },
          { type: "Z" },
        ],
        windingRule: "evenodd",
      }],
    };
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("frame-path-surface"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 80,
      surfaceShape,
      fills: [RED_SOLID],
      clipsContent: false,
      children: [],
    };
    const sg = makeSceneGraph([frame]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderFrameNode;
    expect(node.surfaceShape.kind).toBe("path");
    expect(node.background?.fill.attrs.fill).toBe("#ff0000");
    expect(node.sourceSurfaceShape).toBe(surfaceShape);
  });
});

describe("resolveRenderTree — viewport-root frame clip", () => {
  it("marks a square viewport-root frame clip as viewport-owned when a partially-overflowing child is present", () => {
    // Pick a child whose translated bounds straddle the frame's right
    // edge ([0..100] vs child at [80..180]) — the child intersects the
    // frame's clip rect, so the clip-outside cull keeps it, and the
    // viewport-root path can express the clip as viewport-owned.
    // A child that is *entirely* outside the clip is dropped by the
    // cull (matching Figma's SVG exporter behaviour); see the next
    // case below for that branch.
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("viewport-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      surfaceShape: makeFrameSurface(100, 100),
      fills: [],
      clipsContent: true,
      children: [makeRect("overflowing-child", { ...IDENTITY, m02: 90 })],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame], { x: 0, y: 0, width: 100, height: 100 }));
    const node = tree.children[0] as RenderFrameNode;

    // Child spans x=[90..110] crossing the frame's right edge at
    // x=100 — partially inside, partially overflowing. The cull keeps
    // it (bounds intersect the clip rect), and the viewport-root
    // optimisation still marks the clip as viewport-owned.
    expect(node.childClipId).toBeDefined();
    expect(node.omitChildClip).toBe(true);
  });

  it("drops square viewport-root frame children entirely outside the clip rect", () => {
    // A child translated past the frame's far edge (clip is [0..100],
    // child occupies [120..220]) cannot intersect the clip in any
    // pixel. Figma's SVG exporter omits the subtree from the output;
    // we mirror that by culling the child before clip-id resolution,
    // so neither a clipPath nor unreachable geometry survives.
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("viewport-frame-fully-outside"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      surfaceShape: makeFrameSurface(100, 100),
      fills: [],
      clipsContent: true,
      children: [makeRect("offscreen-child", { ...IDENTITY, m02: 120 })],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame], { x: 0, y: 0, width: 100, height: 100 }));
    const node = tree.children[0] as RenderFrameNode;

    expect(node.children).toHaveLength(0);
    expect(node.childClipId).toBeUndefined();
  });

  it("omits a rounded viewport-root frame clip when children stay inside the rectangular frame bounds", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("rounded-viewport-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      cornerRadius: 12,
      surfaceShape: makeFrameSurface(100, 100, 12),
      fills: [],
      clipsContent: true,
      children: [makeRect("contained-child")],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame], { x: 0, y: 0, width: 100, height: 100 }));
    const node = tree.children[0] as RenderFrameNode;

    expect(node.childClipId).toBeUndefined();
    expect(node.omitChildClip).toBeUndefined();
  });

  it("emits a rounded viewport-root frame clip when a child overflows the rectangular frame bounds", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("rounded-viewport-overflow-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      cornerRadius: 12,
      surfaceShape: makeFrameSurface(100, 100, 12),
      fills: [],
      clipsContent: true,
      children: [makeRect("overflowing-child", { ...IDENTITY, m02: 92 })],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame], { x: 0, y: 0, width: 100, height: 100 }));
    const node = tree.children[0] as RenderFrameNode;

    expect(node.childClipId).toBeDefined();
    expect(node.omitChildClip).toBeUndefined();
  });

  it("omits a rounded frame clip when children only cross rounded-corner curves inside the rectangular bounds", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("rounded-corner-contained-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      cornerRadius: 12,
      surfaceShape: makeFrameSurface(100, 100, 12),
      fills: [],
      clipsContent: true,
      children: [makeRect("corner-child")],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame]));
    const node = tree.children[0] as RenderFrameNode;

    expect(node.childClipId).toBeUndefined();
  });

  it("omits a rounded frame clip when every child is fully inside the Kiwi clip shape", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("rounded-contained-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      cornerRadius: 12,
      surfaceShape: makeFrameSurface(100, 100, 12),
      fills: [],
      clipsContent: true,
      children: [makeRect("inset-child", { ...IDENTITY, m02: 16, m12: 16 })],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame]));
    const node = tree.children[0] as RenderFrameNode;

    expect(node.childClipId).toBeUndefined();
  });

  it("omits a decoded rounded-rect path clip when every child is fully inside that path", () => {
    const surfaceShape: FrameNode["surfaceShape"] = {
      type: "path",
      contours: [{
        commands: [
          { type: "M", x: 0, y: 5 },
          { type: "C", x1: 0, y1: 2.24, x2: 2.24, y2: 0, x: 5, y: 0 },
          { type: "L", x: 95, y: 0 },
          { type: "C", x1: 97.76, y1: 0, x2: 100, y2: 2.24, x: 100, y: 5 },
          { type: "L", x: 100, y: 95 },
          { type: "C", x1: 100, y1: 97.76, x2: 97.76, y2: 100, x: 95, y: 100 },
          { type: "L", x: 5, y: 100 },
          { type: "C", x1: 2.24, y1: 100, x2: 0, y2: 97.76, x: 0, y: 95 },
          { type: "L", x: 0, y: 5 },
        ],
        windingRule: "evenodd",
      }],
    };
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("path-rounded-contained-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      cornerRadius: 5,
      surfaceShape,
      fills: [],
      clipsContent: true,
      clip: surfaceShape,
      children: [makeRect("path-inset-child", { ...IDENTITY, m02: 16, m12: 16 })],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame]));
    const node = tree.children[0] as RenderFrameNode;

    expect(node.childClipId).toBeUndefined();
  });

  it("omits a frame clip when only a child effect extends outside the Kiwi clip shape", () => {
    const shadowedChild: RectNode = {
      ...makeRect("shadowed-child", { ...IDENTITY, m02: 70, m12: 70 }),
      effects: [{
        type: "drop-shadow",
        offset: { x: 20, y: 20 },
        radius: 20,
        color: { r: 0, g: 0, b: 0, a: 1 },
        showShadowBehindNode: true,
      }],
    };
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("effect-cropped-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      surfaceShape: makeFrameSurface(100, 100),
      fills: [],
      clipsContent: true,
      children: [shadowedChild],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame]));
    const node = tree.children[0] as RenderFrameNode;

    expect(node.childClipId).toBeUndefined();
  });

  it("omits a frame clip when a child path has INSIDE stroke geometry outside its authored contour", () => {
    const strokedIconFrame: PathNode = {
      type: "path",
      id: createNodeId("inside-stroked-icon-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 19,
      height: 24,
      contours: [{
        commands: [
          { type: "M", x: 0, y: 3 },
          { type: "C", x1: 0, y1: 1.343146, x2: 1.343146, y2: 0, x: 3, y: 0 },
          { type: "L", x: 16, y: 0 },
          { type: "C", x1: 17.656855, y1: 0, x2: 19, y2: 1.343146, x: 19, y: 3 },
          { type: "L", x: 19, y: 21 },
          { type: "C", x1: 19, y1: 22.656855, x2: 17.656855, y2: 24, x: 16, y: 24 },
          { type: "L", x: 3, y: 24 },
          { type: "C", x1: 1.343146, y1: 24, x2: 0, y2: 22.656855, x: 0, y: 21 },
          { type: "L", x: 0, y: 3 },
        ],
        windingRule: "nonzero",
      }],
      strokeContours: [{
        commands: [
          { type: "M", x: -2, y: -2 },
          { type: "L", x: 21, y: -2 },
          { type: "L", x: 21, y: 26 },
          { type: "L", x: -2, y: 26 },
          { type: "Z" },
        ],
        windingRule: "nonzero",
      }],
      fills: [],
      stroke: {
        ...BASIC_STROKE,
        align: "INSIDE",
      },
    };
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("inside-stroked-icon-container"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 19,
      height: 24,
      surfaceShape: makeFrameSurface(19, 24),
      fills: [],
      clipsContent: true,
      children: [strokedIconFrame],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame]));
    const node = tree.children[0] as RenderFrameNode;

    expect(node.childClipId).toBeUndefined();
  });

  it("resolves a decoded rounded-rect path stroke as a rect stroke shape", () => {
    const surfaceShape: FrameNode["surfaceShape"] = {
      type: "path",
      contours: [{
        commands: [
          { type: "M", x: 0, y: 5 },
          { type: "C", x1: 0, y1: 2.24, x2: 2.24, y2: 0, x: 5, y: 0 },
          { type: "L", x: 95, y: 0 },
          { type: "C", x1: 97.76, y1: 0, x2: 100, y2: 2.24, x: 100, y: 5 },
          { type: "L", x: 100, y: 95 },
          { type: "C", x1: 100, y1: 97.76, x2: 97.76, y2: 100, x: 95, y: 100 },
          { type: "L", x: 5, y: 100 },
          { type: "C", x1: 2.24, y1: 100, x2: 0, y2: 97.76, x: 0, y: 95 },
          { type: "L", x: 0, y: 5 },
        ],
        windingRule: "evenodd",
      }],
    };
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("path-rounded-stroked-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      cornerRadius: 5,
      surfaceShape,
      fills: [],
      stroke: {
        ...BASIC_STROKE,
        width: 1,
        align: "INSIDE",
        dashPattern: [10, 5],
      },
      clipsContent: false,
      children: [],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame]));
    const node = tree.children[0] as RenderFrameNode;
    const strokeRendering = node.background?.strokeRendering;

    expect(strokeRendering?.mode).toBe("masked");
    if (strokeRendering?.mode !== "masked") {
      return;
    }
    expect(strokeRendering.shape.kind).toBe("rect");
    expect(strokeRendering.attrs.strokeDasharray).toBe("10 5");
  });

  it("emits path clips carried by the FrameNode surface SoT", () => {
    const surfaceShape: FrameNode["surfaceShape"] = {
      type: "path",
      contours: [{
        commands: [
          { type: "M", x: 0, y: 0 },
          { type: "L", x: 80, y: 0 },
          { type: "L", x: 80, y: 80 },
          { type: "L", x: 0, y: 80 },
          { type: "Z" },
        ],
        windingRule: "nonzero",
      }],
    };
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("path-clipped-frame"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 100,
      surfaceShape,
      fills: [],
      clipsContent: true,
      clip: surfaceShape,
      children: [makeRect("contained-child")],
    };
    const tree = resolveRenderTree(makeSceneGraph([frame]));
    const node = tree.children[0] as RenderFrameNode;
    const clipDef = node.defs.find((def) => def.type === "clip-path");

    expect(node.childClipId).toBeDefined();
    expect(clipDef?.shape.kind).toBe("path");
  });

  it("emits path clips carried by GROUP geometry", () => {
    const group: GroupNode = {
      type: "group",
      id: createNodeId("geometry-clipped-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      clip: {
        type: "path",
        contours: [{
          commands: [
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 80, y: 0 },
            { type: "L", x: 80, y: 80 },
            { type: "L", x: 0, y: 80 },
            { type: "Z" },
          ],
          windingRule: "nonzero",
        }],
      },
      children: [makeRect("contained-child")],
    };
    const tree = resolveRenderTree(makeSceneGraph([group]));
    const node = tree.children[0] as RenderGroupNode;
    const clipDef = node.defs.find((def) => def.type === "clip-path");

    expect(node.childClipId).toBeDefined();
    expect(node.canUnwrapSingleChild).toBe(false);
    expect(clipDef?.shape.kind).toBe("path");
  });

  it("keeps the RenderMask id available for non-SVG backends", () => {
    const maskContent: RectNode = {
      type: "rect",
      id: createNodeId("mask-source"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 10,
      height: 10,
      fills: [RED_SOLID],
    };
    const maskedGroup: GroupNode = {
      type: "group",
      id: createNodeId("masked-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      mask: { maskId: maskContent.id, maskType: "ALPHA", maskContent },
      children: [{
        type: "rect",
        id: createNodeId("masked-child"),
        transform: IDENTITY,
        opacity: 1,
        visible: true,
        effects: [],
        width: 20,
        height: 20,
        fills: [RED_SOLID],
      }],
    };
    const tree = resolveRenderTree(makeSceneGraph([maskedGroup]));
    const node = tree.children[0] as RenderGroupNode;
    const maskDef = node.defs.find((def) => def.type === "mask");
    if (maskDef === undefined) {
      throw new Error("expected mask def");
    }

    expect(node.mask).toEqual({ maskId: maskDef.id, maskAttr: `url(#${maskDef.id})` });
    expect(maskDef.bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(maskDef.contentRendering).toBe("source-paint");
  });

  it("treats paintless ALPHA mask geometry as coverage in the RenderTree", () => {
    const maskContent: RectNode = {
      type: "rect",
      id: createNodeId("paintless-mask-source"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 10,
      height: 10,
      fills: [],
    };
    const maskedGroup: GroupNode = {
      type: "group",
      id: createNodeId("paintless-masked-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      mask: { maskId: maskContent.id, maskType: "ALPHA", maskContent },
      children: [makeRect("paintless-masked-child")],
    };
    const tree = resolveRenderTree(makeSceneGraph([maskedGroup]));
    const node = tree.children[0] as RenderGroupNode;
    const maskDef = node.defs.find((def): def is RenderMaskDef => def.type === "mask");
    if (maskDef === undefined) {
      throw new Error("expected mask def");
    }

    expect(maskDef.maskType).toBe("ALPHA");
    expect(maskDef.contentRendering).toBe("geometry-coverage");
  });

  it("uses authored source geometry, not stroke outsets, for source-paint ALPHA mask regions", () => {
    const maskContent: PathNode = {
      type: "path",
      id: createNodeId("alpha-stroked-mask-source"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      contours: [{
        commands: [
          { type: "M", x: 0, y: 0 },
          { type: "L", x: 432, y: 0 },
          { type: "L", x: 432, y: 904 },
          { type: "L", x: 0, y: 904 },
          { type: "Z" },
        ],
        windingRule: "nonzero",
      }],
      strokeContours: [{
        commands: [
          { type: "M", x: -6, y: -6 },
          { type: "L", x: 438, y: -6 },
          { type: "L", x: 438, y: 910 },
          { type: "L", x: -6, y: 910 },
          { type: "Z" },
        ],
        windingRule: "nonzero",
      }],
      fills: [],
      stroke: { ...BASIC_STROKE, width: 6 },
    };
    const maskedGroup: GroupNode = {
      type: "group",
      id: createNodeId("alpha-stroked-masked-group"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      mask: { maskId: maskContent.id, maskType: "ALPHA", maskContent },
      children: [makeRect("alpha-stroked-masked-child")],
    };
    const tree = resolveRenderTree(makeSceneGraph([maskedGroup]));
    const node = tree.children[0] as RenderGroupNode;
    const maskDef = node.defs.find((def): def is RenderMaskDef => def.type === "mask");
    if (maskDef === undefined) {
      throw new Error("expected mask def");
    }

    expect(maskDef.contentRendering).toBe("source-paint");
    expect(maskDef.bounds).toEqual({ x: 0, y: 0, width: 432, height: 904 });
  });
});

// =============================================================================
// Ellipse arcData tests
// =============================================================================

describe("resolveRenderTree — ellipse arcData", () => {
  it("resolves full ellipse as ellipse node", () => {
    const ell: EllipseNode = {
      type: "ellipse",
      id: createNodeId("ell-1"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      cx: 25,
      cy: 25,
      rx: 25,
      ry: 25,
      fills: [RED_SOLID],
    };
    const sg = makeSceneGraph([ell]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderEllipseNode;
    expect(node.type).toBe("ellipse");
  });

  it("resolves ellipse with arcData as path node", () => {
    const ell: EllipseNode = {
      type: "ellipse",
      id: createNodeId("ell-arc"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      cx: 25,
      cy: 25,
      rx: 25,
      ry: 25,
      fills: [RED_SOLID],
      arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 },
    };
    const sg = makeSceneGraph([ell]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0];
    // Arc data converts to path
    expect(node.type).toBe("path");
    const pathNode = node as RenderPathNode;
    expect(pathNode.paths).toHaveLength(1);
    expect(pathNode.paths[0].d).toContain("A"); // Arc command
  });

  it("resolves donut (innerRadius > 0) as path node with evenodd", () => {
    const ell: EllipseNode = {
      type: "ellipse",
      id: createNodeId("ell-donut"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      cx: 50,
      cy: 50,
      rx: 50,
      ry: 50,
      fills: [RED_SOLID],
      arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.5 },
    };
    const sg = makeSceneGraph([ell]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderPathNode;
    expect(node.type).toBe("path");
    expect(node.paths[0].fillRule).toBe("evenodd");
    // Donut path should contain both outer and inner arcs
    expect(node.paths[0].d).toContain("Z");
  });
});

// =============================================================================
// Per-corner radius tests
// =============================================================================

describe("resolveRenderTree — per-corner radius", () => {
  it("resolves uniform corner radius as number", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-cr1"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 50,
      height: 30,
      cornerRadius: 10,
      fills: [RED_SOLID],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.cornerRadius).toBe(10);
  });

  it("resolves per-corner radius as tuple", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-cr-tuple"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 50,
      height: 30,
      cornerRadius: [10, 20, 5, 15] as const,
      fills: [RED_SOLID],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(Array.isArray(node.cornerRadius)).toBe(true);
  });

  it("clamps corner radius to min(width, height) / 2", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-cr-clamp"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 20,
      height: 10,
      cornerRadius: 100, // way larger than half the smallest dim
      fills: [RED_SOLID],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.cornerRadius).toBe(5); // min(20, 10) / 2
  });
});

// =============================================================================
// Angular/diamond gradient def collection tests
// =============================================================================

describe("resolveRenderTree — angular/diamond gradients", () => {
  it("collects angular gradient defs", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-ag"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 50,
      height: 30,
      fills: [{
        type: "angular-gradient",
        center: { x: 0.5, y: 0.5 },
        rotation: 0,
        stops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
      }],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.fill.attrs.fill).toContain("url(#");
    const angularDefs = node.defs.filter((d) => d.type === "angular-gradient");
    expect(angularDefs).toHaveLength(1);
  });

  it("collects diamond gradient defs", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-dg"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 50,
      height: 30,
      fills: [{
        type: "diamond-gradient",
        center: { x: 0.5, y: 0.5 },
        stops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
      }],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.fill.attrs.fill).toContain("url(#");
    const diamondDefs = node.defs.filter((d) => d.type === "diamond-gradient");
    expect(diamondDefs).toHaveLength(1);
  });
});

// =============================================================================
// Per-path fillOverride tests
// =============================================================================

describe("resolveRenderTree — per-path fillOverride", () => {
  it("resolves contour fillOverride to per-path fill", () => {
    const pathNode: PathNode = {
      type: "path",
      id: createNodeId("path-override"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      contours: [
        {
          commands: [
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 10, y: 0 },
            { type: "L", x: 10, y: 10 },
            { type: "Z" },
          ],
          windingRule: "nonzero",
        },
        {
          commands: [
            { type: "M", x: 20, y: 0 },
            { type: "L", x: 30, y: 0 },
            { type: "L", x: 30, y: 10 },
            { type: "Z" },
          ],
          windingRule: "nonzero",
          fillOverride: GREEN_SOLID,
        },
      ],
      fills: [RED_SOLID],
    };
    const sg = makeSceneGraph([pathNode]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderPathNode;
    expect(node.paths).toHaveLength(2);
    // First contour: no override
    expect(node.paths[0].fillOverride).toBeUndefined();
    // Second contour: green override
    expect(node.paths[1].fillOverride).toBeDefined();
    expect(node.paths[1].fillOverride!.attrs.fill).toBe("#00ff00");
  });
});

// =============================================================================
// Stroke layers tests
// =============================================================================

describe("resolveRenderTree — stroke layers", () => {
  it("resolves single stroke without layers", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-stroke1"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 50,
      height: 30,
      fills: [RED_SOLID],
      stroke: BASIC_STROKE,
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.strokeRendering).toBeDefined();
    expect(node.strokeRendering!.mode).toBe("uniform");
  });

  it("resolves simple OUTSIDE path strokes as Figma's aligned centerline path", () => {
    const pathNode: PathNode = {
      type: "path",
      id: createNodeId("outside-path-stroke"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      contours: [{
        commands: [
          { type: "M", x: 0, y: 0 },
          { type: "L", x: 10, y: 0 },
          { type: "L", x: 10, y: 10 },
          { type: "L", x: 0, y: 10 },
          { type: "L", x: 0, y: 0 },
        ],
        windingRule: "nonzero",
      }],
      fills: [RED_SOLID],
      stroke: {
        ...BASIC_STROKE,
        align: "OUTSIDE",
      },
    };
    const sg = makeSceneGraph([pathNode]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderPathNode;
    expect(node.paths[0].d).toBe("M0 0H10V10H0V0Z");
    expect(node.defs.some((def) => def.type === "stroke-mask")).toBe(false);
    expect(node.strokeRendering).toBeDefined();
    expect(node.strokeRendering!.mode).toBe("layers");
    if (node.strokeRendering!.mode !== "layers") {
      throw new Error("Expected stroke rendering layers");
    }
    expect(node.strokeRendering!.layers[0].attrs.strokeWidth).toBe(2);
    expect(node.strokeRendering!.layers[0].attrs.strokeAlign).toBeUndefined();
    expect(node.strokeRendering!.shape.kind).toBe("path");
    if (node.strokeRendering!.shape.kind !== "path") {
      throw new Error("Expected stroke rendering path shape");
    }
    expect(node.strokeRendering!.shape.paths[0].d).toBe("M-1 -1H11V11H-1Z");
  });

  it("resolves precomputed path stroke geometry as filled stroke outline", () => {
    const pathNode: PathNode = {
      type: "path",
      id: createNodeId("path-stroke-geometry"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      contours: [{
        commands: [
          { type: "M", x: 0, y: 0 },
          { type: "L", x: 10, y: 0 },
          { type: "L", x: 10, y: 10 },
          { type: "L", x: 0, y: 10 },
          { type: "L", x: 0, y: 0 },
        ],
        windingRule: "evenodd",
      }],
      strokeContours: [{
        commands: [
          { type: "M", x: -1, y: -1 },
          { type: "L", x: 11, y: -1 },
          { type: "L", x: 11, y: 11 },
          { type: "L", x: -1, y: 11 },
          { type: "L", x: -1, y: -1 },
        ],
        windingRule: "nonzero",
      }],
      fills: [RED_SOLID],
      stroke: {
        ...BASIC_STROKE,
        align: "INSIDE",
      },
    };
    const sg = makeSceneGraph([pathNode]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderPathNode;
    expect(node.paths[0].d).toBe("M0 0H10V10H0V0Z");
    expect(node.paths[0].fillRule).toBe("evenodd");
    const strokeRendering = node.strokeRendering;
    expect(strokeRendering).toBeDefined();
    if (strokeRendering === undefined || strokeRendering.mode !== "geometry") {
      throw new Error("expected geometry stroke rendering");
    }
    expect(strokeRendering.paths[0].d).toBe("M-1 -1H11V11H-1V-1Z");
    expect(strokeRendering.layers[0].attrs.stroke).toBe("#000000");
    expect(strokeRendering.mask?.strokeAlign).toBe("INSIDE");
    expect(strokeRendering.mask?.shape.kind).toBe("path");
    if (strokeRendering.mask?.shape.kind === "path") {
      expect(strokeRendering.mask.shape.fillRule).toBe("evenodd");
    }
    expect(node.defs.some((def) => def.type === "stroke-mask" && def.id === strokeRendering.mask?.id)).toBe(true);
  });

  it("uses Kiwi rect metadata as the stroke shape when a VECTOR carries rounded-rectangle metadata", () => {
    const pathNode: PathNode = {
      type: "path",
      id: createNodeId("path-stroke-geometry-rect-metadata"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 100,
      height: 200,
      cornerRadius: 20,
      cornerSmoothing: 0.6,
      contours: [{
        commands: [
          { type: "M", x: 0, y: 20 },
          { type: "L", x: 0, y: 180 },
          { type: "L", x: 100, y: 180 },
          { type: "L", x: 100, y: 20 },
          { type: "L", x: 0, y: 20 },
        ],
        windingRule: "nonzero",
      }],
      strokeContours: [{
        commands: [
          { type: "M", x: 1, y: 20 },
          { type: "L", x: 1, y: 180 },
          { type: "L", x: 99, y: 180 },
          { type: "L", x: 99, y: 20 },
          { type: "L", x: 1, y: 20 },
        ],
        windingRule: "nonzero",
      }],
      fills: [RED_SOLID],
      stroke: {
        ...BASIC_STROKE,
        align: "INSIDE",
      },
    };
    const sg = makeSceneGraph([pathNode]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderPathNode;
    const strokeRendering = node.strokeRendering;
    expect(strokeRendering).toBeDefined();
    if (strokeRendering === undefined || strokeRendering.mode !== "masked") {
      throw new Error("expected masked rect stroke rendering");
    }
    expect(strokeRendering.attrs.stroke).toBe("#000000");
    expect(strokeRendering.attrs.strokeWidth).toBe(4);
    expect(strokeRendering.attrs.strokeAlign).toBe("INSIDE");
    expect(strokeRendering.shape).toMatchObject({
      kind: "rect",
      width: 100,
      height: 200,
      cornerRadius: 20,
      cornerSmoothing: 0.6,
    });
  });

  it("falls through to a path stroke shape when a non-rect contour carries vertex cornerRadius", () => {
    // Regression: REGULAR_POLYGON (count=4) on disk decodes to a diamond
    // (four bounding-box midpoints joined by rounded corners) and the
    // FigNode also carries a `cornerRadius` value describing the
    // *vertex* rounding. The PathNode therefore arrives at the resolver
    // with `cornerRadius + width + height` set even though the contour
    // is not an axis-aligned rounded rect. Previously the resolver
    // unconditionally forwarded a `kind:"rect"` strokeShape, which made
    // the SVG renderer emit `<rect rx=…>` for the stroke — silently
    // flattening the diamond into an upright square. Verify that a
    // path-shaped contour stays path-shaped on the stroke side so the
    // visible stroke continues to follow the actual diamond outline.
    const diamondContour = {
      commands: [
        { type: "M" as const, x: 37.2574, y: 4.2426 },
        { type: "C" as const, x1: 39.6005, y1: 1.8995, x2: 43.3995, y2: 1.8995, x: 45.7426, y: 4.2426 },
        { type: "L" as const, x: 78.7574, y: 37.2574 },
        { type: "C" as const, x1: 81.1005, y1: 39.6005, x2: 81.1005, y2: 43.3995, x: 78.7574, y: 45.7426 },
        { type: "L" as const, x: 45.7426, y: 78.7574 },
        { type: "C" as const, x1: 43.3995, y1: 81.1005, x2: 39.6005, y2: 81.1005, x: 37.2574, y: 78.7574 },
        { type: "L" as const, x: 4.2426, y: 45.7426 },
        { type: "C" as const, x1: 1.8995, y1: 43.3995, x2: 1.8995, y2: 39.6005, x: 4.2426, y: 37.2574 },
        { type: "L" as const, x: 37.2574, y: 4.2426 },
      ],
      windingRule: "nonzero" as const,
    };
    const polygonPath: PathNode = {
      type: "path",
      id: createNodeId("diamond-polygon-stroke"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 83,
      height: 83,
      cornerRadius: 6,
      contours: [diamondContour],
      fills: [],
      stroke: {
        ...BASIC_STROKE,
        align: "INSIDE",
      },
    };
    const sg = makeSceneGraph([polygonPath]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderPathNode;
    const strokeRendering = node.strokeRendering;
    if (strokeRendering === undefined) {
      throw new Error("expected diamond polygon to produce stroke rendering");
    }
    // Only the `masked` and `layers` modes carry a `shape` slot —
    // `uniform` and `geometry` do not. The diamond polygon's INSIDE
    // stroke must land in one of the shape-carrying modes, and the
    // shape it carries must NOT be `kind:"rect"` (the rect-stroke
    // emitter would otherwise draw an axis-aligned `<rect rx=5>` over
    // the diamond's actual outline). `"shape" in …` narrows the union
    // without an unsafe cast.
    if (!("shape" in strokeRendering)) {
      throw new Error(
        `diamond polygon strokeRendering unexpectedly landed in mode="${strokeRendering.mode}" (no shape carried)`,
      );
    }
    expect(strokeRendering.shape.kind).toBe("path");
  });

  it("resolves multi-paint stroke as layers", () => {
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-stroke-multi"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      width: 50,
      height: 30,
      fills: [RED_SOLID],
      stroke: {
        ...BASIC_STROKE,
        layers: [
          { color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 },
          { color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.5, blendMode: "multiply" },
        ],
      },
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.strokeRendering).toBeDefined();
    expect(node.strokeRendering!.mode).toBe("layers");
    if (node.strokeRendering!.mode === "layers") {
      expect(node.strokeRendering!.layers).toHaveLength(2);
      expect(node.strokeRendering!.layers[0].attrs.stroke).toBe("#000000");
      expect(node.strokeRendering!.layers[1].attrs.stroke).toBe("#ff0000");
      expect(node.strokeRendering!.layers[1].blendMode).toBe("multiply");
    }
  });
});

// =============================================================================
// Effect blend mode tests
// =============================================================================

describe("resolveRenderTree — drop shadow z-order", () => {
  it("materializes background blur as Figma blur stdDeviation", () => {
    const rect: RectNode = {
      ...makeRect("bg-blur-stddev"),
      effects: [{ type: "background-blur", radius: 40 }],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    expect(node.backgroundBlur).toBeDefined();
    if (node.backgroundBlur === undefined) {
      throw new Error("Expected background blur to be resolved");
    }
    expect(node.backgroundBlur.stdDeviation).toBe(20);
    expect(node.backgroundBlur.backdropBounds).toEqual({
      x: -40,
      y: -40,
      width: 100,
      height: 100,
    });
    const clipDef = node.defs.find((def) => def.type === "clip-path" && def.id === node.backgroundBlur?.clipId);
    if (clipDef === undefined) {
      throw new Error("Expected background blur clip def");
    }
    if (clipDef.type !== "clip-path") {
      throw new Error("Expected background blur clip def to be a clip-path");
    }
    expect(clipDef.transform).toBe("matrix(1,0,0,1,40,40)");
  });

  it("puts frame surface shadows on the frame node instead of the child wrapper", () => {
    const frame: FrameNode = {
      type: "frame",
      id: createNodeId("frame-shadow"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [{
        type: "drop-shadow",
        offset: { x: 0, y: 4 },
        radius: 8,
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        showShadowBehindNode: true,
      }],
      width: 50,
      height: 30,
      surfaceShape: makeFrameSurface(50, 30),
      fills: [RED_SOLID],
      clipsContent: false,
      children: [makeRect("frame-child")],
    };
    const sg = makeSceneGraph([frame]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderFrameNode;
    expect(node.wrapper.filterAttr).toBeUndefined();
    expect(node.surfaceFilterAttr).toMatch(/^url\(#filter-/);
    const filterDefs = node.defs.filter((d) => d.type === "filter");
    expect(filterDefs).toHaveLength(1);
  });

  it("shadow is placed BEHIND SourceGraphic (not composited on top)", () => {
    // Regression for a VECTOR shadow z-order bug: a prior
    // implementation composited the shadow on top of SourceGraphic.
    // Figma's exporter builds a backdrop chain and then blends
    // SourceGraphic over the final drop-shadow result.
    const rect: RectNode = {
      type: "rect",
      id: createNodeId("rect-shadow-blend"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [{
        type: "drop-shadow",
        offset: { x: 0, y: 4 },
        radius: 8,
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        blendMode: "multiply",
        showShadowBehindNode: false,
      }],
      width: 50,
      height: 30,
      fills: [RED_SOLID],
    };
    const sg = makeSceneGraph([rect]);
    const tree = resolveRenderTree(sg);

    const node = tree.children[0] as RenderRectNode;
    const filterDefs = node.defs.filter((d) => d.type === "filter");
    expect(filterDefs).toHaveLength(1);
    const filterDef = filterDefs[0];
    if (filterDef.type !== "filter") {
      throw new Error("Expected a filter def");
    }
    const prims = filterDef.filter.primitives;
    const last = prims[prims.length - 1];
    expect(last.type).toBe("feBlend");
    if (last.type !== "feBlend") {
      throw new Error("Expected the final filter primitive to be feBlend");
    }
    expect(last.mode).toBe("normal");
    expect(last.in).toBe("SourceGraphic");
    expect(last.in2).toMatch(/^drop-shadow-/);
  });

  it("omits SourceGraphic for shadow-only geometry with no paint source", () => {
    const pathNode: PathNode = {
      type: "path",
      id: createNodeId("effect-only-path"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [{
        type: "drop-shadow",
        offset: { x: 0, y: 0 },
        radius: 4,
        color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
        showShadowBehindNode: true,
      }],
      contours: [{
        commands: [
          { type: "M", x: 0, y: 0 },
          { type: "L", x: 20, y: 0 },
          { type: "L", x: 20, y: 20 },
          { type: "L", x: 0, y: 20 },
          { type: "Z" },
        ],
        windingRule: "nonzero",
      }],
      fills: [],
    };
    const sg = makeSceneGraph([pathNode]);
    const tree = resolveRenderTree(sg);
    const node = tree.children[0] as RenderPathNode;
    const filterDef = node.defs.find((d) => d.type === "filter");
    if (filterDef?.type !== "filter") {
      throw new Error("Expected a filter def");
    }
    const last = filterDef.filter.primitives[filterDef.filter.primitives.length - 1];
    expect(node.filterSource).toBe("effect-shape");
    expect(filterDef.filter.primitives.every((primitive) => {
      if ("in" in primitive && primitive.in === "SourceGraphic") {
        return false;
      }
      if ("in2" in primitive && primitive.in2 === "SourceGraphic") {
        return false;
      }
      return true;
    })).toBe(true);
    expect(last.type).toBe("feBlend");
  });
});
