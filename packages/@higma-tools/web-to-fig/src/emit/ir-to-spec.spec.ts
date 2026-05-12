/**
 * @file Per-feature spec for `irToSpecGraph`.
 *
 * `irToSpecGraph` is the boundary where IR vocabulary
 * (`PaintIR`, `EffectIR`, `AutoLayoutIR`, …) becomes the document-io
 * `NodeSpec` shape that ultimately drives `addNode`. A drift here
 * silently corrupts the resulting `FigDesignNode` (wrong fills,
 * dropped effects, misnamed font style) — so each adapter category
 * gets a focused contract test before any composite case relies on it.
 */
import type {
  FrameNodeIR,
  TextNodeIR,
  RectNodeIR,
  VectorNodeIR,
  EffectIR,
  StrokeIR,
} from "@higma-bridges/web-fig";
import { pxLength } from "@higma-bridges/web-fig";
import { irToSpecGraph } from "./ir-to-spec";

const ZERO_BOX = { x: 0, y: 0, width: 100, height: 50 };

const NEUTRAL_STYLE = {
  fills: [],
  strokes: [],
  effects: [],
  opacity: 1,
  cornerRadius: undefined,
  clipsContent: false,
  blendMode: "normal",
} as const;

function frameIR(overrides: Partial<FrameNodeIR> = {}): FrameNodeIR {
  return {
    kind: "frame",
    id: "n1",
    componentKey: "k1",
    name: "Frame",
    box: ZERO_BOX,
    style: NEUTRAL_STYLE,
    visible: true,
    sizing: { mode: "absolute" },
    autoLayout: { direction: "none" },
    children: [],
    ...overrides,
  };
}

function textIR(overrides: Partial<TextNodeIR> = {}): TextNodeIR {
  return {
    kind: "text",
    id: "t1",
    componentKey: "tk1",
    name: "Text",
    box: ZERO_BOX,
    style: NEUTRAL_STYLE,
    visible: true,
    sizing: { mode: "absolute" },
    characters: "Hello",
    textStyle: {
      fontFamily: "Inter",
      fontStyle: "normal",
      fontWeight: 400,
      fontSize: 16,
      lineHeight: { unit: "normal" },
      letterSpacing: 0,
      textAlign: "left",
      textAlignVertical: "top",
      textTransform: "none",
      textDecoration: "none",
    },
    ...overrides,
  };
}

function rectIR(overrides: Partial<RectNodeIR> = {}): RectNodeIR {
  return {
    kind: "rectangle",
    id: "r1",
    componentKey: "rk1",
    name: "Rect",
    box: ZERO_BOX,
    style: NEUTRAL_STYLE,
    visible: true,
    sizing: { mode: "absolute" },
    ...overrides,
  };
}

function vectorIR(overrides: Partial<VectorNodeIR> = {}): VectorNodeIR {
  return {
    kind: "vector",
    id: "v1",
    componentKey: "vk1",
    name: "Vec",
    box: ZERO_BOX,
    style: NEUTRAL_STYLE,
    visible: true,
    sizing: { mode: "absolute" },
    paths: [{ d: "M0 0 L10 10" }],
    ...overrides,
  };
}

describe("irToSpecGraph — frame", () => {
  it("emits a FRAME spec with geometry, opacity, visibility and clipsContent", () => {
    const graph = irToSpecGraph(frameIR({
      box: { x: 1, y: 2, width: 3, height: 4 },
      style: { ...NEUTRAL_STYLE, opacity: 0.4, clipsContent: true },
      visible: false,
    }));
    expect(graph.spec.type).toBe("FRAME");
    if (graph.spec.type !== "FRAME") {
      throw new Error();
    }
    expect(graph.spec.x).toBe(1);
    expect(graph.spec.y).toBe(2);
    expect(graph.spec.width).toBe(3);
    expect(graph.spec.height).toBe(4);
    expect(graph.spec.opacity).toBe(0.4);
    expect(graph.spec.clipsContent).toBe(true);
    expect(graph.spec.visible).toBe(false);
  });

  it("translates a SOLID fill into a FigSolidPaint", () => {
    const graph = irToSpecGraph(frameIR({
      style: {
        ...NEUTRAL_STYLE,
        fills: [{ kind: "solid", color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } }],
      },
    }));
    if (graph.spec.type !== "FRAME") {
      throw new Error();
    }
    expect(graph.spec.fills).toHaveLength(1);
    const fill = graph.spec.fills![0]!;
    expect(fill.type).toBe("SOLID");
    if (fill.type !== "SOLID") {
      throw new Error();
    }
    expect(fill.color).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
  });

  it("translates an IMAGE fill into a FigImagePaint with the corresponding scaleMode", () => {
    const graph = irToSpecGraph(frameIR({
      style: {
        ...NEUTRAL_STYLE,
        fills: [{ kind: "image", imageId: "img-9", scaleMode: "cover" }],
      },
    }));
    if (graph.spec.type !== "FRAME") {
      throw new Error();
    }
    const fill = graph.spec.fills![0]!;
    expect(fill.type).toBe("IMAGE");
    if (fill.type !== "IMAGE") {
      throw new Error();
    }
    expect(fill.imageRef).toBe("img-9");
    expect(fill.scaleMode).toBe("FILL");
  });

  it("encodes a linear-gradient fill via gradientHandlePositions + gradientStops", () => {
    const graph = irToSpecGraph(frameIR({
      style: {
        ...NEUTRAL_STYLE,
        fills: [{
          kind: "linear-gradient",
          angle: 90,
          stops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
        }],
      },
    }));
    if (graph.spec.type !== "FRAME") {
      throw new Error();
    }
    const fill = graph.spec.fills![0]!;
    expect(fill.type).toBe("GRADIENT_LINEAR");
    if (fill.type !== "GRADIENT_LINEAR") {
      throw new Error();
    }
    expect(fill.gradientHandlePositions).toHaveLength(3);
    expect(fill.gradientStops).toHaveLength(2);
  });

  it("translates strokes into FigPaint plus the widest weight", () => {
    const stroke: StrokeIR = {
      paint: { kind: "solid", color: { r: 1, g: 0, b: 0, a: 1 } },
      weight: 4,
      align: "center",
    };
    const graph = irToSpecGraph(frameIR({
      style: { ...NEUTRAL_STYLE, strokes: [stroke] },
    }));
    if (graph.spec.type !== "FRAME") {
      throw new Error();
    }
    expect(graph.spec.strokes).toHaveLength(1);
    expect(graph.spec.strokeWeight).toBe(4);
  });

  it("translates effects via the bridge adapter", () => {
    const effect: EffectIR = {
      kind: "drop-shadow",
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      offsetX: 1,
      offsetY: 2,
      blurRadius: 4,
      spread: 0,
    };
    const graph = irToSpecGraph(frameIR({
      style: { ...NEUTRAL_STYLE, effects: [effect] },
    }));
    if (graph.spec.type !== "FRAME") {
      throw new Error();
    }
    expect(graph.spec.effects).toHaveLength(1);
    const out = graph.spec.effects![0]!;
    expect(out.type).toBe("DROP_SHADOW");
    expect(out.offset).toEqual({ x: 1, y: 2 });
    expect(out.radius).toBe(4);
  });

  it("encodes row autoLayout via stackMode HORIZONTAL", () => {
    const graph = irToSpecGraph(frameIR({
      autoLayout: {
        direction: "row",
        gap: 8,
        paddingTop: 1,
        paddingRight: 2,
        paddingBottom: 3,
        paddingLeft: 4,
        primaryAlign: "center",
        counterAlign: "stretch",
        wrap: false,
      },
    }));
    if (graph.spec.type !== "FRAME") {
      throw new Error();
    }
    const layout = graph.spec.autoLayout;
    if (!layout) {
      throw new Error("expected autoLayout");
    }
    expect(layout.stackMode.name).toBe("HORIZONTAL");
    expect(layout.stackSpacing).toBe(8);
    expect(layout.stackPadding).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(layout.stackPrimaryAlignItems?.name).toBe("CENTER");
    // The `StackAlign` Kiwi enum has no STRETCH variant — that category
    // is carried per-child as `stackChildAlignSelf=STRETCH`. The parent's
    // counterAlign falls back to MIN so the encoded `.fig` stays valid.
    expect(layout.stackCounterAlignItems?.name).toBe("MIN");
  });

  it("recurses into children, returning a SpecGraph per child", () => {
    const parent = frameIR({
      children: [textIR({ id: "child" })],
    });
    const graph = irToSpecGraph(parent);
    expect(graph.children).toHaveLength(1);
    expect(graph.children[0]!.spec.type).toBe("TEXT");
  });
});

describe("irToSpecGraph — text", () => {
  it("emits TEXT spec with characters, fontSize, family, computed style label", () => {
    const graph = irToSpecGraph(textIR({
      characters: "Hi",
      textStyle: {
        fontFamily: "Inter",
        fontStyle: "normal",
        fontWeight: 700,
        fontSize: 24,
        lineHeight: { unit: "px", value: 32 },
        letterSpacing: 0,
        textAlign: "left",
        textAlignVertical: "top",
        textTransform: "none",
        textDecoration: "none",
      },
    }));
    expect(graph.spec.type).toBe("TEXT");
    if (graph.spec.type !== "TEXT") {
      throw new Error();
    }
    expect(graph.spec.characters).toBe("Hi");
    expect(graph.spec.fontSize).toBe(24);
    expect(graph.spec.fontFamily).toBe("Inter");
    expect(graph.spec.fontStyle).toBe("Bold");
    expect(graph.spec.lineHeight).toBe(32);
  });

  it("encodes italic + weight 400 into the canonical Italic label", () => {
    const graph = irToSpecGraph(textIR({
      textStyle: {
        fontFamily: "Inter",
        fontStyle: "italic",
        fontWeight: 400,
        fontSize: 16,
        lineHeight: { unit: "normal" },
        letterSpacing: 0,
        textAlign: "left",
        textAlignVertical: "top",
        textTransform: "none",
        textDecoration: "none",
      },
    }));
    if (graph.spec.type !== "TEXT") {
      throw new Error();
    }
    expect(graph.spec.fontStyle).toBe("Italic");
  });

  it("leaves lineHeight undefined for ratio + normal units (resolution happens elsewhere)", () => {
    const graph = irToSpecGraph(textIR({
      textStyle: {
        fontFamily: "Inter",
        fontStyle: "normal",
        fontWeight: 400,
        fontSize: 16,
        lineHeight: { unit: "ratio", value: 1.5 },
        letterSpacing: 0,
        textAlign: "left",
        textAlignVertical: "top",
        textTransform: "none",
        textDecoration: "none",
      },
    }));
    if (graph.spec.type !== "TEXT") {
      throw new Error();
    }
    expect(graph.spec.lineHeight).toBeUndefined();
  });

  it("emits no horizontal/vertical alignment for the IR default (`left` / `top`) so the spec stays terse", () => {
    const graph = irToSpecGraph(textIR());
    if (graph.spec.type !== "TEXT") {
      throw new Error();
    }
    expect(graph.spec.textAlignHorizontal).toBeUndefined();
    expect(graph.spec.textAlignVertical).toBeUndefined();
  });

  it("encodes IR `textAlign: center` as Figma `textAlignHorizontal: CENTER`", () => {
    const graph = irToSpecGraph(textIR({
      textStyle: {
        fontFamily: "Inter",
        fontStyle: "normal",
        fontWeight: 400,
        fontSize: 16,
        lineHeight: { unit: "normal" },
        letterSpacing: 0,
        textAlign: "center",
        textAlignVertical: "top",
        textTransform: "none",
        textDecoration: "none",
      },
    }));
    if (graph.spec.type !== "TEXT") {
      throw new Error();
    }
    expect(graph.spec.textAlignHorizontal?.name).toBe("CENTER");
  });

  it("encodes IR `textAlignVertical: center` as Figma `textAlignVertical: CENTER`", () => {
    const graph = irToSpecGraph(textIR({
      textStyle: {
        fontFamily: "Inter",
        fontStyle: "normal",
        fontWeight: 400,
        fontSize: 16,
        lineHeight: { unit: "normal" },
        letterSpacing: 0,
        textAlign: "left",
        textAlignVertical: "center",
        textTransform: "none",
        textDecoration: "none",
      },
    }));
    if (graph.spec.type !== "TEXT") {
      throw new Error();
    }
    expect(graph.spec.textAlignVertical?.name).toBe("CENTER");
  });
});

describe("irToSpecGraph — rectangle", () => {
  it("emits RECTANGLE when there is no cornerRadius", () => {
    const graph = irToSpecGraph(rectIR());
    expect(graph.spec.type).toBe("RECTANGLE");
  });

  it("emits ROUNDED_RECTANGLE when cornerRadius is set, resolving to px", () => {
    const graph = irToSpecGraph(rectIR({
      box: { x: 0, y: 0, width: 40, height: 40 },
      style: {
        ...NEUTRAL_STYLE,
        cornerRadius: [pxLength(8), pxLength(8), pxLength(8), pxLength(8)],
      },
    }));
    expect(graph.spec.type).toBe("ROUNDED_RECTANGLE");
    if (graph.spec.type !== "ROUNDED_RECTANGLE") {
      throw new Error();
    }
    expect(graph.spec.rectangleCornerRadii).toEqual([8, 8, 8, 8]);
  });
});

describe("irToSpecGraph — vector", () => {
  it("translates VectorPathIR.fillRule into windingRule NONZERO/EVENODD", () => {
    const graph = irToSpecGraph(vectorIR({
      paths: [
        { d: "M0 0 L10 10", fillRule: "evenodd" },
        { d: "M10 10 L20 20" },
      ],
    }));
    expect(graph.spec.type).toBe("VECTOR");
    if (graph.spec.type !== "VECTOR") {
      throw new Error();
    }
    expect(graph.spec.vectorPaths).toHaveLength(2);
    expect(graph.spec.vectorPaths![0]!.windingRule).toBe("EVENODD");
    expect(graph.spec.vectorPaths![1]!.windingRule).toBe("NONZERO");
    expect(graph.spec.vectorPaths![0]!.data).toBe("M0 0 L10 10");
  });

  it("keeps a donut (multi-subpath, evenodd) intact so the hole survives", () => {
    // Outer rectangle + inner rectangle in one path, even-odd
    // fill-rule. SVG renders this as a donut because the inner
    // subpath cancels the outer's fill. Splitting on `M` would
    // produce two independent vectorPath entries, each filled
    // separately, so the inner becomes a second filled disk on
    // top of the outer instead of a hole.
    const donut = "M0 0 L100 0 L100 100 L0 100 Z M25 25 L75 25 L75 75 L25 75 Z";
    const graph = irToSpecGraph(vectorIR({
      paths: [{ d: donut, fillRule: "evenodd" }],
    }));
    expect(graph.spec.type).toBe("VECTOR");
    if (graph.spec.type !== "VECTOR") {
      throw new Error();
    }
    expect(graph.spec.vectorPaths).toHaveLength(1);
    expect(graph.spec.vectorPaths![0]!.windingRule).toBe("EVENODD");
    expect(graph.spec.vectorPaths![0]!.data).toBe(donut);
  });

  it("still splits multi-subpath nonzero paths", () => {
    // Nonzero fills each subpath independently, so the per-vectorPath
    // split is safe — and protects against Figma's pen joining an
    // open subpath's last point to the next M.
    const twoSubpaths = "M0 0 L10 10 M20 20 L30 30";
    const graph = irToSpecGraph(vectorIR({
      paths: [{ d: twoSubpaths, fillRule: "nonzero" }],
    }));
    expect(graph.spec.type).toBe("VECTOR");
    if (graph.spec.type !== "VECTOR") {
      throw new Error();
    }
    expect(graph.spec.vectorPaths).toHaveLength(2);
    expect(graph.spec.vectorPaths![0]!.data).toBe("M0 0 L10 10");
    expect(graph.spec.vectorPaths![1]!.data).toBe("M20 20 L30 30");
  });
});
