/**
 * @file Typed Godot scene-tree IR.
 *
 * Every emit step in fig-to-godot produces a `GodotScene` value, never
 * a raw `.tscn` source string. The single serializer in `serialize.ts`
 * eventually prints `.tscn` text, funnelling every Figma-author string
 * (label text, layer names, font family, paths) through Godot's string
 * escaping at the boundary. Mixing typed nodes and raw strings would
 * put each call site back in charge of its own escaping; the typed tree
 * makes that impossible.
 *
 * Godot's `.tscn` format (v3, Godot 4.x) has three kinds of declared
 * elements:
 *
 *   - `[gd_scene load_steps=N format=3]` — file header
 *   - `[ext_resource type="Theme" path="..." id="1_abc"]` — external file refs
 *   - `[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_xyz"]` body
 *   - `[node name="Root" type="Control"]` body
 *
 * Resources reference each other via `ExtResource("1_abc")` /
 * `SubResource("StyleBoxFlat_xyz")` value expressions. Nodes nest via
 * the `parent="."` attribute. The serializer emits in the canonical
 * order: header → ext_resources → sub_resources → root node → child
 * nodes (depth-first).
 *
 * The `.tres` Theme companion uses the same primitives: a `[gd_resource
 * type="Theme" format=3]` header followed by sub-resources and a single
 * `[resource]` body section.
 */

/** A scalar value printable as a `.tscn` value expression. */
export type GodotValue =
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "vector2"; readonly x: number; readonly y: number }
  | { readonly kind: "rect2"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "color"; readonly r: number; readonly g: number; readonly b: number; readonly a: number }
  | { readonly kind: "node-path"; readonly path: string }
  | { readonly kind: "ext-resource"; readonly id: string }
  | { readonly kind: "sub-resource"; readonly id: string }
  /**
   * Godot 4.x enums are stored as integers in `.tscn`. The `name` is
   * carried for readability in tests and diagnostics — the serializer
   * still prints the integer.
   */
  | { readonly kind: "enum"; readonly value: number; readonly name: string }
  /** Inline raw expression — used only by the IR's own builders for nested resource constructors. */
  | { readonly kind: "raw"; readonly text: string };

/** A `key = value` pair inside a node, sub-resource, or [resource] body. */
export type GodotProperty = {
  readonly name: string;
  readonly value: GodotValue;
};

/**
 * A `[sub_resource type="..." id="..."]` block. The `id` must be unique
 * within the scene; the serializer does not deduplicate — callers
 * compose unique ids via the builder routines.
 */
export type GodotSubResource = {
  readonly id: string;
  readonly type: string;
  readonly properties: readonly GodotProperty[];
};

/**
 * A `[ext_resource type="..." path="..." id="..."]` reference. External
 * files (Theme `.tres`, fonts, images) live as ExtResources so a single
 * Theme can be shared across multiple scenes.
 */
export type GodotExtResource = {
  readonly id: string;
  readonly type: string;
  readonly path: string;
};

/**
 * A `[node ...]` block. The root has no parent; children carry
 * `parent = "."` (immediate child of root) or `parent = "Foo/Bar"` for
 * deeper paths. The serializer derives `parent` from the tree shape so
 * builders never write it directly.
 */
export type GodotNode = {
  readonly name: string;
  /** Godot Control class — `Control`, `Container`, `HBoxContainer`, etc. */
  readonly type: string;
  readonly properties: readonly GodotProperty[];
  readonly children: readonly GodotNode[];
};

/** A complete `.tscn` document. */
export type GodotScene = {
  readonly extResources: readonly GodotExtResource[];
  readonly subResources: readonly GodotSubResource[];
  readonly root: GodotNode;
};

/** A complete `.tres` Theme document (single resource body). */
export type GodotResource = {
  readonly type: string;
  readonly extResources: readonly GodotExtResource[];
  readonly subResources: readonly GodotSubResource[];
  /** Properties of the [resource] body itself. */
  readonly properties: readonly GodotProperty[];
};
