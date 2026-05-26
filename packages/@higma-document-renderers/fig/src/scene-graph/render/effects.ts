/**
 * @file Effects resolution — shared SoT for SceneGraph Effect → SVG filter attributes
 *
 * Both SVG string and React renderers MUST consume this output.
 *
 * The resolved filter primitives are plain data objects, not SVG strings
 * or React elements. Each consumer formats them for its own output.
 */

import type { Effect, Color, BlendMode, DropShadowEffect, InnerShadowEffect, LayerBlurEffect } from "@higma-document-renderers/fig/scene-graph";
import type { IdGenerator } from "./fill";

// =============================================================================
// Resolved Filter Primitive Types
// =============================================================================

/** SVG feColorMatrix `type` attribute values (see SVG spec). */
export type FeColorMatrixType = "matrix" | "saturate" | "hueRotate" | "luminanceToAlpha";

/** SVG feBlend `mode` attribute values accepted by the browser SVG filter implementation. */
export type FeBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

type EffectFilterBlendMode = FeBlendMode;

/** SVG feComposite `operator` attribute values. */
export type FeCompositeOperator = "over" | "in" | "out" | "atop" | "xor" | "arithmetic";

/**
 * Convert Figma/Kiwi blur radius into the SVG/CSS/WebGL gaussian sigma.
 *
 * Kiwi stores the authored Figma effect radius. Figma's own SVG export
 * writes half of that value into `feGaussianBlur.stdDeviation` and CSS
 * `backdrop-filter: blur(...)`; WebGL must feed the same sigma into its
 * gaussian pass. Keeping the conversion here prevents each backend from
 * independently deciding what a blur radius means.
 */
export function resolveFigmaBlurStdDeviation(radius: number): number {
  if (!Number.isFinite(radius)) {
    throw new Error(`Figma blur radius must be finite, got ${radius}`);
  }
  if (radius < 0) {
    throw new Error(`Figma blur radius must be non-negative, got ${radius}`);
  }
  return radius / 2;
}

/**
 * A resolved SVG filter primitive.
 * Each variant corresponds to an SVG filter element with all attributes computed.
 */
export type ResolvedFilterPrimitive =
  | { readonly type: "feFlood"; readonly floodColor?: string; readonly floodOpacity: number; readonly result: string }
  | { readonly type: "feColorMatrix"; readonly in?: string; readonly matrixType: FeColorMatrixType; readonly values: string; readonly result?: string }
  | { readonly type: "feOffset"; readonly in?: string; readonly dx: number; readonly dy: number; readonly result?: string }
  | { readonly type: "feGaussianBlur"; readonly in?: string; readonly stdDeviation: number; readonly result?: string }
  | { readonly type: "feBlend"; readonly mode: FeBlendMode; readonly in?: string; readonly in2?: string; readonly result?: string }
  | {
      readonly type: "feComposite";
      readonly in?: string;
      readonly in2: string;
      readonly operator: FeCompositeOperator;
      readonly k1?: number;
      readonly k2?: number;
      readonly k3?: number;
      readonly k4?: number;
      readonly result?: string;
    }
  | { readonly type: "feMorphology"; readonly in?: string; readonly operator: "dilate" | "erode"; readonly radius: number; readonly result?: string }
  | { readonly type: "feMerge"; readonly nodes: readonly string[] };

/**
 * Complete resolved filter with all primitives and the filter ID.
 */
export type ResolvedFilter = {
  readonly id: string;
  readonly filterAttr: string;
  readonly primitives: readonly ResolvedFilterPrimitive[];
  /**
   * Filter region in userSpaceOnUse coordinates.
   * Required to prevent shadow/blur clipping — SVG's default filter region
   * (10% margin) is too small for large offsets or blur radii.
   * Set by the caller (resolveWrapper) which knows the element bounds.
   */
  readonly filterBounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

export type ResolveEffectsOptions = {
  readonly sourceGraphic?: "include" | "omit";
};

type PreparedInnerShadow = {
  readonly input: string;
  readonly blendMode: EffectFilterBlendMode;
};

// =============================================================================
// Resolution
// =============================================================================

/**
 * Resolve a SceneGraph effect blend token to the browser-valid filter blend
 * mode that matches browser-rendered Figma SVG exports.
 */
export function resolveBrowserRenderedFigmaExportEffectBlendMode(blendMode: BlendMode | undefined): FeBlendMode {
  if (!blendMode) {
    return "normal";
  }
  switch (blendMode) {
    case "multiply":
    case "screen":
    case "darken":
    case "lighten":
    case "overlay":
    case "color-dodge":
    case "color-burn":
    case "hard-light":
    case "soft-light":
    case "difference":
    case "exclusion":
    case "hue":
    case "saturation":
    case "color":
    case "luminosity":
      return blendMode;
    case "plus-lighter":
    case "plus-darker":
      // Figma's SVG exporter writes these CSS blend tokens into feBlend,
      // but Chrome treats them as invalid SVG filter modes and renders the
      // primitive with the initial `normal` mode. Emit that browser-valid
      // projection explicitly so editor SVG output stays warning-free while
      // matching the browser-rendered Figma export.
      return "normal";
    default:
      throw new Error(`Unsupported SVG filter blend mode "${blendMode}"`);
  }
}

const ALPHA_BINARIZE_MATRIX = "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0";
const FILTER_BACKGROUND_RESULT = "BackgroundImageFix";

function buildColorMatrix(c: Color): string {
  return `0 0 0 0 ${c.r} 0 0 0 0 ${c.g} 0 0 0 0 ${c.b} 0 0 0 ${c.a} 0`;
}

function resolveNegativeDirectionExpansion(isNormalBlend: boolean, totalExpansion: number, offset: number): number {
  if (isNormalBlend) { return Math.max(0, totalExpansion - offset); }
  if (offset > 0) { return 0; }
  return totalExpansion - offset;
}

function resolvePositiveDirectionExpansion(isNormalBlend: boolean, totalExpansion: number, offset: number): number {
  if (isNormalBlend) { return Math.max(0, totalExpansion + offset); }
  if (offset < 0) { return 0; }
  return totalExpansion + offset;
}

function appendDropShadowBlend(params: {
  readonly primitives: ResolvedFilterPrimitive[];
  readonly ids: IdGenerator;
  readonly blendMode: EffectFilterBlendMode;
  readonly input: string;
  readonly backdrop: string;
}): string {
  const result = params.ids.getNextId("drop-shadow");
  appendFilterBlendPrimitive(params.primitives, params.blendMode, params.input, params.backdrop, result);
  return result;
}

function appendFilterBlendPrimitive(
  primitives: ResolvedFilterPrimitive[],
  mode: EffectFilterBlendMode,
  input: string,
  backdrop: string,
  result: string,
): void {
  primitives.push({
    type: "feBlend",
    mode,
    in: input,
    in2: backdrop,
    result,
  });
}

function appendBackgroundImageFix(params: {
  readonly primitives: ResolvedFilterPrimitive[];
}): void {
  params.primitives.push({ type: "feFlood", floodOpacity: 0, result: FILTER_BACKGROUND_RESULT });
}

function appendDropShadowOverBackdrop(params: {
  readonly primitives: ResolvedFilterPrimitive[];
  readonly ids: IdGenerator;
  readonly blendMode: EffectFilterBlendMode;
  readonly input: string;
  readonly currentBackdrop: string | undefined;
}): string {
  if (params.currentBackdrop !== undefined) {
    return appendDropShadowBlend({
      primitives: params.primitives,
      ids: params.ids,
      blendMode: params.blendMode,
      input: params.input,
      backdrop: params.currentBackdrop,
    });
  }
  params.primitives.unshift({ type: "feFlood", floodOpacity: 0, result: FILTER_BACKGROUND_RESULT });
  return appendDropShadowBlend({
    primitives: params.primitives,
    ids: params.ids,
    blendMode: params.blendMode,
    input: params.input,
    backdrop: FILTER_BACKGROUND_RESULT,
  });
}

function appendSourceGraphicOverBackdrop(params: {
  readonly primitives: ResolvedFilterPrimitive[];
  readonly ids: IdGenerator;
  readonly backdrop: string;
}): string {
  const result = params.ids.getNextId("shape");
  params.primitives.push({
    type: "feBlend",
    mode: "normal",
    in: "SourceGraphic",
    in2: params.backdrop,
    result,
  });
  return result;
}

function appendStandaloneInnerShadowShape(params: {
  readonly primitives: ResolvedFilterPrimitive[];
  readonly ids: IdGenerator;
  readonly sourceGraphic: ResolveEffectsOptions["sourceGraphic"];
  readonly hasDropShadow: boolean;
  readonly hasInnerShadow: boolean;
}): string | undefined {
  if (params.sourceGraphic === "omit" || params.hasDropShadow || !params.hasInnerShadow) {
    return undefined;
  }
  appendBackgroundImageFix({ primitives: params.primitives });
  return appendSourceGraphicOverBackdrop({
    primitives: params.primitives,
    ids: params.ids,
    backdrop: FILTER_BACKGROUND_RESULT,
  });
}

function appendSourceGraphicOverShadow(params: {
  readonly primitives: ResolvedFilterPrimitive[];
  readonly ids: IdGenerator;
  readonly dropBackdrop: string | undefined;
  readonly standaloneShape: string | undefined;
  readonly sourceGraphic: ResolveEffectsOptions["sourceGraphic"];
  readonly materializeSourceGraphicForForegroundBlur: boolean;
}): string | undefined {
  if (params.dropBackdrop === undefined) {
    return resolveSourceGraphicWithoutDropShadow(params);
  }
  if (params.sourceGraphic === "omit") {
    return params.dropBackdrop;
  }
  return appendSourceGraphicOverBackdrop({
    primitives: params.primitives,
    ids: params.ids,
    backdrop: params.dropBackdrop,
  });
}

function resolveSourceGraphicWithoutDropShadow(params: {
  readonly primitives: ResolvedFilterPrimitive[];
  readonly ids: IdGenerator;
  readonly sourceGraphic: ResolveEffectsOptions["sourceGraphic"];
  readonly standaloneShape: string | undefined;
  readonly materializeSourceGraphicForForegroundBlur: boolean;
}): string | undefined {
  if (params.sourceGraphic === "omit") {
    return undefined;
  }
  if (params.standaloneShape !== undefined) {
    return params.standaloneShape;
  }
  if (params.materializeSourceGraphicForForegroundBlur) {
    appendBackgroundImageFix({ primitives: params.primitives });
    return appendSourceGraphicOverBackdrop({
      primitives: params.primitives,
      ids: params.ids,
      backdrop: FILTER_BACKGROUND_RESULT,
    });
  }
  return "SourceGraphic";
}

function appendInnerShadowBlends(params: {
  readonly primitives: ResolvedFilterPrimitive[];
  readonly ids: IdGenerator;
  readonly baseResult: string | undefined;
  readonly innerShadows: readonly PreparedInnerShadow[];
}): string | undefined {
  if (params.innerShadows.length === 0) {
    return params.baseResult;
  }
  return params.innerShadows.reduce<string | undefined>((current, inner) => {
    if (current === undefined) {
      return inner.input;
    }
    const result = params.ids.getNextId("inner-shadow");
    appendFilterBlendPrimitive(params.primitives, inner.blendMode, inner.input, current, result);
    return result;
  }, params.baseResult);
}

function resolveForegroundBlurInput(result: string | undefined): string {
  return result ?? "SourceGraphic";
}

/**
 * Format a 0–1 color as CSS `rgb(r, g, b)` for SVG `flood-color`.
 * Uses the same half-ULP epsilon as colorToHex so float32 kiwi-encoded
 * channels round consistently across the rendering stack.
 */
function colorToRgb(c: Color): string {
  const r = Math.round(c.r * 255 + 1e-4);
  const g = Math.round(c.g * 255 + 1e-4);
  const b = Math.round(c.b * 255 + 1e-4);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Resolve effects to a filter definition.
 *
 * This is the exhaustive handler — adding a new Effect type without
 * handling it here will produce a TypeScript compile error (via the
 * never check at the bottom of the switch).
 */
export function resolveEffects(
  effects: readonly Effect[],
  ids: IdGenerator,
  elementBounds?: { x: number; y: number; width: number; height: number },
  options: ResolveEffectsOptions = {},
): ResolvedFilter | undefined {
  if (effects.length === 0) {
    return undefined;
  }

  const primitives: ResolvedFilterPrimitive[] = [];
  const hasDropShadow = effects.some((effect) => effect.type === "drop-shadow");
  const hasInnerShadow = effects.some((effect) => effect.type === "inner-shadow");
  const standaloneShape = appendStandaloneInnerShadowShape({
    primitives,
    ids,
    sourceGraphic: options.sourceGraphic,
    hasDropShadow,
    hasInnerShadow,
  });
  const dropBackdropResult: { result: string | undefined } = { result: undefined };
  // Inner shadows are prepared as tinted bands and then blended over
  // the composed foreground in declaration order. This mirrors Figma's
  // SVG filter structure: `shape -> effect1_innerShadow -> ...`.
  const innerShadows: PreparedInnerShadow[] = [];
  const foregroundBlurEffects: LayerBlurEffect[] = [];

  for (const effect of effects) {
    switch (effect.type) {
      case "drop-shadow": {
        const isSharp = effect.radius === 0 && (!effect.spread || effect.spread === 0);
        const blendMode = resolveBrowserRenderedFigmaExportEffectBlendMode(effect.blendMode);

        if (isSharp) {
          // Sharp drop-shadow recipe (Figma's exact SVG export shape, used
          // for 1px edge highlights such as world-map continent outlines).
          // Three key differences from the blurred recipe:
          //
          //   1. SourceAlpha is binarised via a 127×alpha colorMatrix
          //      ("hardAlpha"). With anti-aliased edges, the 127× clamp
          //      makes any non-zero alpha → 1, producing a hard mask.
          //
          //   2. **hardAlpha (not SourceAlpha) is offset**. Using
          //      SourceAlpha here would bake the source's anti-aliased
          //      edge into the offset sliver — after feComposite "out"
          //      against the binarised hardAlpha, the sliver keeps
          //      the 0.5..0.99 AA values instead of a clean 1.0, so the
          //      tinted shadow ends up ~30-50% transparent at the very
          //      pixels Figma draws at full opacity. Operating on
          //      hardAlpha keeps the sliver cleanly at α=1.0.
          //
          //   3. The offset hardAlpha is then composited with
          //      operator="out" against hardAlpha. "out" means *keep
          //      offsetHardAlpha where hardAlpha is NOT* — the result is
          //      exactly the 1px sliver that the offset exposed beyond
          //      the original shape edge, at full alpha.
          //
          // For tinting we use feFlood + feComposite operator="in" rather
          // than the feColorMatrix approach Figma's exporter uses. The
          // colorMatrix `[0 0 0 0 c.r ...]` form sets RGB to constants
          // while keeping the input alpha — at fully-transparent pixels
          // the output is `(c.r, c.g, c.b, 0)`. resvg-js's feMerge then
          // leaks those RGB constants through to the composited result
          // even though the alpha is zero, painting the entire filter
          // region with the shadow colour. feFlood + composite-in instead
          // produces pre-multiplied output `(c.r·α, c.g·α, c.b·α, α)`
          // with α=0 everywhere outside the sliver, eliminating the leak.
          const c = effect.color;
          const hardAlphaResult = ids.getNextId("hardAlpha");
          const offsetAlphaResult = ids.getNextId("drop-offset-alpha");
          const compositedResult = ids.getNextId("drop-composited");
          const floodResult = ids.getNextId("drop-flood");
          const tintedResult = ids.getNextId("drop-tinted");
          primitives.push(
            { type: "feColorMatrix", in: "SourceAlpha", matrixType: "matrix", values: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0", result: hardAlphaResult },
            { type: "feOffset", in: hardAlphaResult, dx: effect.offset.x, dy: effect.offset.y, result: offsetAlphaResult },
            { type: "feComposite", in: offsetAlphaResult, in2: hardAlphaResult, operator: "out", result: compositedResult },
            { type: "feFlood", floodColor: colorToRgb(c), floodOpacity: c.a, result: floodResult },
            { type: "feComposite", in: floodResult, in2: compositedResult, operator: "in", result: tintedResult },
          );
          dropBackdropResult.result = appendDropShadowOverBackdrop({
            primitives,
            ids,
            blendMode,
            input: tintedResult,
            currentBackdrop: dropBackdropResult.result,
          });
          break;
        }

        // Canonical drop-shadow recipe (matches Figma's exact SVG export):
        //
        //   feColorMatrix(SourceAlpha, 127×) → hardAlpha
        //   feOffset(hardAlpha, dx, dy)      → offsetAlpha
        //   feGaussianBlur(offsetAlpha)      → blurredAlpha
        //   if blendMode != normal:
        //     feComposite(blurredAlpha, in2=hardAlpha, op="out")
        //                                   → outsideAlpha (sliver outside shape)
        //   feColorMatrix(... , [0..r 0..g 0..b 0..0..a])
        //                                   → tinted RGBA shadow
        //
        // Recipe is driven by Kiwi showShadowBehindNode. When true, Figma's
        // exporter tints the blurred hardAlpha directly so the shadow also
        // shows through translucent source pixels. When false, the exporter
        // composites the source alpha out before tinting so only the outside
        // sliver remains for blend-mode mixing.
        //
        // For tinting we use feColorMatrix (Figma's exporter form). The
        // matrix `[0..r 0..g 0..b 0..0..a]` writes RGB constants and scales
        // the input alpha by `a`. After the "out" composite, alpha is non-
        // zero only in the outside sliver, so the leak that drove the sharp
        // recipe to feFlood+composite-in does not occur here.
        //
        // Spread support: feMorphology dilate/erode is applied between the
        // hardAlpha→offset chain and the blur step.
        const stdDev = resolveFigmaBlurStdDeviation(effect.radius);
        const c = effect.color;
        const hardAlphaResult = ids.getNextId("hardAlpha");
        const tintedResult = ids.getNextId("drop-tinted");

        primitives.push({
          type: "feColorMatrix",
          in: "SourceAlpha",
          matrixType: "matrix",
          values: ALPHA_BINARIZE_MATRIX,
          result: hardAlphaResult,
        });
        // Figma's exporter chains feOffset → feMorphology(if spread) →
        // feGaussianBlur with implicit pass-through (no `in`/`result`),
        // each consuming the previous primitive's output. We mirror that
        // shape: feOffset reads hardAlpha explicitly; feMorphology and
        // feGaussianBlur omit `in` so they consume the prior result.
        primitives.push({
          type: "feOffset",
          in: hardAlphaResult,
          dx: effect.offset.x,
          dy: effect.offset.y,
        });
        if (effect.spread && effect.spread !== 0) {
          primitives.push({
            type: "feMorphology",
            operator: effect.spread > 0 ? "dilate" : "erode",
            radius: Math.abs(effect.spread),
          });
        }
        primitives.push({ type: "feGaussianBlur", stdDeviation: stdDev });

        if (!effect.showShadowBehindNode) {
          const compositedResult = ids.getNextId("drop-composited");
          primitives.push(
            { type: "feComposite", in2: hardAlphaResult, operator: "out", result: compositedResult },
            { type: "feColorMatrix", in: compositedResult, matrixType: "matrix", values: buildColorMatrix(c), result: tintedResult },
          );
          dropBackdropResult.result = appendDropShadowOverBackdrop({
            primitives,
            ids,
            blendMode,
            input: tintedResult,
            currentBackdrop: dropBackdropResult.result,
          });
        } else {
          // showShadowBehindNode=true: blurred-hardAlpha is tinted directly
          // with no composite-out. The resulting tinted shadow includes both
          // the outside sliver and the blurred inside-shape alpha.
          primitives.push({
            type: "feColorMatrix",
            matrixType: "matrix",
            values: buildColorMatrix(c),
            result: tintedResult,
          });
          dropBackdropResult.result = appendDropShadowOverBackdrop({
            primitives,
            ids,
            blendMode,
            input: tintedResult,
            currentBackdrop: dropBackdropResult.result,
          });
        }
        break;
      }

      case "inner-shadow": {
        // Figma's SVG exporter computes the inner band as
        // `hardAlpha - blurred(offset(hardAlpha))` with arithmetic
        // feComposite (`k2=-1`, `k3=1`), then tints that alpha band
        // with feColorMatrix. SVG `out` is not equivalent: it
        // multiplies by `(1 - blurredAlpha)` instead of subtracting.
        //
        // Inner shadow spread uses Figma's inset semantics: positive
        // spread erodes SourceAlpha before offset/blur, widening the
        // inner band after the arithmetic subtraction; negative spread
        // dilates SourceAlpha and narrows it.
        const stdDev = resolveFigmaBlurStdDeviation(effect.radius);
        const hardAlphaResult = ids.getNextId("hardAlpha");
        const offsetResult = ids.getNextId("inner-offset");
        const spreadResult = ids.getNextId("inner-spread");
        const blurResult = ids.getNextId("inner-blur");
        const bandResult = ids.getNextId("inner-band");
        const tintedResult = ids.getNextId("inner-tinted");
        primitives.push({
          type: "feColorMatrix",
          in: "SourceAlpha",
          matrixType: "matrix",
          values: ALPHA_BINARIZE_MATRIX,
          result: hardAlphaResult,
        });
        if (effect.spread && effect.spread !== 0) {
          primitives.push({
            type: "feMorphology",
            in: "SourceAlpha",
            operator: effect.spread > 0 ? "erode" : "dilate",
            radius: Math.abs(effect.spread),
            result: spreadResult,
          });
        }
        const offsetIn = effect.spread && effect.spread !== 0 ? spreadResult : hardAlphaResult;
        primitives.push({
          type: "feOffset",
          in: offsetIn,
          dx: effect.offset.x,
          dy: effect.offset.y,
          result: offsetResult,
        });
        primitives.push(
          { type: "feGaussianBlur", in: offsetResult, stdDeviation: stdDev, result: blurResult },
          { type: "feComposite", in: blurResult, in2: hardAlphaResult, operator: "arithmetic", k2: -1, k3: 1, result: bandResult },
          { type: "feColorMatrix", in: bandResult, matrixType: "matrix", values: buildColorMatrix(effect.color), result: tintedResult },
        );
        innerShadows.push({
          input: tintedResult,
          blendMode: resolveBrowserRenderedFigmaExportEffectBlendMode(effect.blendMode),
        });
        break;
      }

      case "layer-blur": {
        foregroundBlurEffects.push(effect);
        break;
      }

      case "background-blur":
        // Background blur not supported in SVG filter pipeline
        break;

      default: {
        // Exhaustiveness check: if a new Effect type is added to the union,
        // TypeScript will report an error here.
        const _exhaustive: never = effect;
        void _exhaustive;
      }
    }
  }

  // Composite the assembled shadow stack before foreground blur:
  // drop shadows go BELOW `SourceGraphic`, inner shadows ABOVE. Drop
  // shadows are chained with feBlend so Kiwi `showShadowBehindNode`
  // and declaration order match Figma's exporter
  // (`effect1_dropShadow → effect2_dropShadow → ... → shape`). Inner
  // shadows are blended sequentially over that composed base, matching
  // Figma's `shape → effectN_innerShadow` chain.
  //
  // Figma's FOREGROUND_BLUR then consumes that composed foreground
  // result, not raw SourceGraphic. The iPhone template's side buttons
  // encode `[INNER_SHADOW, INNER_SHADOW, FOREGROUND_BLUR]`; emitting
  // the blur before this merge made it dead code because the later
  // feMerge became the filter output.
  const baseResult = appendSourceGraphicOverShadow({
    primitives,
    ids,
    dropBackdrop: dropBackdropResult.result,
    standaloneShape,
    sourceGraphic: options.sourceGraphic,
    materializeSourceGraphicForForegroundBlur: foregroundBlurEffects.length > 0,
  });

  const foregroundResult = appendInnerShadowBlends({
    primitives,
    ids,
    baseResult,
    innerShadows,
  });

  for (const effect of foregroundBlurEffects) {
    const stdDev = resolveFigmaBlurStdDeviation(effect.radius);
    primitives.push({
      type: "feGaussianBlur",
      in: resolveForegroundBlurInput(foregroundResult),
      stdDeviation: stdDev,
    });
  }

  if (primitives.length === 0) {
    return undefined;
  }

  const id = ids.getNextId("filter");

  // Compute filter bounds from shadow offsets/radii to prevent clipping
  const filterBounds = elementBounds ? resolveEffectBounds(effects, elementBounds) : undefined;

  return {
    id,
    filterAttr: `url(#${id})`,
    primitives,
    filterBounds,
  };
}

type FilterBounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

type FilterExtents = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function initialFilterExtents(bounds: FilterBounds): FilterExtents {
  return {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
  };
}

function filterExtentsToBounds(extents: FilterExtents): FilterBounds {
  return {
    x: extents.minX,
    y: extents.minY,
    width: extents.maxX - extents.minX,
    height: extents.maxY - extents.minY,
  };
}

function expandFilterExtentsForShadow(
  extents: FilterExtents,
  bounds: FilterBounds,
  effect: DropShadowEffect | InnerShadowEffect,
): FilterExtents {
  const offsetX = effect.offset.x;
  const offsetY = effect.offset.y;
  const blurExpansion = effect.radius; // 2 × stdDeviation = 2 × (radius/2) = radius
  const spreadExpansion = effect.spread ?? 0;
  const totalExpansion = blurExpansion + Math.abs(spreadExpansion);

  // Filter region expansion mirrors Figma's SVG exporter. There are
  // two regimes depending on blend mode:
  //
  // NORMAL blend (Thumbnail's drop-shadow, Avatar shadow, etc.):
  //   The shadow blur kernel reaches the full radius on EACH side,
  //   shifted by the offset. Expansion per side = radius ± offset.
  //   Negative expansion clamps to 0. This produces actual's filter
  //   region for Thumbnail (offset 0,2 radius 16): top=14, bottom=18,
  //   left=16, right=16. Verified against actual filter0_d_15_1188:
  //   x=0 y=0 width=96 height=96 around a rect at (16,14)+64×64.
  //
  // Non-NORMAL blend (OVERLAY-blended pink-band):
  //   The shadow paints colour through compositing. A radius-equal
  //   expansion in the opposite-of-offset direction (the "ghost"
  //   side of the shadow) bleeds the tint into pixels outside the
  //   rounded corner. For these effects we collapse the opposite-
  //   direction expansion to 0: a downward shadow (offsetY > 0)
  //   gets upExpand = 0.
  const isNormalBlend = effect.blendMode === undefined;
  const upExpand = resolveNegativeDirectionExpansion(isNormalBlend, totalExpansion, offsetY);
  const downExpand = resolvePositiveDirectionExpansion(isNormalBlend, totalExpansion, offsetY);
  const leftExpand = resolveNegativeDirectionExpansion(isNormalBlend, totalExpansion, offsetX);
  const rightExpand = resolvePositiveDirectionExpansion(isNormalBlend, totalExpansion, offsetX);

  return {
    minX: Math.min(extents.minX, bounds.x - leftExpand),
    minY: Math.min(extents.minY, bounds.y - upExpand),
    maxX: Math.max(extents.maxX, bounds.x + bounds.width + rightExpand),
    maxY: Math.max(extents.maxY, bounds.y + bounds.height + downExpand),
  };
}

function expandFilterExtentsForLayerBlur(
  extents: FilterExtents,
  bounds: FilterBounds,
  effect: LayerBlurEffect,
): FilterExtents {
  const expand = effect.radius;
  return {
    minX: Math.min(extents.minX, bounds.x - expand),
    minY: Math.min(extents.minY, bounds.y - expand),
    maxX: Math.max(extents.maxX, bounds.x + bounds.width + expand),
    maxY: Math.max(extents.maxY, bounds.y + bounds.height + expand),
  };
}

function expandFilterExtentsForInnerShadow(
  extents: FilterExtents,
  bounds: FilterBounds,
  effect: InnerShadowEffect,
): FilterExtents {
  const expand = effect.radius + Math.abs(effect.spread ?? 0);
  const leftExpand = resolveInnerShadowNegativeDirectionExpansion(expand, effect.offset.x);
  const rightExpand = resolveInnerShadowPositiveDirectionExpansion(expand, effect.offset.x);
  const upExpand = resolveInnerShadowNegativeDirectionExpansion(expand, effect.offset.y);
  const downExpand = resolveInnerShadowPositiveDirectionExpansion(expand, effect.offset.y);
  return {
    minX: Math.min(extents.minX, bounds.x - leftExpand),
    minY: Math.min(extents.minY, bounds.y - upExpand),
    maxX: Math.max(extents.maxX, bounds.x + bounds.width + rightExpand),
    maxY: Math.max(extents.maxY, bounds.y + bounds.height + downExpand),
  };
}

function resolveInnerShadowNegativeDirectionExpansion(expand: number, offset: number): number {
  if (offset < 0) {
    return expand;
  }
  return 0;
}

function resolveInnerShadowPositiveDirectionExpansion(expand: number, offset: number): number {
  if (offset > 0) {
    return expand;
  }
  return 0;
}

function expandFilterExtentsForEffect(
  extents: FilterExtents,
  bounds: FilterBounds,
  effect: Effect,
): FilterExtents {
  switch (effect.type) {
    case "drop-shadow":
      return expandFilterExtentsForShadow(extents, bounds, effect);
    case "inner-shadow":
      return expandFilterExtentsForInnerShadow(extents, bounds, effect);
    case "layer-blur":
      return expandFilterExtentsForLayerBlur(extents, bounds, effect);
    case "background-blur":
      return expandFilterExtentsForBackgroundBlur(extents, bounds, effect);
  }
}

function expandFilterExtentsForBackgroundBlur(
  extents: FilterExtents,
  bounds: FilterBounds,
  effect: Extract<Effect, { readonly type: "background-blur" }>,
): FilterExtents {
  const expand = effect.radius;
  return {
    minX: Math.min(extents.minX, bounds.x - expand),
    minY: Math.min(extents.minY, bounds.y - expand),
    maxX: Math.max(extents.maxX, bounds.x + bounds.width + expand),
    maxY: Math.max(extents.maxY, bounds.y + bounds.height + expand),
  };
}

/**
 * Compute filter region as the union of element bounds and all shadow regions.
 *
 * Each shadow extends the region by its offset + blur radius.
 * Without this, SVG's default 10% filter margin clips large shadows.
 */
export function resolveEffectBounds(
  effects: readonly Effect[],
  bounds: FilterBounds,
): FilterBounds {
  return filterExtentsToBounds(effects.reduce(
    (extents, effect) => expandFilterExtentsForEffect(extents, bounds, effect),
    initialFilterExtents(bounds),
  ));
}
