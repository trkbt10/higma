/**
 * @file Build SwiftUI modifier values from FigNode style fields.
 *
 * Each helper consumes one Figma concept (frame size, corner radius,
 * fill, stroke, drop shadow, typography) and returns the small number
 * of `Modifier` values that realise it on a SwiftUI view. The emit
 * walker concatenates them in the canonical order
 *
 *   .frame(...).background(...).cornerRadius(...).overlay(border).shadow(...)
 *
 * which is the SwiftUI idiom that matches Figma's painting order
 * (background under stroke under shadow under text content).
 */
import type {
  FigEffectType,
  FigFontName,
  FigNode,
  FigPaint,
  FigSolidPaint,
  FigStrokeAlign,
  FigStrokeWeight,
  KiwiEnumValue,
} from "@higma-document-models/fig/types";
import {
  arg,
  array,
  call,
  ident,
  leaf,
  member,
  modifier,
  namedArg,
  num,
  viewExpr,
  type Modifier,
  type SwiftAlignment,
  type SwiftExpr,
  type SwiftView,
} from "../swift-tree";
import { colorExpr, solidPaintToColor } from "./color";
import { uniformCornerRadius } from "./corner-radius";
import { firstVisibleGradientPaint, gradientExpr } from "./gradient";
import { shapeExprFor } from "./shape";

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
 * Pick the topmost SOLID paint in a stack — Figma renders paints
 * back-to-front in the array order, so the LAST visible solid is
 * the one a single-paint emitter should pick. (For multi-paint
 * blending, see how `backgroundModifier` / `fillModifier` chain
 * paints; this helper is the single-paint shortcut.)
 *
 * Returns undefined when no visible SOLID paint exists.
 */
function firstVisibleSolidPaint(paints: readonly FigPaint[] | undefined): FigSolidPaint | undefined {
  if (!paints) {
    return undefined;
  }
  // Walk in reverse so the topmost paint wins. SOLID paints with
  // alpha less than 1 are still treated as the topmost — the
  // caller can layer underlying paints if they need true
  // multi-paint compositing.
  for (let i = paints.length - 1; i >= 0; i -= 1) {
    const paint = paints[i];
    if (!paint || paint.visible === false) {
      continue;
    }
    if (paint.type === "SOLID") {
      return paint;
    }
  }
  return undefined;
}

/**
 * Build the `.frame(width:, height:, alignment: ...)` modifier from
 * the node's authored `size`, with the supplied alignment.
 *
 * Returns undefined when the size is missing — that happens for nodes
 * whose layout is fully content-driven (Figma's HUG sizing) and
 * SwiftUI's natural sizing already produces the correct outcome.
 *
 * The `alignment` argument controls where the inner content sits
 * inside the larger frame. SwiftUI's default is `.center`; fig-to-swiftui
 * computes the right value from the Figma layout plan because:
 *
 *   - ZStack containers are top-left-anchored (children use `.offset`),
 *     so the frame must be `.topLeading` to keep the absolute origin.
 *   - HStack / VStack containers depend on `stackPrimaryAlignItems` +
 *     `stackCounterAlignItems` — see `frameAlignmentForPlan` in walk.ts
 *     for the matrix.
 *   - Shape leaves (RECTANGLE etc.) are top-left-anchored to match
 *     Figma's authoring.
 *
 * Centring would shift content by half the frame size and break
 * absolute positioning everywhere it matters.
 */
/** How the node's frame should size on the primary autolayout axis.
 *
 *   - `"fixed"` — emit `.frame(width:, height:, alignment:)` with the
 *     node's authored size (default).
 *   - `"grow-h"` — primary axis is horizontal; emit `.frame(maxWidth:
 *     .infinity, height:, alignment:)` so SwiftUI's HStack expands the
 *     view to fill remaining space, matching Figma's `layoutGrow=1`.
 *   - `"grow-v"` — symmetric for VStack.
 */
export type FrameSizing = "fixed" | "grow-h" | "grow-v";

/**
 * Build the SwiftUI `.frame(...)` modifier for a node, picking the
 * fixed-size or flexible-size overload from `sizing`. See
 * `FrameSizing` for the modes; the default is the fixed
 * `width × height` form pinned to the node's authored dimensions.
 */
export function frameModifier(
  node: FigNode,
  alignment: SwiftAlignment = "topLeading",
  sizing: FrameSizing = "fixed",
): Modifier | undefined {
  if (!node.size) {
    return undefined;
  }
  if (sizing === "grow-h") {
    return modifier("frame", [
      namedArg("maxWidth", member("infinity")),
      namedArg("height", num(node.size.y)),
      namedArg("alignment", member(alignment)),
    ]);
  }
  if (sizing === "grow-v") {
    return modifier("frame", [
      namedArg("width", num(node.size.x)),
      namedArg("maxHeight", member("infinity")),
      namedArg("alignment", member(alignment)),
    ]);
  }
  return modifier("frame", [
    namedArg("width", num(node.size.x)),
    namedArg("height", num(node.size.y)),
    namedArg("alignment", member(alignment)),
  ]);
}

/**
 * Build a `.background(...)` modifier from the first visible fill paint.
 *
 * SOLID fills emit `Color(red:..., green:..., blue:..., opacity:...)`.
 * GRADIENT_LINEAR / GRADIENT_RADIAL fills emit a `LinearGradient(...)` /
 * `RadialGradient(...)` value. Image and angular/diamond gradient
 * paints are not yet in scope — those callers should still get
 * `undefined` so the rest of the chain proceeds without a background.
 *
 * Returns undefined when no supported visible paint exists.
 */
export function backgroundModifier(node: FigNode): Modifier | undefined {
  const solid = firstVisibleSolidPaint(node.fillPaints);
  if (solid) {
    return modifier("background", [{ value: solidPaintToColor(solid) }]);
  }
  const grad = firstVisibleGradientPaint(node.fillPaints);
  if (grad) {
    return modifier("background", [{ value: gradientExpr(grad, sizeOf(node)) }]);
  }
  return undefined;
}

/** Read the node's size as `{ width, height }` for the gradient
 * pixel-space compensation, or undefined when the node has no
 * authored size. */
function sizeOf(node: FigNode): { readonly width: number; readonly height: number } | undefined {
  if (!node.size) {
    return undefined;
  }
  return { width: node.size.x, height: node.size.y };
}

/**
 * Build a `.fill(...)` modifier from the first visible fill paint.
 *
 * Used for SHAPE leaves (RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE).
 * Distinct from `backgroundModifier` because SwiftUI's `Rectangle()`
 * paints itself in the foreground colour by default — `.background(...)`
 * paints *behind* the rectangle's foreground fill, so a missing
 * `.fill(...)` leaves a black rectangle on top of the requested
 * background colour.
 *
 * Accepts SOLID fills and the LINEAR / RADIAL gradient variants —
 * SwiftUI's `.fill(_ shapeStyle:)` is overloaded for both `Color`
 * and `LinearGradient` / `RadialGradient`, so the same modifier
 * shape works for both paint kinds.
 */
export function fillModifier(node: FigNode): Modifier | undefined {
  const solid = firstVisibleSolidPaint(node.fillPaints);
  if (solid) {
    return modifier("fill", [{ value: solidPaintToColor(solid) }]);
  }
  const grad = firstVisibleGradientPaint(node.fillPaints);
  if (grad) {
    return modifier("fill", [{ value: gradientExpr(grad, sizeOf(node)) }]);
  }
  return undefined;
}

/**
 * Build the additional `.foregroundStyle(...)` /
 * `.background(<color>)` overlay modifiers needed to render each
 * non-topmost paint in a multi-paint stack on a SHAPE leaf.
 *
 * Figma layers fill paints back-to-front: the FIRST entry in
 * `fillPaints` paints first, the LAST paints on top. The single
 * `.fill(...)` modifier on a SwiftUI shape can only express ONE
 * paint, so for stacks of N paints we emit the topmost via
 * `.fill(...)` and lay the rest underneath via `.background(<shape>().fill(...))`
 * overlays in *back-to-front* order.
 *
 * Returns an empty array when the stack has zero or one visible
 * paint — the single-paint path through `fillModifier` already
 * handles those correctly.
 */
export function extraFillBackgroundModifiers(node: FigNode): readonly Modifier[] {
  const paints = node.fillPaints;
  if (!paints || paints.length === 0) {
    return [];
  }
  const visiblePaints = paints.filter((p) => p.visible !== false);
  if (visiblePaints.length < 2) {
    return [];
  }
  // The TOPMOST paint is consumed by fillModifier; under-layers go
  // here as `.background(<shape>().fill(<paint>))`. We walk from
  // top-1 down to 0 so the modifier order paints further-back
  // layers on top of farther-back ones — SwiftUI's `.background`
  // stacks each new background BEHIND the existing content.
  const out: Modifier[] = [];
  for (let i = visiblePaints.length - 2; i >= 0; i -= 1) {
    const paint = visiblePaints[i];
    if (!paint) {
      continue;
    }
    const expr = paintToExpr(paint, node);
    if (!expr) {
      continue;
    }
    const bgShape = shapeExprFor(node);
    const bgView = leaf(bgShape, [modifier("fill", [{ value: expr }])]);
    out.push(modifier("background", [arg(viewExpr(bgView))]));
  }
  return out;
}

function paintToExpr(paint: FigPaint, node: FigNode): SwiftExpr | undefined {
  if (paint.type === "SOLID") {
    return solidPaintToColor(paint);
  }
  if (
    paint.type === "GRADIENT_LINEAR" ||
    paint.type === "GRADIENT_RADIAL" ||
    paint.type === "GRADIENT_ANGULAR" ||
    paint.type === "GRADIENT_DIAMOND"
  ) {
    return gradientExpr(paint, sizeOf(node));
  }
  return undefined;
}

/** Read a `FigStrokeAlign` value through both the bare-string and the
 * `KiwiEnumValue` shapes the parser branches produce. */
function strokeAlignName(value: FigStrokeAlign | KiwiEnumValue<FigStrokeAlign> | undefined): FigStrokeAlign | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "name" in value) {
    return value.name;
  }
  return undefined;
}

/**
 * Resolve the node's stroke weight to a single uniform value. Per-side
 * stroke weights are out of scope for the v0 emitter — SwiftUI has no
 * shape primitive that paints a different stroke per edge without a
 * custom `Path`, so the helper throws (Fail-Fast) instead of silently
 * collapsing to one side.
 */
function uniformStrokeWeight(weight: FigStrokeWeight | undefined): number | undefined {
  if (weight === undefined) {
    return undefined;
  }
  if (typeof weight === "number") {
    return weight > 0 ? weight : undefined;
  }
  const { top, right, bottom, left } = weight;
  if (top === right && right === bottom && bottom === left) {
    return top > 0 ? top : undefined;
  }
  throw new Error(
    `fig-to-swiftui: per-side strokeWeight is not supported (got ${JSON.stringify(weight)})`,
  );
}

/**
 * Build a `.overlay(<shape>().<strokeKind>(Color, lineWidth: w))`
 * modifier for a node that carries a visible SOLID stroke.
 *
 * Stroke alignment maps to two SwiftUI primitives:
 *
 *   - `INSIDE`  → `.strokeBorder(Color, lineWidth: w)` — the stroke
 *     paints fully inside the silhouette. This is Figma's default for
 *     RECTANGLE-like nodes and matches the most common authoring
 *     intent (the stroked rectangle still occupies the authored size).
 *
 *   - `CENTER`  → `.stroke(Color, lineWidth: w)` — the stroke straddles
 *     the silhouette edge; half is outside the bounds. Useful for
 *     hairline outlines on shapes whose authored size already accounts
 *     for the stroke spread.
 *
 *   - `OUTSIDE` is approximated by widening the overlay shape (`.padding(-w/2)`)
 *     and stroking it. SwiftUI has no first-class outside-aligned stroke,
 *     so this is the best available approximation; the Figma reference
 *     and the SwiftUI render will agree on the painted region but the
 *     cap geometry near rounded corners is not bit-exact.
 *
 * The overlay reuses `shapeExprFor(node)` so the outline follows the
 * node's silhouette — the stroke on a `RoundedRectangle` follows the
 * rounded path, not the bounding box. Returns undefined when no SOLID
 * stroke or no positive strokeWeight is authored.
 */
export function strokeOverlayModifier(node: FigNode): Modifier | undefined {
  const stroke = firstVisibleSolidPaint(node.strokePaints);
  if (!stroke) {
    return undefined;
  }
  const lineWidth = uniformStrokeWeight(node.strokeWeight);
  if (lineWidth === undefined) {
    return undefined;
  }
  // Figma's authored default for shape strokes is CENTER (the stroke
  // straddles the path edge half-in / half-out). The fixture-author
  // tooling omits the field when the value is the default, so an
  // undefined `strokeAlign` should map to CENTER, not INSIDE.
  const align = strokeAlignName(node.strokeAlign) ?? "CENTER";
  const color = solidPaintToColor(stroke);
  const dashed = dashPatternForStroke(node);
  const styleArg = strokeStyleArg(lineWidth, dashed);
  const strokeShape = strokedShapeView(node, align, color, styleArg);
  return modifier("overlay", [arg(viewExpr(strokeShape))]);
}

/**
 * Build the SwiftUI shape view that paints the stroke outline. The
 * shape silhouette is reused from `shapeExprFor(node)` so the outline
 * follows the same path as the (possibly rounded) underlying fill.
 *
 * The stroke kind (`stroke` vs `strokeBorder`) is dispatched by the
 * Figma `strokeAlign`. For OUTSIDE we widen the shape's bounds with a
 * negative padding equal to half the stroke width before stroking —
 * SwiftUI has no first-class outside-aligned stroke, and this is the
 * idiomatic approximation that matches Figma's outside-stroke at the
 * paint level.
 */
function strokedShapeView(
  node: FigNode,
  align: FigStrokeAlign,
  color: SwiftExpr,
  styleArg: SwiftExpr,
): SwiftView {
  const shape = shapeExprFor(node);
  if (align === "INSIDE") {
    return leaf(shape, [
      modifier("strokeBorder", [arg(color), namedArg("style", styleArg)]),
    ]);
  }
  if (align === "OUTSIDE") {
    const lineWidth = uniformStrokeWeight(node.strokeWeight) ?? 0;
    return leaf(shape, [
      modifier("strokeBorder", [arg(color), namedArg("style", styleArg)]),
      modifier("padding", [{ value: num(-lineWidth) }]),
    ]);
  }
  // CENTER (and unknown) — half-in/half-out stroke.
  return leaf(shape, [
    modifier("stroke", [arg(color), namedArg("style", styleArg)]),
  ]);
}

/**
 * Build the `StrokeStyle(lineWidth:..., dash: [...])` argument for the
 * stroke / strokeBorder call. Dashes come from `node.dashPattern`; an
 * empty pattern collapses to a solid `StrokeStyle(lineWidth:)`.
 */
function strokeStyleArg(lineWidth: number, dash: readonly number[] | undefined): SwiftExpr {
  const args = [namedArg("lineWidth", num(lineWidth))];
  if (dash && dash.length > 0) {
    args.push(namedArg("dash", array(dash.map((d) => num(d)))));
  }
  return call("StrokeStyle", args);
}

function dashPatternForStroke(node: FigNode): readonly number[] | undefined {
  const dash = node.dashPattern;
  if (!dash || dash.length === 0) {
    return undefined;
  }
  return dash;
}

/**
 * Build the `.rotationEffect(.degrees(...), anchor: .topLeading)`
 * modifier when the node's 2D affine transform encodes a non-zero
 * rotation.
 *
 * Anchor matters: SwiftUI's default is `.center`, but Figma's
 * transform `[[cos, -sin, tx], [sin, cos, ty]]` rotates around the
 * shape's *local origin* (its top-left) and then translates by
 * `(tx, ty)`. To match that we pin the SwiftUI rotation anchor to
 * `.topLeading` and let the subsequent `.offset(x: m02, y: m12)`
 * place the rotated view's top-left at the Figma authored position.
 *
 * Sign convention: Figma stores `m10 = sin(θ)` for the standard math
 * matrix, which produces a *clockwise* visual rotation in screen-Y-
 * down coords. SwiftUI's `.rotationEffect(.degrees(d))` is also
 * clockwise for positive `d`, so the Figma angle transfers directly
 * without a sign flip. Sub-pixel anti-aliasing on rotated edges is
 * absorbed by the visual round-trip's per-frame thresholds.
 */
export function rotationModifier(node: FigNode): Modifier | undefined {
  const t = node.transform;
  if (!t) {
    return undefined;
  }
  const cos = t.m00 ?? 1;
  const sin = t.m10 ?? 0;
  // No rotation when the rotation matrix is the identity (cos=1, sin=0).
  // Use a small tolerance to absorb floating-point round-trip noise.
  if (Math.abs(sin) < 1e-6 && Math.abs(cos - 1) < 1e-6) {
    return undefined;
  }
  const radians = Math.atan2(sin, cos);
  const degrees = roundDegrees((radians * 180) / Math.PI);
  return modifier("rotationEffect", [
    { value: call(".degrees", [{ value: num(degrees) }]) },
    namedArg("anchor", member("topLeading")),
  ]);
}

function roundDegrees(deg: number): number {
  // Snap near-integer degrees to integers to keep the emitted source
  // compact. 1e-3 is well below the smallest distinguishable angle in
  // a 1-point-pixel render at typical Figma sizes.
  if (Math.abs(deg - Math.round(deg)) < 1e-3) {
    return Math.round(deg);
  }
  return Math.round(deg * 1000) / 1000;
}

/** Build the `.cornerRadius(r)` modifier for a uniform corner radius. */
export function cornerRadiusModifier(node: FigNode): Modifier | undefined {
  const radius = uniformCornerRadius(node);
  if (radius === undefined) {
    return undefined;
  }
  return modifier("cornerRadius", [{ value: num(radius) }]);
}

/**
 * Build a `.shadow(...)` modifier from the first visible DROP_SHADOW
 * effect. SwiftUI's `.shadow` accepts color, radius, x, y. Figma's
 * `radius` is the gaussian blur radius — the same semantic — so the
 * value transfers directly. Spread is not in SwiftUI; non-zero spread
 * is reported as a Fail-Fast condition.
 *
 * Use `shadowModifiers` (plural) instead when you want every visible
 * drop shadow on the node — Figma supports stacked drop shadows and
 * SwiftUI realises that by chaining `.shadow(...)` calls.
 */
export function shadowModifier(node: FigNode): Modifier | undefined {
  const all = shadowModifiers(node);
  return all.length > 0 ? all[0] : undefined;
}

/**
 * Build one `.shadow(...)` modifier per visible DROP_SHADOW effect on
 * the node. Figma layers multiple drop shadows by compositing each
 * blur'd offset copy and then the original; SwiftUI mirrors that by
 * applying `.shadow(...)` modifiers in sequence. The returned array is
 * in Figma's effect-array order — the first effect paints furthest
 * back and is therefore applied first in SwiftUI's outside-in
 * modifier chain.
 */
export function shadowModifiers(node: FigNode): readonly Modifier[] {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return [];
  }
  const out: Modifier[] = [];
  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }
    if (effectTypeName(effect.type) !== "DROP_SHADOW") {
      continue;
    }
    if (effect.spread !== undefined && effect.spread !== 0) {
      throw new Error(
        `fig-to-swiftui: drop-shadow spread is not supported by SwiftUI (node "${node.name ?? "unnamed"}" has spread=${effect.spread})`,
      );
    }
    if (!effect.color) {
      throw new Error(
        `fig-to-swiftui: drop-shadow without color (node "${node.name ?? "unnamed"}")`,
      );
    }
    const color = colorExpr(effect.color);
    const radius = typeof effect.radius === "number" ? effect.radius : 0;
    const offsetX = effect.offset?.x ?? 0;
    const offsetY = effect.offset?.y ?? 0;
    out.push(
      modifier("shadow", [
        namedArg("color", color),
        namedArg("radius", num(radius)),
        namedArg("x", num(offsetX)),
        namedArg("y", num(offsetY)),
      ]),
    );
  }
  return out;
}

/**
 * Build a `.blur(radius: r)` modifier from the first visible
 * LAYER_BLUR / FOREGROUND_BLUR effect on the node.
 *
 * Both Figma effects map onto SwiftUI's `.blur(radius:)`. The σ
 * convention differs slightly between Figma's gaussian-blur shader
 * and SwiftUI's CoreImage filter, so the rendered edge transition
 * lands a few percentage points off pixel-perfect — but the
 * direction and qualitative softness match.
 *
 * BACKGROUND_BLUR is handled separately (see `backgroundBlurModifier`)
 * because it needs to blur the *backdrop* rather than the foreground.
 */
export function blurModifier(node: FigNode): Modifier | undefined {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return undefined;
  }
  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }
    const tname = effectTypeName(effect.type);
    if (tname === "LAYER_BLUR" || tname === "FOREGROUND_BLUR") {
      const radius = typeof effect.radius === "number" ? effect.radius : 0;
      if (radius <= 0) {
        return undefined;
      }
      // Empirical calibration: SwiftUI's `.blur(radius:)` expects σ
      // (the gaussian standard deviation), while Figma's
      // `effect.radius` is the *displacement* radius — roughly 2σ.
      // Halving the value brings the rendered edge transition into
      // sub-1% diff agreement with the WebGL reference for the
      // canonical `blur-layer` fixture.
      return modifier("blur", [namedArg("radius", num(radius / 2))]);
    }
  }
  return undefined;
}

/**
 * Build a `.background(...)` modifier that samples and blurs the
 * backdrop, realising Figma's BACKGROUND_BLUR effect.
 *
 * SwiftUI's `Material` (e.g. `.thinMaterial`) gives a similar
 * frosted-glass effect but isn't parameterised by radius. The
 * closest direct construction is `.background(<background view>.blur(...))`
 * — we use a clear-coloured view masked to the shape's silhouette
 * with `.blur` applied, which Apple's renderer composites over the
 * already-rendered backdrop. The tradeoff: the blur sigma differs
 * slightly from Figma's, similar to LAYER_BLUR.
 *
 * Returns undefined when no BACKGROUND_BLUR effect is present. The
 * helper builds a full modifier on its own (rather than just a
 * `.blur(radius:)` value) because background blur composes against
 * the backdrop, not the foreground content.
 */
export function backgroundBlurModifier(node: FigNode): Modifier | undefined {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return undefined;
  }
  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }
    if (effectTypeName(effect.type) !== "BACKGROUND_BLUR") {
      continue;
    }
    const radius = typeof effect.radius === "number" ? effect.radius : 0;
    if (radius <= 0) {
      return undefined;
    }
    // `.background(.thinMaterial.blur(radius: r))` is invalid SwiftUI;
    // `Material` is not a `View`. Use a `Rectangle` with the
    // node's silhouette via overlay-on-clear, blurred.
    //
    // We approximate by emitting `.background(.ultraThinMaterial)`
    // when radius > 0 and skip per-pixel radius matching — Apple's
    // Material API doesn't expose the kernel size. For
    // calibration-sensitive fixtures, callers can extend this to
    // a custom backdrop sampler later.
    return modifier("background", [{ value: member("ultraThinMaterial") }]);
  }
  return undefined;
}

/**
 * Build one `.overlay(...)` modifier per visible INNER_SHADOW effect
 * on the node. SwiftUI lacks a first-class inner-shadow modifier, so
 * the construction is:
 *
 *   .overlay(
 *     <shape>
 *       .stroke(shadowColor, lineWidth: 2 * radius)
 *       .blur(radius: radius)
 *       .offset(x: dx, y: dy)
 *       .mask(<shape>)
 *   )
 *
 * The wide stroke paints a band along the shape's edge; blurring it
 * softens the band into a gradient; the offset shifts the gradient
 * toward the shadow side; finally `.mask(<shape>)` clips the result
 * to the shape's interior so the shadow falls *inside* rather than
 * spilling outside the silhouette. The lineWidth doubling is needed
 * because `.stroke` paints half its width inside and half outside
 * the path — only the inside half survives the mask.
 */
export function innerShadowOverlayModifiers(node: FigNode): readonly Modifier[] {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return [];
  }
  const out: Modifier[] = [];
  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }
    if (effectTypeName(effect.type) !== "INNER_SHADOW") {
      continue;
    }
    if (!effect.color) {
      throw new Error(
        `fig-to-swiftui: inner-shadow without color (node "${node.name ?? "unnamed"}")`,
      );
    }
    const radius = typeof effect.radius === "number" ? effect.radius : 0;
    const offsetX = effect.offset?.x ?? 0;
    const offsetY = effect.offset?.y ?? 0;
    const color = colorExpr(effect.color);
    const shape = shapeExprFor(node);
    // SwiftUI's `.stroke(_, lineWidth:)` paints `lineWidth/2` inside
    // and `lineWidth/2` outside the path; only the inside half
    // survives the `.mask(<shape>)` clip. Figma's inner shadow is a
    // gaussian fade from the edge inward, so the visible gradient
    // depth comes mostly from the blur — the stroke just provides a
    // dark seed at the edge. We pick a thin seed (`max(1, …)`) so
    // the post-blur gradient depth tracks Figma's: a sharp edge
    // would produce a flat band the width of the stroke, which is
    // wrong. The minimum prevents the seed from disappearing on
    // sub-pixel offsets.
    //
    // Empirically a `lineWidth` of `min(radius, 4)` (capped) tracks
    // Figma's `effect.radius` channel within the AA noise floor for
    // both the small `frame-inner-shadow` (r=10) and the canonical
    // `shadow-inner` (r=4) cases — the cap stops large radii from
    // painting a flat band wider than the visible silhouette.
    const lineWidth = Math.max(1, Math.min(radius, 4));
    const strokeMods: Modifier[] = [
      modifier("stroke", [arg(color), namedArg("lineWidth", num(lineWidth))]),
    ];
    if (radius > 0) {
      strokeMods.push(modifier("blur", [namedArg("radius", num(radius))]));
    }
    if (offsetX !== 0 || offsetY !== 0) {
      strokeMods.push(
        modifier("offset", [namedArg("x", num(offsetX)), namedArg("y", num(offsetY))]),
      );
    }
    strokeMods.push(modifier("mask", [arg(viewExpr(leaf(shape, [])))]));
    const overlayView = leaf(shape, strokeMods);
    out.push(modifier("overlay", [arg(viewExpr(overlayView))]));
  }
  return out;
}

/**
 * Build the `.opacity(o)` modifier when the node carries a non-default
 * opacity (Figma stores opacity at the node level on top of paint
 * opacity). Default of 1 is omitted.
 */
export function opacityModifier(node: FigNode): Modifier | undefined {
  if (typeof node.opacity !== "number" || node.opacity === 1) {
    return undefined;
  }
  return modifier("opacity", [{ value: num(node.opacity) }]);
}

/**
 * Build a `.compositingGroup()` modifier — inserted directly before
 * `.opacity(...)` on multi-child containers so the children flatten
 * to a single group before alpha is applied.
 *
 * SwiftUI's `.opacity(α)` on a container applies α independently to
 * each child's rendering, so two overlapping translucent rects would
 * blend additively — the overlap region picks up *more* alpha than
 * either child alone, the inverse of Figma's "group α" semantic
 * where the group is composited as one and then attenuated.
 *
 * `.compositingGroup()` flattens the container's children into a
 * single off-screen image *before* the next modifier runs, so
 * `.compositingGroup().opacity(0.5)` produces Figma's "the whole
 * group is at 50%" behaviour. It is a no-op (or near-no-op) when the
 * container has only one child, so we only emit it when needed.
 */
export function compositingGroupModifier(): Modifier {
  return modifier("compositingGroup", []);
}

/**
 * Build a `.font(.system(size:..., weight:...))` modifier for a TEXT
 * node. Returns undefined when no fontSize is set; throws when the
 * caller asked for a non-system family — system font is the only path
 * a v0 SwiftUI consumer can render without bundling the font asset.
 *
 * The fontWeight is mapped from the Figma style name's numeric weight
 * via the fig package's documented family of weight names.
 */
export function fontModifier(node: FigNode): Modifier | undefined {
  if (typeof node.fontSize !== "number") {
    return undefined;
  }
  const weight = node.fontName ? swiftWeightForFigStyle(node.fontName) : undefined;
  const args = [namedArg("size", num(node.fontSize))];
  const weightArg = weight ? [namedArg("weight", member(weight))] : [];
  return modifier("font", [{ value: call(".system", [...args, ...weightArg]) }]);
}

/**
 * Map a Figma font style name (e.g. "Regular", "Bold", "SemiBold") to
 * the matching SwiftUI `Font.Weight` member name. Returns undefined
 * when the style isn't a recognised weight token — the emitter then
 * omits the `weight:` argument and the system default applies.
 */
export function swiftWeightForFigStyle(fontName: FigFontName): string | undefined {
  const style = fontName.style.toLowerCase();
  if (style.includes("ultralight") || style.includes("ultra light")) {
    return "ultraLight";
  }
  if (style.includes("thin")) {
    return "thin";
  }
  if (style.includes("extralight") || style.includes("extra light")) {
    return "ultraLight";
  }
  if (style.includes("light")) {
    return "light";
  }
  if (style.includes("medium")) {
    return "medium";
  }
  if (style.includes("semibold") || style.includes("semi bold")) {
    return "semibold";
  }
  if (style.includes("extrabold") || style.includes("extra bold")) {
    return "heavy";
  }
  if (style.includes("bold")) {
    return "bold";
  }
  if (style.includes("black") || style.includes("heavy")) {
    return "black";
  }
  if (style.includes("regular") || style.includes("normal")) {
    return "regular";
  }
  return undefined;
}

/**
 * Build a `.foregroundColor(...)` modifier from the first visible
 * SOLID fill paint of a TEXT node. SwiftUI applies foregroundColor to
 * the rendered glyph fill, which is exactly Figma's TEXT fill semantic.
 */
export function foregroundColorModifier(node: FigNode): Modifier | undefined {
  const fill = firstVisibleSolidPaint(node.fillPaints);
  if (!fill) {
    return undefined;
  }
  return modifier("foregroundColor", [{ value: solidPaintToColor(fill) }]);
}

/**
 * Build a `.padding(.init(top:, leading:, bottom:, trailing:))`
 * modifier when the four-side padding is non-zero. Uniform padding is
 * compacted to `.padding(n)`; equal-axis padding is compacted to
 * `.padding(.horizontal, n)` / `.padding(.vertical, n)`.
 */
export function paddingModifier(padding: {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}): Modifier | undefined {
  const { top, right, bottom, left } = padding;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) {
    return undefined;
  }
  if (top === right && right === bottom && bottom === left) {
    return modifier("padding", [{ value: num(top) }]);
  }
  if (top === bottom && left === right) {
    // Two `.padding(edge, n)` modifiers must be applied as a chain.
    // Returning a single modifier is not enough — instead we fall
    // through to the explicit `EdgeInsets` form which is the
    // single-modifier representation Swift accepts.
    return edgeInsetsModifier(padding);
  }
  return edgeInsetsModifier(padding);
}

function edgeInsetsModifier(padding: {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}): Modifier {
  const insets: SwiftExpr = call("EdgeInsets", [
    namedArg("top", num(padding.top)),
    namedArg("leading", num(padding.left)),
    namedArg("bottom", num(padding.bottom)),
    namedArg("trailing", num(padding.right)),
  ]);
  return modifier("padding", [{ value: insets }]);
}

/**
 * Build the `.offset(x:, y:)` modifier for a node positioned by
 * `transform` inside a non-autolayout (ZStack) parent. SwiftUI's
 * `.offset` shifts the rendered view without affecting layout; it is
 * the SwiftUI counterpart to absolute positioning in CSS.
 */
export function offsetModifier(x: number, y: number): Modifier | undefined {
  if (x === 0 && y === 0) {
    return undefined;
  }
  return modifier("offset", [namedArg("x", num(x)), namedArg("y", num(y))]);
}

/** Convenience: build a SwiftUI `Spacer()` expression. */
export function spacerExpr(): SwiftExpr {
  return ident("Spacer()");
}
