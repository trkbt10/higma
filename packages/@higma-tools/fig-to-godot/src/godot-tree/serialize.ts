/**
 * @file Serialize a `GodotScene` / `GodotResource` to `.tscn` / `.tres` text.
 *
 * One pass, no string concatenation outside `godotStringLiteral`. The
 * `.tscn` format is line-based:
 *
 *   [gd_scene load_steps=N format=3]
 *
 *   [ext_resource type="Theme" path="res://Themes/Default.tres" id="1_abc"]
 *
 *   [sub_resource type="StyleBoxFlat" id="StyleBoxFlat_xyz"]
 *   bg_color = Color(0.9, 0.3, 0.3, 1)
 *   corner_radius_top_left = 4
 *
 *   [node name="Root" type="Control"]
 *   anchor_right = 1.0
 *
 *   [node name="Body" type="VBoxContainer" parent="."]
 *   theme_override_constants/separation = 8
 *
 * Numbers print as Godot integer literals when they have no fractional
 * part (`anchors_preset = 0`) and as Godot floats with up to six
 * decimals trimmed of trailing zeroes otherwise (`anchor_right = 1.0`,
 * `offset_top = 12.5`). Producing `1.000000` for `1.0` is valid Godot
 * but visually clutters the output; `Color`/`Vector2`/`Rect2` channels
 * print with the same trimming because Godot stores them as floats and
 * the editor itself emits the trimmed form.
 *
 * Strings inside `.tscn` use double-quoted GDScript-style literals
 * with `\\`, `\"`, `\n`, `\r`, `\t`, `\u{XXXX}` escapes. Multi-byte
 * UTF-8 (Japanese, emoji) passes through unchanged because Godot
 * stores `.tscn` as UTF-8 and the editor preserves multi-byte input.
 */
import type {
  GodotExtResource,
  GodotNode,
  GodotProperty,
  GodotResource,
  GodotScene,
  GodotSubResource,
  GodotValue,
} from "./types";

const SCENE_FORMAT = 3;
const RESOURCE_FORMAT = 3;

/** Render a complete `.tscn` file (no trailing newline beyond one final line break). */
export function serializeScene(scene: GodotScene): string {
  const loadSteps = scene.extResources.length + scene.subResources.length + 1;
  const lines: string[] = [];
  lines.push(`[gd_scene load_steps=${loadSteps} format=${SCENE_FORMAT}]`);
  lines.push("");
  for (const ext of scene.extResources) {
    lines.push(printExtResource(ext));
  }
  if (scene.extResources.length > 0) {
    lines.push("");
  }
  for (const sub of scene.subResources) {
    lines.push(...printSubResource(sub));
    lines.push("");
  }
  lines.push(...printRootNode(scene.root));
  for (const child of flattenChildren(scene.root)) {
    lines.push("");
    lines.push(...printChildNode(child));
  }
  return lines.join("\n") + "\n";
}

/** Render a complete `.tres` Theme document. */
export function serializeResource(res: GodotResource): string {
  const loadSteps = res.extResources.length + res.subResources.length + 1;
  const lines: string[] = [];
  lines.push(`[gd_resource type="${res.type}" load_steps=${loadSteps} format=${RESOURCE_FORMAT}]`);
  lines.push("");
  for (const ext of res.extResources) {
    lines.push(printExtResource(ext));
  }
  if (res.extResources.length > 0) {
    lines.push("");
  }
  for (const sub of res.subResources) {
    lines.push(...printSubResource(sub));
    lines.push("");
  }
  lines.push("[resource]");
  for (const prop of res.properties) {
    lines.push(printProperty(prop));
  }
  return lines.join("\n") + "\n";
}

function printExtResource(ext: GodotExtResource): string {
  return `[ext_resource type="${ext.type}" path=${godotStringLiteral(ext.path)} id="${ext.id}"]`;
}

function printSubResource(sub: GodotSubResource): readonly string[] {
  const head = `[sub_resource type="${sub.type}" id="${sub.id}"]`;
  return [head, ...sub.properties.map(printProperty)];
}

function printRootNode(root: GodotNode): readonly string[] {
  const head = `[node name=${godotStringLiteral(root.name)} type="${root.type}"]`;
  return [head, ...root.properties.map(printProperty)];
}

type FlattenedChild = {
  readonly node: GodotNode;
  /**
   * Path written into the child's `parent="..."` attribute. Direct
   * children of the root use `"."`; deeper descendants use the
   * slash-separated path of their ancestors *under* the root, e.g.
   * `"Body"` for a grandchild and `"Body/Inner"` for a great-grandchild.
   */
  readonly parentPath: string;
};

/**
 * Walk a Godot node depth-first and emit one entry per non-root node,
 * each carrying the dot-relative parent path the `.tscn` format
 * expects. The root itself is not in the result; its block is printed
 * separately by `printRootNode`.
 *
 * Direct children of the root use parent path `"."`; deeper
 * descendants use the slash-separated path of their ancestors *under*
 * the root. The root's own name never appears in any parent path.
 */
function flattenChildren(root: GodotNode): readonly FlattenedChild[] {
  const out: FlattenedChild[] = [];
  for (const child of root.children) {
    out.push({ node: child, parentPath: "." });
    visitDescendants(child, child.name, out);
  }
  return out;
}

function visitDescendants(parent: GodotNode, parentPath: string, out: FlattenedChild[]): void {
  for (const child of parent.children) {
    out.push({ node: child, parentPath });
    visitDescendants(child, `${parentPath}/${child.name}`, out);
  }
}

function printChildNode(entry: FlattenedChild): readonly string[] {
  const head =
    `[node name=${godotStringLiteral(entry.node.name)} type="${entry.node.type}" parent=${godotStringLiteral(entry.parentPath)}]`;
  return [head, ...entry.node.properties.map(printProperty)];
}

function printProperty(prop: GodotProperty): string {
  return `${prop.name} = ${printValue(prop.value)}`;
}

function printValue(value: GodotValue): string {
  switch (value.kind) {
    case "int":
      return value.value.toString(10);
    case "float":
      return printFloat(value.value);
    case "bool":
      return value.value ? "true" : "false";
    case "string":
      return godotStringLiteral(value.value);
    case "vector2":
      return `Vector2(${printFloat(value.x)}, ${printFloat(value.y)})`;
    case "rect2":
      return `Rect2(${printFloat(value.x)}, ${printFloat(value.y)}, ${printFloat(value.w)}, ${printFloat(value.h)})`;
    case "color":
      return `Color(${printFloat(value.r)}, ${printFloat(value.g)}, ${printFloat(value.b)}, ${printFloat(value.a)})`;
    case "node-path":
      return `NodePath(${godotStringLiteral(value.path)})`;
    case "ext-resource":
      return `ExtResource("${value.id}")`;
    case "sub-resource":
      return `SubResource("${value.id}")`;
    case "enum":
      return value.value.toString(10);
    case "raw":
      return value.text;
  }
}

/**
 * Print a Godot float literal. Integer-valued floats print as `1.0`
 * (Godot's editor convention), other values trim trailing zeros after
 * `toFixed(8)`. NaN / Infinity throw — neither is representable in
 * `.tscn` numeric properties.
 *
 * Why 8 decimals (not 6): Figma stores colours as float32 like
 * `0.949999988`. `toFixed(6)` rounds to `"0.950000"` → `0.95`, which
 * `* 255` yields `242.25` → may round to 243 instead of the
 * reference's 242. `toFixed(8)` preserves enough precision (`"0.94999999"`)
 * that Godot's reparse multiplies to `241.99...` and rounds to 242.
 * The extra two digits cost ~30 bytes per StyleBox; tiny price for
 * pixel-byte fidelity.
 */
export function printFloat(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`fig-to-godot: cannot serialize non-finite number ${String(value)}`);
  }
  if (Number.isInteger(value)) {
    return `${value.toString(10)}.0`;
  }
  return trimDecimalZeroes(value.toFixed(8));
}

function trimDecimalZeroes(s: string): string {
  if (!s.includes(".")) {
    return s;
  }
  const trimmed = s.replace(/0+$/u, "");
  return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
}

/**
 * Escape a JS string into a Godot `.tscn` string literal. Godot uses
 * GDScript-style escaping: `\\`, `\"`, `\n`, `\r`, `\t`, plus `\u{XXXX}`
 * for sub-0x20 control characters. UTF-8 multi-byte sequences pass
 * through unchanged so Japanese / emoji round-trip byte-for-byte.
 */
export function godotStringLiteral(value: string): string {
  const escaped: string[] = [];
  for (const ch of value) {
    escaped.push(escapeChar(ch));
  }
  return `"${escaped.join("")}"`;
}

function escapeChar(ch: string): string {
  switch (ch) {
    case "\\":
      return "\\\\";
    case '"':
      return '\\"';
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    case "\0":
      return "\\0";
    default: {
      const code = ch.codePointAt(0);
      if (code === undefined) {
        throw new Error("fig-to-godot: empty char in string literal");
      }
      if (code < 0x20) {
        return `\\u{${code.toString(16)}}`;
      }
      return ch;
    }
  }
}
