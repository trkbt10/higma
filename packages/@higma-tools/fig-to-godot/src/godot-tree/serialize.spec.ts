/**
 * @file Spec for the Godot scene-tree serializer.
 *
 * Locks in the `.tscn` / `.tres` surface contract: section ordering,
 * value formatting, child-parent path derivation, string escaping.
 * Any change in output here is a behaviour change observable to
 * consumers (and to the Godot editor's diff after re-save).
 */
import {
  colorVal,
  enumVal,
  extResource,
  floatVal,
  intVal,
  node,
  property,
  resource,
  scene,
  stringVal,
  subResource,
  subResourceRef,
  vector2,
} from "./builder";
import {
  godotStringLiteral,
  printFloat,
  serializeResource,
  serializeScene,
} from "./serialize";

describe("printFloat", () => {
  it("appends .0 for integer-valued floats", () => {
    expect(printFloat(1)).toBe("1.0");
    expect(printFloat(0)).toBe("0.0");
    expect(printFloat(-12)).toBe("-12.0");
  });

  it("trims trailing zeroes for non-integer floats", () => {
    expect(printFloat(0.5)).toBe("0.5");
    expect(printFloat(1.25)).toBe("1.25");
  });

  it("throws for non-finite floats", () => {
    expect(() => printFloat(NaN)).toThrow(/non-finite/u);
    expect(() => printFloat(Infinity)).toThrow(/non-finite/u);
  });
});

describe("godotStringLiteral", () => {
  it("escapes backslashes and double quotes", () => {
    expect(godotStringLiteral('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("escapes common control characters", () => {
    expect(godotStringLiteral("a\nb\tc")).toBe('"a\\nb\\tc"');
  });

  it("escapes other control bytes via \\u{XX}", () => {
    expect(godotStringLiteral(String.fromCharCode(0x01))).toBe('"\\u{1}"');
  });

  it("passes printable Unicode through unchanged", () => {
    expect(godotStringLiteral("こんにちは🎉")).toBe('"こんにちは🎉"');
  });
});

describe("serializeScene", () => {
  it("emits a single-node scene with no resources", () => {
    const root = node("Root", "Control", {
      properties: [
        property("offset_right", floatVal(320)),
        property("offset_bottom", floatVal(480)),
      ],
    });
    const out = serializeScene(scene(root));
    expect(out).toBe(
      [
        "[gd_scene load_steps=1 format=3]",
        "",
        '[node name="Root" type="Control"]',
        "offset_right = 320.0",
        "offset_bottom = 480.0",
        "",
      ].join("\n"),
    );
  });

  it("flattens children with parent paths relative to the root", () => {
    const inner = node("Inner", "Control");
    const body = node("Body", "VBoxContainer", { children: [inner] });
    const root = node("Root", "Control", { children: [body] });
    const out = serializeScene(scene(root));
    expect(out).toBe(
      [
        "[gd_scene load_steps=1 format=3]",
        "",
        '[node name="Root" type="Control"]',
        "",
        '[node name="Body" type="VBoxContainer" parent="."]',
        "",
        '[node name="Inner" type="Control" parent="Body"]',
        "",
      ].join("\n"),
    );
  });

  it("emits sub-resources before the root and references them via SubResource", () => {
    const styleBox = subResource("StyleBoxFlat_001", "StyleBoxFlat", [
      property("bg_color", colorVal(0.9, 0.3, 0.3, 1)),
      property("corner_radius_top_left", intVal(4)),
    ]);
    const root = node("Root", "Panel", {
      properties: [property("theme_override_styles/panel", subResourceRef("StyleBoxFlat_001"))],
    });
    const out = serializeScene(scene(root, { subResources: [styleBox] }));
    expect(out).toBe(
      [
        "[gd_scene load_steps=2 format=3]",
        "",
        '[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_001"]',
        "bg_color = Color(0.9, 0.3, 0.3, 1.0)",
        "corner_radius_top_left = 4",
        "",
        '[node name="Root" type="Panel"]',
        'theme_override_styles/panel = SubResource("StyleBoxFlat_001")',
        "",
      ].join("\n"),
    );
  });

  it("includes ext-resources in the section order", () => {
    const ext = extResource("1_theme", "Theme", "res://Themes/Default.tres");
    const root = node("Root", "Control");
    const out = serializeScene(scene(root, { extResources: [ext] }));
    expect(out).toBe(
      [
        "[gd_scene load_steps=2 format=3]",
        "",
        '[ext_resource type="Theme" path="res://Themes/Default.tres" id="1_theme"]',
        "",
        '[node name="Root" type="Control"]',
        "",
      ].join("\n"),
    );
  });

  it("prints Vector2 / Color / enum values inline", () => {
    const root = node("Root", "Control", {
      properties: [
        property("position", vector2(12, 16)),
        property("modulate", colorVal(1, 1, 1, 0.5)),
        property("alignment", enumVal(2, "END")),
        property("tooltip_text", stringVal('foo "bar"')),
      ],
    });
    const out = serializeScene(scene(root));
    expect(out).toContain("position = Vector2(12.0, 16.0)");
    expect(out).toContain("modulate = Color(1.0, 1.0, 1.0, 0.5)");
    expect(out).toContain("alignment = 2");
    expect(out).toContain('tooltip_text = "foo \\"bar\\""');
  });
});

describe("serializeResource", () => {
  it("emits a Theme `.tres` with a [resource] body", () => {
    const styleBox = subResource("StyleBoxFlat_001", "StyleBoxFlat", [
      property("bg_color", colorVal(1, 1, 1, 1)),
    ]);
    const res = resource("Theme", {
      subResources: [styleBox],
      properties: [property("Panel/styles/panel", subResourceRef("StyleBoxFlat_001"))],
    });
    const out = serializeResource(res);
    expect(out).toBe(
      [
        '[gd_resource type="Theme" load_steps=2 format=3]',
        "",
        '[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_001"]',
        "bg_color = Color(1.0, 1.0, 1.0, 1.0)",
        "",
        "[resource]",
        'Panel/styles/panel = SubResource("StyleBoxFlat_001")',
        "",
      ].join("\n"),
    );
  });
});
