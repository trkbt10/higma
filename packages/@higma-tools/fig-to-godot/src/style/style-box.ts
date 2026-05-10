/**
 * @file Build a Godot `StyleBoxFlat` sub-resource from FigNode style fields.
 *
 * A Figma FRAME / RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE-via-radius
 * node carries a small set of paint fields that all collapse to a
 * single Godot `StyleBoxFlat`:
 *
 *   - First visible SOLID fill   → `bg_color`
 *   - cornerRadius / corner-* fields → `corner_radius_top_left/...`
 *   - First visible SOLID stroke (uniform weight) → `border_color` + `border_width_*`
 *   - First visible DROP_SHADOW effect → `shadow_color`, `shadow_size`, `shadow_offset`
 *
 * The function returns `undefined` when no styling field is present so
 * the walker can skip emitting a sub-resource and a
 * `theme_override_styles/panel` property entirely. Returning an empty
 * StyleBox would still allocate a sub-resource id and clutter the
 * `.tscn`, so the empty case is a hard no-op.
 *
 * Mirrors the modifier-builder factoring from `fig-to-swiftui/src/style/modifiers.ts`:
 * one small helper per fig concept, each returning a typed value (here:
 * a `GodotProperty` array) so the caller composes the final StyleBox
 * without string concatenation.
 */
import type {
  FigEffect,
  FigEffectType,
  FigNode,
  FigPaint,
  FigSolidPaint,
  FigStrokeAlign,
  KiwiEnumValue,
} from "@higma-document-models/fig/types";
import {
  colorVal,
  intVal,
  property,
  subResource,
  type GodotProperty,
  type GodotSubResource,
  type GodotValue,
  vector2,
} from "../godot-tree";
import { solidPaintToColor } from "./color";

/**
 * Read a Kiwi enum's `.name`. Effect types appear either as plain
 * strings or as `{ value, name }` structs depending on the parser
 * branch; this helper converges both shapes onto the string channel.
 */
function effectTypeName(value: FigEffectType | KiwiEnumValue<FigEffectType>): FigEffectType | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "name" in value) {
    return value.name;
  }
  return undefined;
}

/**
 * Pick the first SOLID paint in a stack, ignoring invisible paints.
 * Multi-paint and gradient stacks are not yet in scope; the emitter
 * surfaces them by returning undefined here so the caller can decide
 * whether to ignore or surface a Fail-Fast error.
 */
function firstVisibleSolidPaint(paints: readonly FigPaint[] | undefined): FigSolidPaint | undefined {
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "SOLID") {
      return paint;
    }
  }
  return undefined;
}

/**
 * Resolve the per-corner radius array `[topLeft, topRight, bottomRight,
 * bottomLeft]`. Returns `undefined` when the node carries no
 * radius-bearing field at all. A uniform `cornerRadius` expands to
 * four equal entries; per-corner fields override per-side.
 *
 * Godot's `StyleBoxFlat` supports per-corner radii natively, so unlike
 * the SwiftUI peer (which throws on non-uniform), the Godot emitter
 * carries them through.
 */
function resolveCornerRadii(node: FigNode): readonly [number, number, number, number] | undefined {
  const tl = node.rectangleTopLeftCornerRadius;
  const tr = node.rectangleTopRightCornerRadius;
  const br = node.rectangleBottomRightCornerRadius;
  const bl = node.rectangleBottomLeftCornerRadius;
  const hasPerCorner = tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined;
  if (hasPerCorner) {
    const uniform = typeof node.cornerRadius === "number" ? node.cornerRadius : 0;
    return [tl ?? uniform, tr ?? uniform, br ?? uniform, bl ?? uniform];
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius];
  }
  return undefined;
}

/**
 * Build the `bg_color = Color(...)` property from the first visible
 * SOLID fill. Returns no property when the node has no SOLID fill;
 * gradients and image fills are explicitly out of scope and would
 * silently produce a flat colour if folded in here.
 */
export function bgColorProperties(node: FigNode): readonly GodotProperty[] {
  const fill = firstVisibleSolidPaint(node.fillPaints);
  if (!fill) {
    return [];
  }
  return [property("bg_color", solidPaintToColor(fill))];
}

/**
 * Build the four `corner_radius_top_left/...` properties from the
 * resolved per-corner radii. Returns an empty array when no radii are
 * authored.
 */
export function cornerRadiusProperties(node: FigNode): readonly GodotProperty[] {
  const radii = resolveCornerRadii(node);
  if (!radii) {
    return [];
  }
  const [tl, tr, br, bl] = radii;
  // StyleBoxFlat radii are integer pixels in Godot 4.x — they're
  // declared as `int` properties on the resource. Round to nearest int
  // so the .tscn does not carry float values where Godot expects ints.
  return [
    property("corner_radius_top_left", intVal(Math.round(tl))),
    property("corner_radius_top_right", intVal(Math.round(tr))),
    property("corner_radius_bottom_right", intVal(Math.round(br))),
    property("corner_radius_bottom_left", intVal(Math.round(bl))),
  ];
}

/**
 * Build the four `border_width_*` properties + `border_color` from the
 * node's stroke. Honours independent per-side weights when the node
 * carries them; otherwise applies the uniform `strokeWeight.top` as a
 * scalar.
 *
 * Stroke without colour, gradient stroke, dashed stroke, and INSIDE /
 * OUTSIDE alignments are out of scope and surface as Fail-Fast errors.
 */
export function strokeProperties(node: FigNode): readonly GodotProperty[] {
  const stroke = firstVisibleSolidPaint(node.strokePaints);
  if (!stroke) {
    return [];
  }
  if (node.strokeDashes && node.strokeDashes.length > 0) {
    throw new Error(
      `fig-to-godot: dashed strokes are not supported (node "${node.name ?? "unnamed"}")`,
    );
  }
  if (node.strokeAlign && node.strokeAlign !== "CENTER") {
    throw notSupportedStrokeAlign(node, node.strokeAlign);
  }
  const widths = resolveBorderWidths(node);
  if (!widths) {
    return [];
  }
  const [top, right, bottom, left] = widths;
  return [
    property("border_color", solidPaintToColor(stroke)),
    property("border_width_top", intVal(Math.round(top))),
    property("border_width_right", intVal(Math.round(right))),
    property("border_width_bottom", intVal(Math.round(bottom))),
    property("border_width_left", intVal(Math.round(left))),
  ];
}

function notSupportedStrokeAlign(node: FigNode, align: FigStrokeAlign): Error {
  return new Error(
    `fig-to-godot: stroke align "${align}" is not supported (node "${node.name ?? "unnamed"}") — Godot StyleBoxFlat draws borders centred on the edge`,
  );
}

function resolveBorderWidths(
  node: FigNode,
): readonly [number, number, number, number] | undefined {
  if (node.borderStrokeWeightsIndependent === true) {
    const top = node.borderTopWeight ?? 0;
    const right = node.borderRightWeight ?? 0;
    const bottom = node.borderBottomWeight ?? 0;
    const left = node.borderLeftWeight ?? 0;
    if (top === 0 && right === 0 && bottom === 0 && left === 0) {
      return undefined;
    }
    return [top, right, bottom, left];
  }
  const weight = node.strokeWeight;
  if (weight === undefined) {
    return undefined;
  }
  if (typeof weight === "number") {
    if (weight === 0) {
      return undefined;
    }
    return [weight, weight, weight, weight];
  }
  // FigStrokeWeight per-side object form.
  const top = weight.top ?? 0;
  const right = weight.right ?? 0;
  const bottom = weight.bottom ?? 0;
  const left = weight.left ?? 0;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) {
    return undefined;
  }
  return [top, right, bottom, left];
}

/**
 * Build the drop-shadow properties on a StyleBoxFlat. Multi-shadow
 * stacks are out of scope; only the first visible DROP_SHADOW is
 * applied, mirroring the SwiftUI peer.
 *
 * Godot's StyleBoxFlat shadow has three controls:
 *
 *   - `shadow_color : Color`
 *   - `shadow_size  : int` — extends the shadow outline outward by N px
 *   - `shadow_offset: Vector2` — translates the shadow
 *
 * Figma's drop shadow has `radius` (gaussian blur) which has no exact
 * analogue in Godot's flat StyleBox shadow; the closest is `shadow_size`
 * which extends the shadow rectangle outward (no actual blur). We map
 * `radius → shadow_size` and document the visual approximation. A
 * non-zero `spread` is reported as Fail-Fast because Godot's StyleBox
 * has no spread parameter.
 */
export function shadowProperties(node: FigNode): readonly GodotProperty[] {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return [];
  }
  const dropShadow = pickDropShadow(effects);
  if (!dropShadow) {
    return [];
  }
  if (dropShadow.spread !== undefined && dropShadow.spread !== 0) {
    throw new Error(
      `fig-to-godot: drop-shadow spread is not supported by Godot StyleBoxFlat (node "${node.name ?? "unnamed"}" has spread=${dropShadow.spread})`,
    );
  }
  if (!dropShadow.color) {
    throw new Error(
      `fig-to-godot: drop-shadow without color (node "${node.name ?? "unnamed"}")`,
    );
  }
  const c = dropShadow.color;
  const radius = typeof dropShadow.radius === "number" ? dropShadow.radius : 0;
  const offsetX = dropShadow.offset?.x ?? 0;
  const offsetY = dropShadow.offset?.y ?? 0;
  return [
    property("shadow_color", colorVal(c.r, c.g, c.b, c.a)),
    property("shadow_size", intVal(Math.round(radius))),
    property("shadow_offset", vector2(offsetX, offsetY)),
  ];
}

function pickDropShadow(effects: readonly FigEffect[]): FigEffect | undefined {
  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }
    if (effectTypeName(effect.type) === "DROP_SHADOW") {
      return effect;
    }
  }
  return undefined;
}

/**
 * Compose a `StyleBoxFlat` sub-resource for a node, or return
 * `undefined` when none of the contributing fields produce a property.
 *
 * The id is supplied by the caller — this module knows nothing about
 * the surrounding scene's id pool.
 */
export function buildStyleBoxFlat(
  node: FigNode,
  id: string,
): GodotSubResource | undefined {
  const props: GodotProperty[] = [
    ...bgColorProperties(node),
    ...cornerRadiusProperties(node),
    ...strokeProperties(node),
    ...shadowProperties(node),
  ];
  if (props.length === 0) {
    return undefined;
  }
  return subResource(id, "StyleBoxFlat", props);
}

/**
 * Pick the foreground colour for a TEXT node — the first visible SOLID
 * fill maps to Godot's `theme_override_colors/font_color`. Mirrors
 * `foregroundColorModifier` in the SwiftUI peer.
 */
export function fontColorValue(node: FigNode): GodotValue | undefined {
  const fill = firstVisibleSolidPaint(node.fillPaints);
  if (!fill) {
    return undefined;
  }
  return solidPaintToColor(fill);
}

/**
 * Pick the integer font size for a TEXT node. Returns undefined when
 * the node carries no `fontSize`. Godot Label expects an integer pixel
 * font size as `theme_override_font_sizes/font_size`.
 */
export function fontSizeValue(node: FigNode): GodotValue | undefined {
  if (typeof node.fontSize !== "number") {
    return undefined;
  }
  return intVal(Math.round(node.fontSize));
}

/**
 * Pick the node-level opacity. Godot `Control` exposes this as the
 * `modulate` Color's alpha — full RGBA modulate `Color(1, 1, 1, a)`.
 * Mirrors `opacityModifier` in the SwiftUI peer.
 */
export function modulateAlphaProperty(node: FigNode): GodotProperty | undefined {
  if (typeof node.opacity !== "number" || node.opacity === 1) {
    return undefined;
  }
  return property("modulate", colorVal(1, 1, 1, node.opacity));
}

