/**
 * @file Builder helpers for the Godot scene-tree IR.
 *
 * Each helper returns a frozen value-typed node so callers compose by
 * passing references rather than mutating shared state. Properties are
 * appended through `withProperty` (single) and `withProperties` (batch);
 * the originals are never mutated.
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

/** Build a Godot int literal value. */
export function intVal(value: number): GodotValue {
  if (!Number.isInteger(value)) {
    throw new Error(`fig-to-godot: intVal requires an integer (got ${String(value)})`);
  }
  return { kind: "int", value };
}

/** Build a Godot float literal value. */
export function floatVal(value: number): GodotValue {
  return { kind: "float", value };
}

/** Build a Godot bool literal value. */
export function boolVal(value: boolean): GodotValue {
  return { kind: "bool", value };
}

/** Build a Godot string literal value. Escaping is handled at serialize time. */
export function stringVal(value: string): GodotValue {
  return { kind: "string", value };
}

/** Build a `Vector2(x, y)` value. */
export function vector2(x: number, y: number): GodotValue {
  return { kind: "vector2", x, y };
}

/** Build a `Rect2(x, y, w, h)` value. */
export function rect2(x: number, y: number, w: number, h: number): GodotValue {
  return { kind: "rect2", x, y, w, h };
}

/**
 * Build a `Color(r, g, b, a)` value. Components are 0..1 floats —
 * Godot's native `Color` constructor expects exactly that range, the
 * same shape Figma's `FigColor` carries, so no conversion is needed.
 */
export function colorVal(r: number, g: number, b: number, a: number = 1): GodotValue {
  return { kind: "color", r, g, b, a };
}

/** Build a `NodePath("...")` value. */
export function nodePath(path: string): GodotValue {
  return { kind: "node-path", path };
}

/** Build an `ExtResource("id")` reference value. */
export function extResourceRef(id: string): GodotValue {
  return { kind: "ext-resource", id };
}

/** Build a `SubResource("id")` reference value. */
export function subResourceRef(id: string): GodotValue {
  return { kind: "sub-resource", id };
}

/**
 * Build a Godot enum integer value carrying its symbolic name. The
 * serializer prints only the integer; the name surfaces in tests and
 * diagnostics so a "BoxContainer.alignment = 2" comparison shows
 * `END` rather than a bare 2.
 */
export function enumVal(value: number, name: string): GodotValue {
  if (!Number.isInteger(value)) {
    throw new Error(`fig-to-godot: enumVal requires an integer (got ${String(value)})`);
  }
  return { kind: "enum", value, name };
}

/** Build a `key = value` property pair. */
export function property(name: string, value: GodotValue): GodotProperty {
  return { name, value };
}

/** Build a node block. */
export function node(
  name: string,
  type: string,
  options: {
    readonly properties?: readonly GodotProperty[];
    readonly children?: readonly GodotNode[];
  } = {},
): GodotNode {
  return {
    name,
    type,
    properties: options.properties ?? [],
    children: options.children ?? [],
  };
}

/** Build a sub-resource block. */
export function subResource(
  id: string,
  type: string,
  properties: readonly GodotProperty[] = [],
): GodotSubResource {
  return { id, type, properties };
}

/** Build an ext-resource reference declaration. */
export function extResource(id: string, type: string, path: string): GodotExtResource {
  return { id, type, path };
}

/** Build a complete Godot scene. */
export function scene(
  root: GodotNode,
  options: {
    readonly extResources?: readonly GodotExtResource[];
    readonly subResources?: readonly GodotSubResource[];
  } = {},
): GodotScene {
  return {
    extResources: options.extResources ?? [],
    subResources: options.subResources ?? [],
    root,
  };
}

/** Build a complete Godot `.tres` resource document. */
export function resource(
  type: string,
  options: {
    readonly properties?: readonly GodotProperty[];
    readonly extResources?: readonly GodotExtResource[];
    readonly subResources?: readonly GodotSubResource[];
  } = {},
): GodotResource {
  return {
    type,
    extResources: options.extResources ?? [],
    subResources: options.subResources ?? [],
    properties: options.properties ?? [],
  };
}

/** Append one property to an existing node, returning a new node. */
export function withProperty(target: GodotNode, prop: GodotProperty): GodotNode {
  return { ...target, properties: [...target.properties, prop] };
}

/** Append a batch of properties to an existing node, returning a new node. */
export function withProperties(target: GodotNode, props: readonly GodotProperty[]): GodotNode {
  if (props.length === 0) {
    return target;
  }
  return { ...target, properties: [...target.properties, ...props] };
}

/** Append children to an existing node, returning a new node. */
export function withChildren(target: GodotNode, children: readonly GodotNode[]): GodotNode {
  if (children.length === 0) {
    return target;
  }
  return { ...target, children: [...target.children, ...children] };
}
