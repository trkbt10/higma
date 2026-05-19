/**
 * @file Parse a `.tscn` file back into the typed `GodotScene` IR.
 *
 * The parser is intentionally narrow: it only handles the dialect the
 * serializer produces, not the full `.tscn` grammar Godot's editor
 * accepts. That's deliberate — the parser exists so the roundtrip
 * spec can prove `serializeScene(scene) → parseScene(text)` produces
 * an equivalent IR. Anything outside the serializer's vocabulary
 * (NodePath, multiline arrays, comments, sub-resource cycles) throws.
 *
 * Supported per-line value forms — each maps onto one `GodotValue` kind:
 *
 *   - `123`                 → int
 *   - `1.0`, `0.5`          → float
 *   - `true` / `false`      → bool
 *   - `"foo"`               → string (with `\"`, `\\`, `\n`, `\t`, `\u{XX}` escapes)
 *   - `Vector2(x, y)`       → vector2
 *   - `Rect2(x, y, w, h)`   → rect2
 *   - `Color(r, g, b, a)`   → color
 *   - `NodePath("path")`    → node-path
 *   - `ExtResource("id")`   → ext-resource
 *   - `SubResource("id")`   → sub-resource
 *
 * The parser is a single-pass line scanner. It does not validate that
 * load_steps matches the resource count, that ids are unique, or that
 * parent paths actually exist — those invariants are the serializer's
 * responsibility, and the roundtrip spec catches divergence by IR
 * compare.
 */
import type {
  GodotExtResource,
  GodotNode,
  GodotProperty,
  GodotScene,
  GodotSubResource,
  GodotValue,
} from "./types";

/** Thrown when `parseScene` encounters input it cannot interpret. */
class ParseError extends Error {
  constructor(message: string, lineNumber: number) {
    super(`fig-to-godot parse: line ${lineNumber}: ${message}`);
    this.name = "ParseError";
  }
}

/** Parse a `.tscn` document back into the typed IR. */
export function parseScene(text: string): GodotScene {
  const lines = text.split(/\r?\n/);
  const blocks = readBlocks(lines);
  const header = blocks.find((b) => b.kind === "scene-header");
  if (!header) {
    throw new ParseError("missing [gd_scene] header", 1);
  }
  const extResources: GodotExtResource[] = blocks
    .filter((b) => b.kind === "ext-resource")
    .map((b) => parseExtResource(b));
  const subResources: GodotSubResource[] = blocks
    .filter((b) => b.kind === "sub-resource")
    .map((b) => parseSubResource(b));
  const nodeBlocks = blocks.filter((b) => b.kind === "node");
  if (nodeBlocks.length === 0) {
    throw new ParseError("scene contains no [node] blocks", 1);
  }
  const root = buildNodeTree(nodeBlocks);
  return { extResources, subResources, root };
}

type Block = {
  readonly kind: "scene-header" | "resource-header" | "ext-resource" | "sub-resource" | "node" | "resource";
  readonly headerLine: string;
  readonly headerLineNumber: number;
  readonly bodyLines: readonly { text: string; lineNumber: number }[];
};

function readBlocks(lines: readonly string[]): readonly Block[] {
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    if (raw === "" || !raw.startsWith("[")) {
      continue;
    }
    const kind = identifyHeader(raw, i + 1);
    const bodyLines: { text: string; lineNumber: number }[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]!;
      if (next.startsWith("[")) {
        break;
      }
      if (next === "") {
        continue;
      }
      bodyLines.push({ text: next, lineNumber: j + 1 });
    }
    out.push({ kind, headerLine: raw, headerLineNumber: i + 1, bodyLines });
  }
  return out;
}

function identifyHeader(line: string, lineNumber: number): Block["kind"] {
  if (line.startsWith("[gd_scene")) {
    return "scene-header";
  }
  if (line.startsWith("[gd_resource")) {
    return "resource-header";
  }
  if (line.startsWith("[ext_resource")) {
    return "ext-resource";
  }
  if (line.startsWith("[sub_resource")) {
    return "sub-resource";
  }
  if (line.startsWith("[node")) {
    return "node";
  }
  if (line.startsWith("[resource")) {
    return "resource";
  }
  throw new ParseError(`unknown block header "${line}"`, lineNumber);
}

function parseExtResource(block: Block): GodotExtResource {
  const attrs = parseHeaderAttributes(block);
  const type = mustString(attrs, "type", block.headerLineNumber);
  const path = mustString(attrs, "path", block.headerLineNumber);
  const id = mustString(attrs, "id", block.headerLineNumber);
  return { id, type, path };
}

function parseSubResource(block: Block): GodotSubResource {
  const attrs = parseHeaderAttributes(block);
  const type = mustString(attrs, "type", block.headerLineNumber);
  const id = mustString(attrs, "id", block.headerLineNumber);
  const properties = block.bodyLines.map((bl) => parseProperty(bl.text, bl.lineNumber));
  return { id, type, properties };
}

type NodeBlock = {
  readonly name: string;
  readonly type: string;
  readonly parent?: string;
  readonly properties: readonly GodotProperty[];
};

function parseNode(block: Block): NodeBlock {
  const attrs = parseHeaderAttributes(block);
  const name = mustString(attrs, "name", block.headerLineNumber);
  const type = mustString(attrs, "type", block.headerLineNumber);
  const parent = attrs.get("parent");
  const properties = block.bodyLines.map((bl) => parseProperty(bl.text, bl.lineNumber));
  return { name, type, parent, properties };
}

function buildNodeTree(blocks: readonly Block[]): GodotNode {
  const parsed = blocks.map(parseNode);
  const root = parsed[0]!;
  if (root.parent !== undefined) {
    throw new ParseError("first [node] block must be the root (no parent)", blocks[0]!.headerLineNumber);
  }
  // Build a map keyed by the path used in `parent="..."` attributes.
  // Direct children of the root use `"."`, deeper descendants use the
  // slash-separated path of their ancestors *under* the root.
  const childrenByPath = new Map<string, GodotNode[]>();
  childrenByPath.set(".", []);
  for (let i = 1; i < parsed.length; i += 1) {
    const entry = parsed[i]!;
    if (entry.parent === undefined) {
      throw new ParseError(`non-root [node] without parent attribute`, blocks[i]!.headerLineNumber);
    }
    const childList = childrenByPath.get(entry.parent);
    if (!childList) {
      throw new ParseError(`[node parent="${entry.parent}"] has no parent in the tree`, blocks[i]!.headerLineNumber);
    }
    const child: GodotNode = {
      name: entry.name,
      type: entry.type,
      properties: entry.properties,
      children: [],
    };
    childList.push(child);
    const childPath = entry.parent === "." ? entry.name : `${entry.parent}/${entry.name}`;
    childrenByPath.set(childPath, child.children as GodotNode[]);
  }
  return {
    name: root.name,
    type: root.type,
    properties: root.properties,
    children: childrenByPath.get(".")!,
  };
}

/** Parse `[type attr1="..." attr2="..." ...]` into a name → string-value map. */
function parseHeaderAttributes(block: Block): ReadonlyMap<string, string> {
  const headerInner = block.headerLine.replace(/^\[/, "").replace(/\]$/, "").trim();
  // Skip the leading `gd_scene` / `ext_resource` / etc. token.
  const firstSpace = headerInner.indexOf(" ");
  const attrSpan = firstSpace === -1 ? "" : headerInner.slice(firstSpace + 1);
  const attrs = new Map<string, string>();
  // Match `name="value"` and `name=value` (unquoted values used by load_steps/format).
  const re = /(\w+)\s*=\s*("((?:\\.|[^"\\])*)"|[^\s]+)/gu;
  for (const match of attrSpan.matchAll(re)) {
    const key = match[1]!;
    const rawValue = match[2]!;
    const unquoted = rawValue.startsWith('"') ? unquoteString(rawValue, block.headerLineNumber) : rawValue;
    attrs.set(key, unquoted);
  }
  return attrs;
}

function mustString(attrs: ReadonlyMap<string, string>, key: string, lineNumber: number): string {
  const value = attrs.get(key);
  if (value === undefined) {
    throw new ParseError(`missing attribute "${key}"`, lineNumber);
  }
  return value;
}

function parseProperty(line: string, lineNumber: number): GodotProperty {
  const eq = line.indexOf("=");
  if (eq === -1) {
    throw new ParseError(`property line missing "=": "${line}"`, lineNumber);
  }
  const name = line.slice(0, eq).trim();
  const valueText = line.slice(eq + 1).trim();
  return { name, value: parseValue(valueText, lineNumber) };
}

function parseValue(text: string, lineNumber: number): GodotValue {
  if (text === "true") {
    return { kind: "bool", value: true };
  }
  if (text === "false") {
    return { kind: "bool", value: false };
  }
  if (text.startsWith('"')) {
    return { kind: "string", value: unquoteString(text, lineNumber) };
  }
  const constructor = parseConstructor(text);
  if (constructor) {
    return constructorToValue(constructor.name, constructor.args, lineNumber);
  }
  if (/^-?\d+$/.test(text)) {
    return { kind: "int", value: parseInt(text, 10) };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return { kind: "float", value: parseFloat(text) };
  }
  // Polygon2D's `polygons` is `[PackedInt32Array(...), ...]` — a raw
  // expression for which we don't have a typed kind. Round-trip it as
  // `raw`. Same with any other untyped bracketed payload Godot might
  // emit (PackedColorArray inside arrays, etc.).
  if (text.startsWith("[")) {
    return { kind: "raw", text };
  }
  // Image sub-resources serialise their `data` field as an inline
  // dict: `{"data": PackedByteArray(...), "format": "RGBA8", …}`.
  // Godot's `.tscn` accepts either single-line or multi-line; we emit
  // single-line so the line-based property parser can recover it as
  // a single raw value without state-tracking nested braces.
  if (text.startsWith("{")) {
    return { kind: "raw", text };
  }
  throw new ParseError(`cannot parse value "${text}"`, lineNumber);
}

function parseConstructor(text: string): { readonly name: string; readonly args: readonly string[] } | undefined {
  const match = /^(\w+)\((.*)\)$/u.exec(text);
  if (!match) {
    return undefined;
  }
  const name = match[1]!;
  const inner = match[2]!.trim();
  if (inner === "") {
    return { name, args: [] };
  }
  return { name, args: splitTopLevelCommas(inner) };
}

type SplitState = {
  readonly out: readonly string[];
  readonly buf: string;
  readonly depth: number;
  readonly inString: boolean;
  /** Set when the previous char was `\` inside a string — the next char is escaped verbatim. */
  readonly escapeNext: boolean;
};

const INITIAL_SPLIT_STATE: SplitState = {
  out: [],
  buf: "",
  depth: 0,
  inString: false,
  escapeNext: false,
};

function stepSplit(state: SplitState, ch: string): SplitState {
  if (state.escapeNext) {
    return { ...state, buf: state.buf + ch, escapeNext: false };
  }
  if (state.inString) {
    if (ch === "\\") {
      return { ...state, buf: state.buf + ch, escapeNext: true };
    }
    if (ch === '"') {
      return { ...state, buf: state.buf + ch, inString: false };
    }
    return { ...state, buf: state.buf + ch };
  }
  if (ch === '"') {
    return { ...state, buf: state.buf + ch, inString: true };
  }
  if (ch === "(") {
    return { ...state, buf: state.buf + ch, depth: state.depth + 1 };
  }
  if (ch === ")") {
    return { ...state, buf: state.buf + ch, depth: state.depth - 1 };
  }
  if (ch === "," && state.depth === 0) {
    return { ...state, out: [...state.out, state.buf.trim()], buf: "" };
  }
  return { ...state, buf: state.buf + ch };
}

function splitTopLevelCommas(text: string): readonly string[] {
  const finalState = Array.from(text).reduce(stepSplit, INITIAL_SPLIT_STATE);
  if (finalState.buf.length === 0) {
    return finalState.out;
  }
  return [...finalState.out, finalState.buf.trim()];
}

function constructorToValue(
  name: string,
  args: readonly string[],
  lineNumber: number,
): GodotValue {
  switch (name) {
    case "Vector2":
      mustArity(name, args, 2, lineNumber);
      return { kind: "vector2", x: parseFloatArg(args[0]!, lineNumber), y: parseFloatArg(args[1]!, lineNumber) };
    case "Rect2":
      mustArity(name, args, 4, lineNumber);
      return {
        kind: "rect2",
        x: parseFloatArg(args[0]!, lineNumber),
        y: parseFloatArg(args[1]!, lineNumber),
        w: parseFloatArg(args[2]!, lineNumber),
        h: parseFloatArg(args[3]!, lineNumber),
      };
    case "Color":
      mustArity(name, args, 4, lineNumber);
      return {
        kind: "color",
        r: parseFloatArg(args[0]!, lineNumber),
        g: parseFloatArg(args[1]!, lineNumber),
        b: parseFloatArg(args[2]!, lineNumber),
        a: parseFloatArg(args[3]!, lineNumber),
      };
    case "NodePath":
      mustArity(name, args, 1, lineNumber);
      return { kind: "node-path", path: unquoteString(args[0]!, lineNumber) };
    case "ExtResource":
      mustArity(name, args, 1, lineNumber);
      return { kind: "ext-resource", id: unquoteString(args[0]!, lineNumber) };
    case "SubResource":
      mustArity(name, args, 1, lineNumber);
      return { kind: "sub-resource", id: unquoteString(args[0]!, lineNumber) };
    case "PackedFloat32Array":
    case "PackedColorArray":
    case "PackedVector2Array":
    case "PackedInt32Array":
    case "PackedByteArray":
      // Packed arrays are emitted as `kind: "raw"` by the gradient
      // routines (variable-arity, per-channel layout). Round-trip them
      // by reconstructing the original raw text — equivalence with
      // the emit's typed-IR `raw` value passes the structural test.
      return { kind: "raw", text: `${name}(${args.join(", ")})` };
    default:
      throw new ParseError(`unsupported constructor "${name}"`, lineNumber);
  }
}

function mustArity(name: string, args: readonly string[], expected: number, lineNumber: number): void {
  if (args.length !== expected) {
    throw new ParseError(`${name} expects ${expected} args, got ${args.length}`, lineNumber);
  }
}

function parseFloatArg(text: string, lineNumber: number): number {
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new ParseError(`expected numeric arg, got "${text}"`, lineNumber);
  }
  return parseFloat(text);
}

function unquoteString(text: string, lineNumber: number): string {
  if (!text.startsWith('"') || !text.endsWith('"')) {
    throw new ParseError(`expected quoted string, got "${text}"`, lineNumber);
  }
  const inner = text.slice(1, -1);
  const out: string[] = [];
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (ch !== "\\") {
      out.push(ch);
      continue;
    }
    const next = inner[i + 1];
    if (next === undefined) {
      throw new ParseError("trailing backslash in string literal", lineNumber);
    }
    if (next === "u" && inner[i + 2] === "{") {
      const close = inner.indexOf("}", i + 3);
      if (close === -1) {
        throw new ParseError("unterminated \\u{...} escape", lineNumber);
      }
      const hex = inner.slice(i + 3, close);
      out.push(String.fromCodePoint(parseInt(hex, 16)));
      i = close;
      continue;
    }
    switch (next) {
      case "\\":
        out.push("\\");
        break;
      case '"':
        out.push('"');
        break;
      case "n":
        out.push("\n");
        break;
      case "r":
        out.push("\r");
        break;
      case "t":
        out.push("\t");
        break;
      case "0":
        out.push("\0");
        break;
      default:
        throw new ParseError(`unknown escape "\\${next}"`, lineNumber);
    }
    i += 1;
  }
  return out.join("");
}

export { ParseError };
