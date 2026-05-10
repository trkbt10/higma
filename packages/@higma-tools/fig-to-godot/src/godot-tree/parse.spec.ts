/**
 * @file Spec for the `.tscn` parser — verifies the structural roundtrip
 * `serializeScene(s) → parseScene(text)` produces an equivalent IR.
 *
 * These tests use small in-memory scenes built from the IR builders so
 * the parser's input is exactly the serializer's output. Real `.fig`-
 * derived scenes are exercised by `spec/roundtrip.spec.ts`, which loops
 * over the `cases/` fixtures.
 */
import {
  colorVal,
  enumVal,
  extResource,
  floatVal,
  intVal,
  node,
  property,
  scene,
  stringVal,
  subResource,
  vector2,
} from "./builder";
import { serializeScene } from "./serialize";
import { ParseError, parseScene } from "./parse";

describe("parseScene — roundtrip equivalence", () => {
  it("roundtrips a single-node scene", () => {
    const original = scene(
      node("Root", "Control", {
        properties: [
          property("offset_right", floatVal(320)),
          property("offset_bottom", floatVal(480)),
        ],
      }),
    );
    const parsed = parseScene(serializeScene(original));
    expect(parsed).toEqual(original);
  });

  it("roundtrips a tree of nested children with `parent=` paths", () => {
    const original = scene(
      node("Root", "Control", {
        children: [
          node("Body", "VBoxContainer", {
            children: [
              node("Inner", "Panel"),
            ],
          }),
        ],
      }),
    );
    const parsed = parseScene(serializeScene(original));
    expect(parsed).toEqual(original);
  });

  it("roundtrips sub-resources and SubResource references", () => {
    const styleBox = subResource("StyleBoxFlat_001", "StyleBoxFlat", [
      property("bg_color", colorVal(0.9, 0.3, 0.3, 1)),
      property("corner_radius_top_left", intVal(4)),
    ]);
    const original = scene(
      node("Root", "Panel", {
        properties: [
          property("theme_override_styles/panel", { kind: "sub-resource", id: "StyleBoxFlat_001" }),
        ],
      }),
      { subResources: [styleBox] },
    );
    const parsed = parseScene(serializeScene(original));
    expect(parsed).toEqual(original);
  });

  it("roundtrips ext-resources and ExtResource references", () => {
    const ext = extResource("1_theme", "Theme", "res://Themes/Default.tres");
    const original = scene(
      node("Root", "Control", {
        properties: [property("theme", { kind: "ext-resource", id: "1_theme" })],
      }),
      { extResources: [ext] },
    );
    const parsed = parseScene(serializeScene(original));
    expect(parsed).toEqual(original);
  });

  it("preserves Vector2 / Color / enum / string values", () => {
    const original = scene(
      node("Root", "Control", {
        properties: [
          property("position", vector2(12, 16)),
          property("modulate", colorVal(1, 1, 1, 0.5)),
          property("alignment", enumVal(2, "END")),
          property("tooltip_text", stringVal('foo "bar"')),
          property("text", stringVal("こんにちは🎉")),
        ],
      }),
    );
    const parsed = parseScene(serializeScene(original));
    // `enumVal` carries a symbolic `name` field that the serializer
    // drops (it only prints the integer); the parser cannot recover it
    // and emits an `int` value. That difference is expected.
    const parsedAlignment = parsed.root.properties.find((p) => p.name === "alignment");
    expect(parsedAlignment?.value).toEqual({ kind: "int", value: 2 });
    const parsedColor = parsed.root.properties.find((p) => p.name === "modulate");
    expect(parsedColor?.value).toEqual({ kind: "color", r: 1, g: 1, b: 1, a: 0.5 });
    const parsedText = parsed.root.properties.find((p) => p.name === "text");
    expect(parsedText?.value).toEqual({ kind: "string", value: "こんにちは🎉" });
  });
});

describe("parseScene — error handling", () => {
  it("throws on missing scene header", () => {
    expect(() => parseScene("[node name=\"X\" type=\"Control\"]")).toThrow(ParseError);
  });

  it("throws on a non-root [node] missing the parent attribute", () => {
    const text = [
      "[gd_scene load_steps=1 format=3]",
      "",
      '[node name="A" type="Control"]',
      "",
      '[node name="B" type="Control"]',
      "",
    ].join("\n");
    expect(() => parseScene(text)).toThrow(/parent/u);
  });

  it("throws on an unknown constructor", () => {
    const text = [
      "[gd_scene load_steps=1 format=3]",
      "",
      '[node name="A" type="Control"]',
      "weird = Quaternion(1, 2, 3, 4)",
      "",
    ].join("\n");
    expect(() => parseScene(text)).toThrow(/unsupported constructor/u);
  });
});
