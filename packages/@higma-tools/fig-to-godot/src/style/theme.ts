/**
 * @file Build per-node Theme overrides for the Godot scene tree.
 *
 * Godot has two ways to apply visual styling:
 *
 *   1. **Theme resource** (`.tres`) — a shared bundle of fonts,
 *      StyleBoxes, colors, constants. Applied to a Control's `theme`
 *      property; cascades down the tree like CSS. Best for project- /
 *      canvas-wide defaults.
 *
 *   2. **Node-local theme overrides** — special properties named
 *      `theme_override_styles/<key>`,
 *      `theme_override_colors/<key>`,
 *      `theme_override_constants/<key>`,
 *      `theme_override_font_sizes/<key>`,
 *      `theme_override_fonts/<key>`. Applied directly to a single Control,
 *      override anything inherited from a Theme resource.
 *
 * Figma's authoring model has no "shared theme" concept — every visual
 * property is authored on the node. The v0 emitter therefore expresses
 * styling exclusively as node-local theme overrides; the shared
 * project-wide Theme resource is a future extension. This keeps each
 * `.tscn` self-contained and avoids a name-resolution layer the v0
 * does not need.
 *
 * Each helper here returns the small number of `theme_override_*`
 * properties that realise one fig styling concept on one Godot Control:
 *
 *   - `panelStyleOverride(node, subResId)` — `theme_override_styles/panel`
 *     pointing at the StyleBoxFlat sub-resource id.
 *   - `labelStyleOverrides(node)` — Label colour + font size overrides.
 *
 * The walker assembles the StyleBoxFlat sub-resources via
 * `style/style-box.ts` and then attaches the override property here.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import {
  property,
  subResourceRef,
  type GodotProperty,
} from "../godot-tree";
import { fontColorValue, fontSizeValue } from "./style-box";

/**
 * `theme_override_styles/panel = SubResource("StyleBoxFlat_xxx")` —
 * applied to `Panel` (and `PanelContainer`) nodes that carry the
 * StyleBoxFlat representing a Figma fill / corner / stroke / shadow
 * bundle.
 *
 * Returned as an array (zero or one entry) so the walker can spread
 * unconditionally without conditional logic at every call site.
 */
export function panelStyleOverride(subResourceId: string): readonly GodotProperty[] {
  return [property("theme_override_styles/panel", subResourceRef(subResourceId))];
}

/**
 * Build the `theme_override_colors/font_color` +
 * `theme_override_font_sizes/font_size` properties for a Label, in the
 * order Godot's editor saves them. Either or both may be omitted when
 * the source node carries no fill / no font size.
 */
export function labelStyleOverrides(node: FigNode): readonly GodotProperty[] {
  const out: GodotProperty[] = [];
  const color = fontColorValue(node);
  if (color) {
    out.push(property("theme_override_colors/font_color", color));
  }
  const size = fontSizeValue(node);
  if (size) {
    out.push(property("theme_override_font_sizes/font_size", size));
  }
  return out;
}

/**
 * Build the `theme_override_constants/separation = N` property for a
 * BoxContainer that carries authored `stackSpacing`. Returns an empty
 * array when no spacing is authored — matching the SwiftUI peer's
 * "omit `spacing:` argument when undefined" rule.
 *
 * Godot stores the constant as int; we round to the nearest pixel.
 */
export function separationOverride(spacing: number | undefined): readonly GodotProperty[] {
  if (spacing === undefined) {
    return [];
  }
  return [
    property("theme_override_constants/separation", {
      kind: "int",
      value: Math.round(spacing),
    }),
  ];
}

/**
 * Build the four MarginContainer `theme_override_constants/margin_*`
 * properties. The walker emits these on a wrapping `MarginContainer`
 * because BoxContainer has no padding property of its own.
 */
export function marginOverrides(padding: {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}): readonly GodotProperty[] {
  return [
    property("theme_override_constants/margin_left", { kind: "int", value: Math.round(padding.left) }),
    property("theme_override_constants/margin_top", { kind: "int", value: Math.round(padding.top) }),
    property("theme_override_constants/margin_right", { kind: "int", value: Math.round(padding.right) }),
    property("theme_override_constants/margin_bottom", { kind: "int", value: Math.round(padding.bottom) }),
  ];
}
