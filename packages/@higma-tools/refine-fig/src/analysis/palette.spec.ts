/**
 * @file Unit tests for palette routines and the canonicalisation pass.
 */
import type { FigColor, FigNode, FigPaint } from "@higma-document-models/fig/types";
import { PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { createSymbolResolver } from "@higma-document-models/fig/symbols";
import { analysePalette, colorHex, colorKey } from "./palette";
import { fakeFigNode } from "./fig-node-test-fixtures";

const childrenOfFixtureNode = createSymbolResolver({
  document: indexFigKiwiDocument([]),
}).childrenOfResolvedNode;

function solid(r: number, g: number, b: number, a = 1): FigPaint {
  const color: FigColor = { r, g, b, a };
  return { type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color };
}

function vector(localID: number, name: string, fill: FigPaint): FigNode {
  return fakeFigNode({
    type: { value: 5, name: "VECTOR" },
    guid: { sessionID: 1, localID },
    name,
    fillPaints: [fill],
  });
}

function frameWith(localID: number, children: readonly FigNode[]): FigNode {
  return fakeFigNode({
    type: { value: 1, name: "FRAME" },
    guid: { sessionID: 1, localID },
    name: `frame-${localID}`,
    size: { x: 100, y: 100 },
    children,
  });
}

function styleDefinitionWith(localID: number, name: string, fill: FigPaint): FigNode {
  return fakeFigNode({
    type: { value: 17, name: "STYLE" },
    guid: { sessionID: 9, localID },
    name,
    styleType: { value: 1, name: "FILL" },
    fillPaints: [fill],
  });
}

describe("palette routines", () => {
  it("colorKey buckets near-identical SOLID colours together (fine-grain quantisation)", () => {
    expect(colorKey({ r: 0.1, g: 0.2, b: 0.3, a: 1 })).toBe(colorKey({ r: 0.1004, g: 0.2003, b: 0.3001, a: 1 }));
  });

  it("colorHex omits alpha when fully opaque and includes when not", () => {
    expect(colorHex({ r: 1, g: 0, b: 0, a: 1 })).toBe("#ff0000");
    expect(colorHex({ r: 1, g: 0, b: 0, a: 0.5 })).toBe("#ff000080");
  });
});

describe("analysePalette — canonicalisation across SVG round-trip drift", () => {
  it("collapses near-identical SOLID colours into one entry with aliases", () => {
    // Win98 design system case: 'black' appears as 9 micro-variants because
    // an SVG round-trip can perturb each channel by ≤ 3/255. Visually
    // identical, must be one palette entry.
    const blackVariants: FigColor[] = [
      { r: 0,       g: 0,       b: 0,       a: 1 },
      { r: 0,       g: 1 / 255, b: 0,       a: 1 },
      { r: 0,       g: 2 / 255, b: 0,       a: 1 },
      { r: 3 / 255, g: 0,       b: 0,       a: 1 },
      { r: 0,       g: 0,       b: 3 / 255, a: 1 },
      { r: 0,       g: 0,       b: 4 / 255, a: 1 },
      { r: 0,       g: 0,       b: 1 / 255, a: 1 },
      { r: 2 / 255, g: 0,       b: 0,       a: 1 },
      { r: 1 / 255, g: 0,       b: 0,       a: 1 },
    ];
    const vectors = blackVariants.map((c, i) => vector(10 + i, `v${i}`, solid(c.r, c.g, c.b, c.a)));
    const frame = frameWith(1, vectors);
    const yellowFrame = frameWith(2, [vector(50, "y", solid(1, 1, 1 / 3))]);

    const result = analysePalette([frame, yellowFrame], [], childrenOfFixtureNode);

    expect(result.entries).toHaveLength(2);
    const black = result.entries.find((e) => e.color.r < 0.5);
    if (!black) {
      throw new Error("expected a near-black entry");
    }
    expect(black.aliases.length + 1).toBe(blackVariants.length);
    expect(black.usages).toHaveLength(blackVariants.length);
  });

  it("keeps distinct theme colours separated", () => {
    // Win98 case: yellow #ffff55 and purple #5555aa must NOT collapse even
    // when both subtly drift.
    const yellow = solid(1, 1, 1 / 3);
    const yellowDrift = solid(1, 1, 1 / 3 + 1 / 255);
    const purple = solid(1 / 3, 1 / 3, 2 / 3);
    const purpleDrift = solid(1 / 3 + 1 / 255, 1 / 3, 2 / 3);
    const frame = frameWith(1, [
      vector(10, "a", yellow),
      vector(11, "b", yellowDrift),
      vector(12, "c", purple),
      vector(13, "d", purpleDrift),
    ]);

    const result = analysePalette([frame], [], childrenOfFixtureNode);

    expect(result.entries).toHaveLength(2);
    const hexes = new Set(result.entries.map((e) => e.hex));
    expect(hexes.has("#ffff55")).toBe(true);
    expect(hexes.has("#5555aa")).toBe(true);
  });

  it("picks the most-used variant as canonical representative (tie-break: lex-smallest key)", () => {
    // 5 usages of #000000, 1 usage of #000001. Representative must be black.
    const frame = frameWith(1, [
      vector(10, "a", solid(0, 0, 0)),
      vector(11, "b", solid(0, 0, 0)),
      vector(12, "c", solid(0, 0, 0)),
      vector(13, "d", solid(0, 0, 0)),
      vector(14, "e", solid(0, 0, 0)),
      vector(15, "f", solid(0, 0, 1 / 255)),
    ]);

    const result = analysePalette([frame], [], childrenOfFixtureNode);

    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    if (!entry) {
      throw new Error("expected one entry");
    }
    expect(entry.hex).toBe("#000000");
    expect(entry.usages).toHaveLength(6);
  });

  it("matches an existing FILL styleDefinition whose colour is a near-alias of the merged entry", () => {
    // StyleDefinition is exact #000000, usage is drifted #000003. They must still
    // bind to the same styleDefinition after canonicalisation.
    const frame = frameWith(1, [vector(10, "a", solid(0, 0, 3 / 255))]);
    const styleDefinition = styleDefinitionWith(100, "Black", solid(0, 0, 0));

    const result = analysePalette([frame], [styleDefinition], childrenOfFixtureNode);

    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    if (!entry) {
      throw new Error("expected one entry");
    }
    expect(entry.styleDefinitionName).toBe("Black");
  });

  it("throws when two existing FILL styleDefinitions would collapse into one merged entry", () => {
    // Same merged colour bucket cannot map to two different existing
    // styleDefinitions — it is a real ambiguity the agent must resolve. Fail
    // fast rather than picking one silently.
    const frame = frameWith(1, [vector(10, "a", solid(0, 0, 0))]);
    const styleDefinitionA = styleDefinitionWith(100, "Black", solid(0, 0, 0));
    const styleDefinitionB = styleDefinitionWith(101, "Almost-Black", solid(0, 0, 2 / 255));

    expect(() => analysePalette([frame], [styleDefinitionA, styleDefinitionB], childrenOfFixtureNode)).toThrow(/two FILL styleDefinitions/i);
  });

  it("merge tolerance is configurable per call", () => {
    // With a very tight tolerance, 1/255 drift is no longer enough to
    // collapse — the two colours stay separate.
    const frame = frameWith(1, [
      vector(10, "a", solid(0, 0, 0)),
      vector(11, "b", solid(0, 0, 1 / 255)),
    ]);

    const tight = analysePalette([frame], [], childrenOfFixtureNode, { mergeToleranceSrgb: 0 });
    const default_ = analysePalette([frame], [], childrenOfFixtureNode);

    expect(tight.entries).toHaveLength(2);
    expect(default_.entries).toHaveLength(1);
  });
});
