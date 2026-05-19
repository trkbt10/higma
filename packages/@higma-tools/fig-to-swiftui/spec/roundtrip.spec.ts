/**
 * @file Fig → SwiftUI → Fig (IR) round-trip contract.
 *
 * Pipeline under test:
 *
 *   FigNode fixture
 *     │ emitNode
 *     ▼
 *   SwiftView (`tree1`)
 *     │ serialize(tree1, 2)
 *     ▼
 *   string (Swift body fragment)
 *     │ parseView
 *     ▼
 *   SwiftView (`tree2`)
 *
 * Contract: `summarize(tree1)` and `summarize(tree2)` are equal at every
 * level. Anything stricter would tie the test to the exact byte layout
 * the formatter chose; anything weaker would let the parser silently
 * lose information.
 *
 * Asset / file-level surface (struct name, `#Preview`, file path) is
 * asserted separately on a hand-built fixture so the file emitter is
 * also covered without forcing a per-frame round-trip there.
 *
 * Runs entirely in memory — no Playwright, no `.fig` binary, no Xcode.
 */
import type { FigEffect, FigNode, FigPaint, KiwiEnumValue } from "@higma-document-models/fig/types";
import { EFFECT_TYPE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { runFigCase } from "./cases/run-fig-case";
import { summarize } from "./structural";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function solidPaint(color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }): FigPaint {
  return { type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color };
}

function dropShadow(fields: Omit<FigEffect, "type">): FigEffect {
  return { type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" }, ...fields };
}

function frame(name: string, partial: Partial<FigNode> = {}): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    name,
    ...partial,
  } as FigNode;
}

function text(characters: string, partial: Partial<FigNode> = {}): FigNode {
  return {
    guid: { sessionID: 1, localID: 2 },
    phase: enumName("CREATED"),
    type: enumName("TEXT"),
    characters,
    fontSize: 14,
    ...partial,
  } as FigNode;
}

describe("fig-to-swiftui round-trip", () => {
  it("preserves a leaf TEXT through emit → serialize → parse", () => {
    const node = frame("Wrapper", {
      stackMode: enumName("VERTICAL"),
      children: [
        text("Hello", {
          fontSize: 16,
          fontName: { family: "Inter", style: "Bold" },
          fillPaints: [solidPaint({ r: 0, g: 0, b: 0, a: 1 })],
        }),
      ],
    });
    const result = runFigCase({ node });
    expect(summarize(result.parsedTree)).toEqual(summarize(result.tree));
  });

  it("preserves an autolayout HStack with padding + corner radius + shadow", () => {
    const node = frame("Button", {
      stackMode: enumName("HORIZONTAL"),
      stackSpacing: 8,
      stackPadding: 12,
      stackCounterAlignItems: enumName("CENTER"),
      size: { x: 200, y: 44 },
      fillPaints: [solidPaint({ r: 0, g: 0, b: 1, a: 1 })],
      cornerRadius: 22,
      effects: [
        dropShadow({
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 0, y: 4 },
          radius: 8,
        }),
      ],
      children: [
        text("Tap", {
          fontSize: 16,
          fontName: { family: "Inter", style: "Bold" },
          fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
        }),
      ],
    });
    const result = runFigCase({ node });
    expect(summarize(result.parsedTree)).toEqual(summarize(result.tree));
  });

  it("preserves a non-autolayout ZStack with absolutely-positioned children", () => {
    const node = frame("Card", {
      size: { x: 320, y: 100 },
      fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
      cornerRadius: 12,
      children: [
        text("Headline", {
          fontSize: 18,
          fontName: { family: "Inter", style: "SemiBold" },
          transform: { m00: 1, m01: 0, m02: 16, m10: 0, m11: 1, m12: 16 },
        }),
        text("Detail", {
          fontSize: 13,
          fontName: { family: "Inter", style: "Regular" },
          transform: { m00: 1, m01: 0, m02: 16, m10: 0, m11: 1, m12: 56 },
        }),
      ],
    });
    const result = runFigCase({ node });
    expect(summarize(result.parsedTree)).toEqual(summarize(result.tree));
  });

  it("preserves SPACE_BETWEEN distribution Spacer insertions", () => {
    const node = frame("Toolbar", {
      stackMode: enumName("HORIZONTAL"),
      stackPrimaryAlignItems: enumName("SPACE_BETWEEN"),
      children: [
        text("Left", { fontSize: 14 }),
        text("Right", { fontSize: 14 }),
      ],
    });
    const result = runFigCase({ node });
    expect(summarize(result.parsedTree)).toEqual(summarize(result.tree));
  });

  it("emits a complete .swift file with import + struct + #Preview", () => {
    const node = frame("Hello", {
      stackMode: enumName("VERTICAL"),
      stackSpacing: 4,
      children: [
        text("Hello", {
          fontSize: 16,
          fontName: { family: "Inter", style: "Regular" },
        }),
      ],
    });
    const result = runFigCase({ node });
    expect(result.file.path).toBe("Pages/Hello.swift");
    expect(result.file.contents).toContain("import SwiftUI");
    expect(result.file.contents).toContain("struct Hello: View {");
    expect(result.file.contents).toContain("var body: some View {");
    expect(result.file.contents).toContain("#Preview {");
  });
});
