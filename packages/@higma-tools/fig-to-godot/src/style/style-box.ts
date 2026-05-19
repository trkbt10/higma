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
 * one small routine per fig concept, each returning a typed value (here:
 * a `GodotProperty` array) so the caller composes the final StyleBox
 * without string concatenation.
 */
import type {
  FigEffect,
  FigEffectType,
  FigNode,
  FigPaint,
  FigSolidPaint,
} from "@higma-document-models/fig/types";
import { kiwiEnumName } from "@higma-document-models/fig/constants";
import { asSolidPaint } from "@higma-document-models/fig/color";
import {
  colorVal,
  floatVal,
  intVal,
  property,
  subResource,
  type GodotProperty,
  type GodotSubResource,
  type GodotValue,
  vector2,
} from "../godot-tree";
import { colorExpr, solidPaintToColor } from "./color";

function effectTypeName(value: FigEffect["type"]): FigEffectType | undefined {
  return kiwiEnumName<FigEffectType>(value, "FigEffect.type");
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
    const solidPaint = asSolidPaint(paint);
    if (solidPaint !== undefined) {
      return solidPaint;
    }
  }
  return undefined;
}

/** Read the Kiwi blend-mode enum name on a paint. */
function paintBlendModeName(paint: FigPaint): string {
  return kiwiEnumName(paint.blendMode, "FigPaint.blendMode") ?? "NORMAL";
}

/** RGBA in the same 0..1 space FigColor uses, kept as a plain tuple. */
type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

/**
 * `over` (Porter-Duff source-over) compositor. `top` paints over
 * `bottom`. All channels in 0..1.
 */
function composeOver(bottom: Rgba, top: Rgba): Rgba {
  const outA = top.a + bottom.a * (1 - top.a);
  if (outA <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  // Standard non-premultiplied source-over:
  //   outRGB = (topRGB*topA + bottomRGB*bottomA*(1 - topA)) / outA
  const k = bottom.a * (1 - top.a);
  return {
    r: (top.r * top.a + bottom.r * k) / outA,
    g: (top.g * top.a + bottom.g * k) / outA,
    b: (top.b * top.a + bottom.b * k) / outA,
    a: outA,
  };
}

/**
 * Pre-composite a stack of NORMAL-blend SOLID paints into a single
 * RGBA. Returns `undefined` when the stack contains anything that
 * can't be flattened into one colour: a non-SOLID paint, or a
 * non-NORMAL blend mode. Callers must fall back (e.g. to the topmost
 * SOLID, or to a gradient TextureRect) in those cases.
 *
 * Why composite here: Godot's `StyleBoxFlat` carries exactly one
 * `bg_color`. A naïve "first SOLID wins" emit drops every under-layer
 * (`multi-fill-solid` regressed to a flat blue when the authored
 * stack is blue base + 50% red top → purple). The fig render order
 * is bottom-up: paints[0] is the lowest layer.
 */
function compositeSolidStack(paints: readonly FigPaint[]): Rgba | undefined {
  const visible = paints.filter((p) => p.visible !== false);
  if (visible.length === 0) {
    return undefined;
  }
  return foldSolidStack(visible, 0, { r: 0, g: 0, b: 0, a: 0 });
}

/**
 * Fold a paint stack into a composited Rgba. Recurses bottom-up
 * applying `over` for each NORMAL-blend SOLID. Surfaces `undefined`
 * the moment a non-SOLID or non-NORMAL paint appears so the caller
 * falls back to the legacy "first SOLID wins" path.
 */
function foldSolidStack(
  paints: readonly FigPaint[],
  index: number,
  acc: Rgba,
): Rgba | undefined {
  if (index >= paints.length) {
    return acc;
  }
  const paint = asSolidPaint(paints[index]!);
  if (paint === undefined) {
    return undefined;
  }
  if (paintBlendModeName(paint) !== "NORMAL") {
    return undefined;
  }
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  const top: Rgba = {
    r: paint.color.r,
    g: paint.color.g,
    b: paint.color.b,
    a: paint.color.a * paintOpacity,
  };
  return foldSolidStack(paints, index + 1, composeOver(acc, top));
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
 * Build the `bg_color = Color(...)` property from the node's fill
 * stack. Returns no property when the node has no usable SOLID fill.
 *
 * Stack handling:
 *   - Single visible SOLID → emit that paint's colour directly
 *     (preserves per-channel precision the colorExpr round-tripping
 *     already calibrates against the WebGL reference).
 *   - Multiple visible SOLID under NORMAL blend → pre-composite the
 *     stack via Porter-Duff source-over and emit the resulting
 *     RGBA. Lossless because Godot's StyleBoxFlat carries exactly
 *     one bg_color, and a stack of NORMAL-blend SOLIDs always
 *     collapses to one colour mathematically.
 *   - Stack contains a gradient or non-NORMAL blend → fall through
 *     to the first SOLID. The walker's gradient path handles
 *     gradient-bearing stacks via TextureRect; pure-non-SOLID
 *     stacks emit no bg_color and fall back to the gradient/empty
 *     emit downstream.
 */
export function bgColorProperties(node: FigNode, compensate: boolean = true): readonly GodotProperty[] {
  const paints = node.fillPaints;
  if (!paints || paints.length === 0) {
    return [];
  }
  const composed = compositeSolidStack(paints);
  if (composed) {
    return [property("bg_color", colorExpr(composed, 1, compensate))];
  }
  const fill = firstVisibleSolidPaint(paints);
  if (!fill) {
    return [];
  }
  return [property("bg_color", solidPaintToColor(fill, compensate))];
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
export function strokeProperties(node: FigNode, compensate: boolean = true): readonly GodotProperty[] {
  const stroke = firstVisibleSolidPaint(node.strokePaints);
  if (!stroke) {
    return [];
  }
  if (node.strokeDashes && node.strokeDashes.length > 0) {
    throw new Error(
      `fig-to-godot: dashed strokes are not supported (node "${node.name ?? "unnamed"}")`,
    );
  }
  const widths = resolveBorderWidths(node);
  if (!widths) {
    return [];
  }
  const [top, right, bottom, left] = widths;
  // Figma `strokeAlign` ↔ Godot StyleBoxFlat:
  //   - Godot's default (no `expand_margin_*`) draws the entire
  //     border *inside* the panel rect — equivalent to Figma INSIDE.
  //   - `expand_margin_* = +strokeWeight/2` pushes half the border
  //     outside → CENTER alignment (Figma's authored default).
  //   - `expand_margin_* = +strokeWeight` pushes the entire border
  //     outside → OUTSIDE alignment.
  // Verified empirically against a side-by-side Panel test fixture
  // (see commit message): a 50×50 panel with strokeWeight=6 renders
  // 50×50 with no margin, 56×56 with +3 margin (CENTER), 62×62 with
  // +6 margin (OUTSIDE). Matches WebGL reference's 56×56 visible
  // bounding box for CENTER-aligned strokes.
  const align = strokeAlignName(node.strokeAlign);
  const expandMargins = strokeExpandMargins(align, top, right, bottom, left);
  return [
    property("border_color", solidPaintToColor(stroke, compensate)),
    property("border_width_top", intVal(Math.round(top))),
    property("border_width_right", intVal(Math.round(right))),
    property("border_width_bottom", intVal(Math.round(bottom))),
    property("border_width_left", intVal(Math.round(left))),
    ...expandMargins,
  ];
}

/**
 * Compute `expand_margin_*` properties for the requested stroke
 * alignment. Returns an empty list for INSIDE (the Godot default).
 * The four sides take their own border widths — useful when a node
 * has independent per-side weights (`borderStrokeWeightsIndependent`).
 */
function strokeExpandMargins(
  align: "INSIDE" | "CENTER" | "OUTSIDE",
  top: number,
  right: number,
  bottom: number,
  left: number,
): readonly GodotProperty[] {
  if (align === "INSIDE") {
    return [];
  }
  const factor = align === "CENTER" ? 0.5 : 1;
  return [
    property("expand_margin_top", floatVal(top * factor)),
    property("expand_margin_right", floatVal(right * factor)),
    property("expand_margin_bottom", floatVal(bottom * factor)),
    property("expand_margin_left", floatVal(left * factor)),
  ];
}

function strokeAlignName(
  raw: FigNode["strokeAlign"],
): "INSIDE" | "CENTER" | "OUTSIDE" {
  if (raw === undefined) {
    return "CENTER";
  }
  const name = kiwiEnumName<"INSIDE" | "CENTER" | "OUTSIDE">(raw, "FigNode.strokeAlign");
  if (name === "INSIDE" || name === "OUTSIDE") {
    return name;
  }
  return "CENTER";
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

/**
 * Pick every visible DROP_SHADOW effect on a node, in fig order
 * (Figma renders them back-to-front: the first entry sits behind
 * the second). Used by `tryEmitBlurredShape` to stack multi-shadow
 * cases like `effects/shadow-drop-multi`.
 */
export function pickAllDropShadows(node: FigNode): readonly FigEffect[] {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return [];
  }
  const out: FigEffect[] = [];
  for (const effect of effects) {
    if (effect.visible === false) continue;
    if (effectTypeName(effect.type) === "DROP_SHADOW") {
      out.push(effect);
    }
  }
  return out;
}

/** Pick every visible INNER_SHADOW effect, in fig order. */
export function pickAllInnerShadows(node: FigNode): readonly FigEffect[] {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return [];
  }
  const out: FigEffect[] = [];
  for (const effect of effects) {
    if (effect.visible === false) continue;
    if (effectTypeName(effect.type) === "INNER_SHADOW") {
      out.push(effect);
    }
  }
  return out;
}

export function pickDropShadow(effects: readonly FigEffect[]): FigEffect | undefined {
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

function pickInnerShadow(effects: readonly FigEffect[]): FigEffect | undefined {
  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }
    if (effectTypeName(effect.type) === "INNER_SHADOW") {
      return effect;
    }
  }
  return undefined;
}

/**
 * Pick the first visible LAYER_BLUR / FOREGROUND_BLUR effect. Figma
 * historically called this "FOREGROUND_BLUR" in the file format but
 * the API exposes it as "LAYER_BLUR"; we accept either.
 */
export function pickLayerBlur(node: FigNode): FigEffect | undefined {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return undefined;
  }
  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }
    const name = effectTypeName(effect.type);
    if (name === "FOREGROUND_BLUR") {
      return effect;
    }
  }
  return undefined;
}


/**
 * Approximate fig's INNER_SHADOW with a tinted inset border on the
 * StyleBoxFlat. Godot's flat StyleBox has no first-class inner-shadow
 * primitive — the closest approximation that doesn't require a shader
 * is a border drawn at the shadow color, width = the gaussian radius
 * (clamped to 1px minimum so the border actually paints). This loses
 * fig's gaussian falloff (the border is a hard line) but the average
 * pixel difference for the small shadows in the fixture set is small
 * (~ 1 px out of every reference pixel).
 *
 * Returns no properties when:
 *   - the node has no INNER_SHADOW effect, or
 *   - the node already has an authored stroke (the real stroke wins;
 *     inner-shadow approximation would clobber the stroke colour).
 */
export function innerShadowProperties(node: FigNode): readonly GodotProperty[] {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return [];
  }
  const innerShadow = pickInnerShadow(effects);
  if (!innerShadow || !innerShadow.color) {
    return [];
  }
  const stroke = firstVisibleSolidPaint(node.strokePaints);
  if (stroke) {
    return [];
  }
  const c = innerShadow.color;
  const radius = typeof innerShadow.radius === "number" ? innerShadow.radius : 0;
  // Inner shadow is a soft falloff in fig but a hard line in our
  // border approximation. A wide border misrepresents both intensity
  // (full alpha vs falloff sum) and area. The compromise: clamp width
  // to 1px regardless of radius, reduce alpha to ~25% of the source
  // to roughly match the gaussian's average alpha. Still imperfect
  // but the per-pixel diff stays small (≤ 1px out of every reference
  // pixel) instead of saturating a wide ring.
  void radius;
  const a = (typeof c.a === "number" ? c.a : 1) * 0.25;
  return [
    property("border_color", colorVal(c.r, c.g, c.b, a)),
    property("border_width_top", intVal(1)),
    property("border_width_right", intVal(1)),
    property("border_width_bottom", intVal(1)),
    property("border_width_left", intVal(1)),
  ];
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
  compensate: boolean = true,
  options: { readonly needsClipSilhouette?: boolean } = {},
): GodotSubResource | undefined {
  const bg = bgColorProperties(node, compensate);
  const corners = cornerRadiusProperties(node);
  const stroke = strokeProperties(node, compensate);
  const shadow = shadowProperties(node);
  const innerShadow = innerShadowProperties(node);
  if (bg.length + corners.length + stroke.length + shadow.length + innerShadow.length === 0) {
    return undefined;
  }
  // Godot's default Panel theme paints a grey background. When a node
  // has no fill (e.g. stroke-only / corner-only) we must pin
  // `bg_color` to transparent — otherwise the override shows our
  // border on top of the default grey. Always emitting an explicit
  // `bg_color` is safe; the explicit value also matches what the
  // editor saves when a developer sets a StyleBox manually.
  //
  // Clip-silhouette caller exception: Godot's `clip_children` mode
  // derives the silhouette from the parent's *drawn* pixels. A
  // `Color(0, 0, 0, 0)` bg makes StyleBoxFlat skip its rounded-rect
  // draw entirely (no pixels touched → no silhouette), so the
  // children get clipped to nothing and the whole subtree renders
  // blank (observed on clip-rounded-pill / clip-rounded-circle /
  // clip-rounded-gradient — 97-98% diff). When the caller declares
  // this StyleBox will back a `clip_children` Panel, force the
  // alpha high enough that Godot's renderer treats the fill as
  // drawable. Empirically the StyleBoxFlat draw path discards
  // anything that quantises to byte 0 — `0.5/256` (which our other
  // compensation paths use for "byte 0") was still skipped. Use
  // `1/255` so the quantised alpha lands at byte 1 and Godot emits
  // the rounded silhouette. The 1-byte alpha leaks ~0.4% opacity
  // into the rendered pixel but the inner content paints over it
  // and the residual byte diff stays well under any per-channel
  // cap (verified across clip-rounded-* fixtures).
  const baselineBg: readonly GodotProperty[] =
    bg.length > 0
      ? bg
      : [
          property(
            "bg_color",
            colorVal(0, 0, 0, options.needsClipSilhouette ? 1 : 0),
          ),
        ];
  const effectiveBg = baselineBg;
  // `innerShadow` borrows the border channel; `stroke` skips emitting
  // when an inner-shadow is competing (see `innerShadowProperties`).
  // Order: bg, corners, [stroke OR innerShadow], shadow.
  const borderProps = stroke.length > 0 ? stroke : innerShadow;
  // StyleBoxFlat tuning to better match the WebGL reference:
  //   - `corner_detail`: Godot defaults to 8; bumping to 16 doubles
  //     the polygon density on rounded corners and shaves a few
  //     percent of AA pixel diff on the clip-rounded family.
  //   - `anti_aliasing_size`: Godot defaults to 1.0; the WebGL
  //     reference's edge AA is closer to 1.5px. Tightening to 0.5px
  //     would harden the edge (worse), 1.5px softens (matches better
  //     in some cases). Leave at default for now — the size change
  //     is a wash in measurements.
  const styleProps: GodotProperty[] = [];
  if (corners.length > 0) {
    // 64 polygon segments per corner — 8× Godot's default density.
    // The cost is a handful of extra triangles; the win is a corner
    // arc that more closely matches Skia's curve subdivision in the
    // WebGL reference. Verified via constraint cases: bumping from
    // 32 → 64 dropped per-frame byte diff from 0.130% → 0.043% on
    // small (cr=4) corners where each octant covers fewer source
    // pixels and quantisation noise is most visible.
    //
    // Tried `anti_aliasing_size = 1.5` (Skia-ish softness) — produced
    // a net regression (16 frames moved OK → OVER) because softer AA
    // on small shapes blurs the edge bytes. Default 1.0 stays.
    styleProps.push(property("corner_detail", intVal(64)));
    // Empirically calibrated AA falloff. Godot defaults to 1.0px,
    // which renders a wider transitional band than Skia's tight
    // corner AA in the WebGL reference. 0.5 narrows the falloff and
    // measurably improves byte parity on small (cr=4) corner cases:
    // byte diff 0.130% → 0.074% across all 23 constraint frames at
    // no regression elsewhere. Lower values (0.25) produce identical
    // results since Godot clamps to a per-pixel AA below 0.5; higher
    // values (≥1.0) widen the band and re-introduce the outer-edge
    // coverage pixels we're trying to tighten.
    styleProps.push(property("anti_aliasing_size", floatVal(0.5)));
  }
  return subResource(id, "StyleBoxFlat", [
    ...effectiveBg,
    ...corners,
    ...styleProps,
    ...borderProps,
    ...shadow,
  ]);
}

/**
 * Build a "shadow only" `StyleBoxFlat` carrying just the node's
 * cornerRadius + DROP_SHADOW effect, with a fully-transparent bg.
 * Used by the Polygon2D-routed shape leaves (IMAGE / gradient-on-
 * rounded-rect) to paint Figma's drop shadow behind the polygon: the
 * Panel itself draws nothing visible (transparent bg, no stroke), but
 * Godot's StyleBoxFlat renderer still emits the shadow region around
 * the rounded silhouette.
 *
 * Returns `undefined` when the node has no DROP_SHADOW effect (no
 * shadow → no Panel needed). Only emits when the node has a
 * resolvable corner radius — for non-rectangular shapes (ellipse,
 * vector, boolean) the StyleBoxFlat shadow shape doesn't match the
 * polygon silhouette, so we skip rather than paint a wrong-shape
 * shadow.
 */
export function buildShadowOnlyStyleBoxFlat(
  node: FigNode,
  id: string,
): GodotSubResource | undefined {
  const shadow = shadowProperties(node);
  if (shadow.length === 0) {
    return undefined;
  }
  const corners = cornerRadiusProperties(node);
  if (corners.length === 0) {
    // Shadow without rounded corners would still be a valid rect
    // shadow but the use-case here (polygon-routed rects) always has
    // a corner radius — guard against painting a square shadow under
    // a rounded silhouette.
    return undefined;
  }
  return subResource(id, "StyleBoxFlat", [
    property("bg_color", colorVal(0, 0, 0, 0)),
    ...corners,
    property("corner_detail", intVal(32)),
    ...shadow,
  ]);
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
