/**
 * @file End-to-end spec for `emitNode` — the FigNode → Godot scene walker.
 *
 * The tests build minimal in-memory FigNode trees (no .fig binary, no
 * symbol resolution) and assert the emitted `.tscn` text. Anything
 * that survives the spec is what real .fig content will produce when
 * the same node shapes flow through the IO loader.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { serializeScene, scene } from "../godot-tree";
import { createWalkContext, emitNode } from "./walk";

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

function emitToScene(node: FigNode): string {
  const ctx = createWalkContext();
  const root = emitNode(node, ctx);
  return serializeScene(scene(root, { subResources: ctx.subResources }));
}

describe("emitNode — TEXT", () => {
  it("emits a Label with text and font overrides", () => {
    const node = text({
      name: "Greeting",
      characters: "Hello",
      fontSize: 16,
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    const out = emitToScene(node);
    expect(out).toContain('[node name="Greeting" type="Label"]');
    expect(out).toContain('text = "Hello"');
    expect(out).toContain("theme_override_colors/font_color = Color(0.0, 0.0, 0.0, 1.0)");
    expect(out).toContain("theme_override_font_sizes/font_size = 16");
  });

  it("reads characters from textData when top-level characters is missing", () => {
    const node = text({
      name: "From Data",
      textData: { characters: "From textData" },
      fontSize: 14,
    });
    const out = emitToScene(node);
    expect(out).toContain('text = "From textData"');
  });
});

describe("emitNode — RECTANGLE", () => {
  it("emits a Panel with a StyleBoxFlat sub-resource attached via theme_override_styles/panel", () => {
    const node = rect({
      name: "Box",
      size: { x: 80, y: 80 },
      fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      cornerRadius: 8,
    });
    const out = emitToScene(node);
    expect(out).toContain('[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_001"]');
    expect(out).toContain("bg_color = Color(1.0, 0.0, 0.0, 1.0)");
    expect(out).toContain("corner_radius_top_left = 8");
    expect(out).toContain('[node name="Box" type="Panel"]');
    expect(out).toContain('theme_override_styles/panel = SubResource("StyleBoxFlat_001")');
  });

  it("throws when a RECTANGLE has no SOLID fill (Fail-Fast)", () => {
    const node = rect({ name: "Empty", size: { x: 10, y: 10 } });
    expect(() => emitToScene(node)).toThrow(/no SOLID fill/u);
  });
});

describe("emitNode — FRAME (HBoxContainer)", () => {
  it("emits HBoxContainer with alignment + separation, children carry no size flags by default", () => {
    const a = rect({
      name: "A",
      size: { x: 40, y: 40 },
      fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
    const b = rect({
      name: "B",
      size: { x: 40, y: 40 },
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } }],
    });
    const root = frame({
      name: "Row",
      size: { x: 200, y: 80 },
      stackMode: enumName("HORIZONTAL"),
      stackPrimaryAlignItems: enumName("CENTER"),
      stackCounterAlignItems: enumName("CENTER"),
      stackSpacing: 8,
      children: [a, b],
    } as Partial<FigNode>);
    const out = emitToScene(root);
    expect(out).toContain('[node name="Row" type="HBoxContainer"]');
    expect(out).toContain("alignment = 1");
    expect(out).toContain("theme_override_constants/separation = 8");
    expect(out).toContain('[node name="A" type="Panel" parent="."]');
    expect(out).toContain('[node name="B" type="Panel" parent="."]');
    // Children inherit center counter alignment via SHRINK_CENTER on
    // the cross axis (vertical for HBox).
    expect(out).toContain("size_flags_vertical = 4");
  });

  it("inserts spacer Controls for SPACE_BETWEEN and zeroes the BoxContainer separation", () => {
    const a = rect({
      name: "A",
      size: { x: 40, y: 40 },
      fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
    const b = rect({
      name: "B",
      size: { x: 40, y: 40 },
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } }],
    });
    const root = frame({
      name: "Row",
      size: { x: 200, y: 80 },
      stackMode: enumName("HORIZONTAL"),
      stackPrimaryAlignItems: enumName("SPACE_BETWEEN"),
      stackSpacing: 8,
      children: [a, b],
    } as Partial<FigNode>);
    const out = emitToScene(root);
    expect(out).toContain('[node name="Spacer" type="Control" parent="."]');
    expect(out).toContain("size_flags_horizontal = 3");
    expect(out).toContain("theme_override_constants/separation = 0");
  });
});

describe("emitNode — FRAME (Control / non-autolayout)", () => {
  it("emits children with absolute offsets when the parent has no autolayout", () => {
    const child = rect({
      name: "Floater",
      size: { x: 20, y: 20 },
      transform: { m00: 1, m01: 0, m02: 12, m10: 0, m11: 1, m12: 16 },
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
    });
    const root = frame({
      name: "Page",
      size: { x: 200, y: 200 },
      children: [child],
    } as Partial<FigNode>);
    const out = emitToScene(root);
    expect(out).toContain('[node name="Page" type="Control"]');
    expect(out).toContain('[node name="Floater" type="Panel" parent="."]');
    expect(out).toContain("offset_left = 12.0");
    expect(out).toContain("offset_top = 16.0");
    expect(out).toContain("offset_right = 32.0");
    expect(out).toContain("offset_bottom = 36.0");
  });
});

describe("emitNode — FRAME with padding", () => {
  it("wraps the BoxContainer in a MarginContainer carrying the four margin overrides", () => {
    const a = rect({
      name: "A",
      size: { x: 40, y: 40 },
      fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
    const root = frame({
      name: "Padded",
      size: { x: 100, y: 100 },
      stackMode: enumName("VERTICAL"),
      stackPadding: 12,
      children: [a],
    } as Partial<FigNode>);
    const out = emitToScene(root);
    expect(out).toContain('type="MarginContainer"');
    expect(out).toContain("theme_override_constants/margin_left = 12");
    expect(out).toContain("theme_override_constants/margin_top = 12");
    expect(out).toContain("theme_override_constants/margin_right = 12");
    expect(out).toContain("theme_override_constants/margin_bottom = 12");
  });
});

describe("emitNode — unsupported", () => {
  it("throws on an unknown node type", () => {
    const node = frame({ name: "Star", type: enumName("VECTOR") });
    expect(() => emitToScene(node)).toThrow(/unsupported node type/u);
  });
});
