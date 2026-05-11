/**
 * @file End-to-end spec for `emitNode` — the FigNode → SwiftView walker.
 *
 * The tests build minimal in-memory FigNode trees (no .fig binary, no
 * symbol resolution) and assert the emitted Swift source. Anything
 * that survives the spec is what real .fig content will produce when
 * the same node shapes flow through the IO loader.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { serialize } from "../swift-tree";
import { emitNode } from "./walk";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function frame(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    ...partial,
  } as FigNode;
}

function rect(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 99 },
    phase: enumName("CREATED"),
    type: enumName("RECTANGLE"),
    ...partial,
  } as FigNode;
}

function text(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 42 },
    phase: enumName("CREATED"),
    type: enumName("TEXT"),
    ...partial,
  } as FigNode;
}

describe("emitNode — TEXT", () => {
  it("emits Text(...) with characters and font", () => {
    const node = text({
      characters: "Hello",
      fontSize: 16,
      fontName: { family: "Inter", style: "Bold" },
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    expect(serialize(emitNode(node))).toBe(
      [
        'Text("Hello")',
        "  .font(.system(size: 16, weight: .bold))",
        "  .foregroundColor(Color(red: 0, green: 0, blue: 0))",
      ].join("\n"),
    );
  });

  it("reads characters from textData when top-level characters is missing", () => {
    const node = text({
      textData: { characters: "From textData" },
      fontSize: 14,
    });
    expect(serialize(emitNode(node))).toBe(
      [
        'Text("From textData")',
        "  .font(.system(size: 14))",
      ].join("\n"),
    );
  });
});

describe("emitNode — RECTANGLE", () => {
  it("emits Rectangle() with .fill (not .background) so the shape paints the requested colour", () => {
    const node = rect({
      size: { x: 80, y: 80 },
      fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      cornerRadius: 8,
    });
    expect(serialize(emitNode(node))).toBe(
      [
        "RoundedRectangle(cornerRadius: 8)",
        "  .fill(Color(red: 1, green: 0, blue: 0))",
        "  .frame(width: 80, height: 80, alignment: .topLeading)",
      ].join("\n"),
    );
  });

  it("throws when a rectangle has no SOLID fill", () => {
    expect(() => emitNode(rect({ size: { x: 10, y: 10 } }))).toThrow(/no SOLID fill/u);
  });
});

describe("emitNode — autolayout HStack", () => {
  it("emits HStack with spacing and padding around children", () => {
    const child = text({
      characters: "Tap",
      fontSize: 16,
      fontName: { family: "Inter", style: "Bold" },
      fillPaints: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    });
    const node = frame({
      stackMode: enumName("HORIZONTAL"),
      stackSpacing: 8,
      stackPadding: 12,
      stackCounterAlignItems: enumName("CENTER"),
      size: { x: 200, y: 44 },
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
      cornerRadius: 22,
      children: [child],
    });
    expect(serialize(emitNode(node))).toBe(
      [
        "HStack(alignment: .center, spacing: 8) {",
        '  Text("Tap")',
        "    .font(.system(size: 16, weight: .bold))",
        "    .foregroundColor(Color(red: 1, green: 1, blue: 1))",
        "}",
        "  .padding(12)",
        "  .frame(width: 200, height: 44, alignment: .leading)",
        // Frame default clips its children to the silhouette
        // (Figma's `clipsContent` default = true). The clipShape is
        // applied BEFORE `.background(...)` so the bg paints behind
        // the clipped foreground without itself being clipped.
        "  .clipShape(RoundedRectangle(cornerRadius: 22))",
        "  .background(RoundedRectangle(cornerRadius: 22)",
        "    .fill(Color(red: 0, green: 0, blue: 1)))",
      ].join("\n"),
    );
  });
});

describe("emitNode — autolayout VStack with primary distribution", () => {
  it("inserts Spacer values for SPACE_BETWEEN distribution", () => {
    const a = text({ characters: "A", fontSize: 12 });
    const b = text({ characters: "B", fontSize: 12 });
    const c = text({ characters: "C", fontSize: 12 });
    const node = frame({
      stackMode: enumName("VERTICAL"),
      stackPrimaryAlignItems: enumName("SPACE_BETWEEN"),
      children: [a, b, c],
    });
    expect(serialize(emitNode(node))).toBe(
      [
        "VStack(alignment: .leading, spacing: 0) {",
        '  Text("A")',
        "    .font(.system(size: 12))",
        "  Spacer(minLength: 0)",
        '  Text("B")',
        "    .font(.system(size: 12))",
        "  Spacer(minLength: 0)",
        '  Text("C")',
        "    .font(.system(size: 12))",
        "}",
        "  .clipShape(Rectangle())",
      ].join("\n"),
    );
  });

  it("CENTER distribution does not insert Spacer values — uses frame alignment instead", () => {
    // SwiftUI realises Figma's CENTER primary-alignment by setting
    // `.frame(alignment:)` on the outer HStack/VStack. Inserting
    // leading + trailing `Spacer()` siblings would also push content
    // to the centre, but it stacks the parent's `stackSpacing` value
    // BETWEEN the rect↔Spacer pairs and pushes the children past the
    // frame edge for fixtures that already fill the available extent
    // (the auto-h-center fixture is the canonical regression). The
    // emitter therefore omits the Spacers for CENTER / MAX primary
    // distribution and relies on `.frame(alignment:)` alone — see
    // `applyPrimaryDistribution` in walk.ts for the rationale.
    const a = text({ characters: "A", fontSize: 12 });
    const node = frame({
      stackMode: enumName("HORIZONTAL"),
      stackPrimaryAlignItems: enumName("CENTER"),
      children: [a],
    });
    expect(serialize(emitNode(node))).toBe(
      [
        "HStack(alignment: .top, spacing: 0) {",
        '  Text("A")',
        "    .font(.system(size: 12))",
        "}",
        "  .clipShape(Rectangle())",
      ].join("\n"),
    );
  });
});

describe("emitNode — non-autolayout frame becomes ZStack", () => {
  it("emits ZStack(alignment: .topLeading) with .offset on absolute children", () => {
    const child = text({
      characters: "X",
      fontSize: 12,
      transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 8 },
    });
    const node = frame({
      size: { x: 320, y: 100 },
      children: [child],
    });
    expect(serialize(emitNode(node))).toBe(
      [
        "ZStack(alignment: .topLeading) {",
        '  Text("X")',
        "    .font(.system(size: 12))",
        "    .offset(x: 24, y: 8)",
        "}",
        "  .frame(width: 320, height: 100, alignment: .topLeading)",
        "  .clipShape(Rectangle())",
      ].join("\n"),
    );
  });

  it("skips invisible children", () => {
    const visible = text({ characters: "V", fontSize: 12 });
    const hidden = text({ characters: "H", fontSize: 12, visible: false });
    const node = frame({ children: [visible, hidden] });
    expect(serialize(emitNode(node))).toBe(
      [
        "ZStack(alignment: .topLeading) {",
        '  Text("V")',
        "    .font(.system(size: 12))",
        "}",
        "  .clipShape(Rectangle())",
      ].join("\n"),
    );
  });
});
