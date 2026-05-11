/**
 * @file Variable-font wght-axis application for opentype.js Fonts.
 *
 * SF Pro / SFNS / Roboto Flex and other modern OS fonts ship as a
 * single variable font file. opentype.js parses the `fvar` table and
 * exposes `font.variation.getTransform(glyph, axes)` to apply a
 * coordinate point, but its high-level `glyph.getPath(x, y, size)`
 * path — the one the path renderer in `text/paths/opentype-paths.ts`
 * calls per-glyph — does NOT consult `font.defaultRenderOptions`, so
 * variations never reach the rendered outline. Without this layer the
 * renderer paints SF Pro at the file's default instance regardless of
 * the requested CSS `font-weight`, and `example-com-fullpage` shows
 * a ~0.4% diff with every glyph mis-positioned.
 *
 * This module wraps a parsed opentype.js Font so the
 * `charToGlyph(c).getPath(x, y, fontSize)` call path applies a fixed
 * variation point. The wrapper is purely a view — the original Font
 * is untouched, so different consumers can request different
 * variation points off the same parsed buffer without aliasing each
 * other's renderings.
 *
 * `wght` is the CSS-mapped axis; `wdth` and `opsz` use the font's
 * declared defaults unless the caller passes overrides. Stretched
 * (`font-stretch`) and optical-size rendering will need additional
 * mappings — they are out of scope here because `web-to-fig` does not
 * yet carry those CSS properties through to the IR.
 */
import type { AbstractFont, AbstractGlyph, FontPath } from "@higma-document-models/fig/font";

/**
 * Subset of the opentype.js Font shape we need to wrap. Avoiding a
 * direct `opentype.Font` import keeps the renderer typesystem free of
 * the opentype.js types — those still live behind the AbstractFont
 * boundary.
 */
type OpentypeVariationAxis = {
  readonly tag: string;
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
};

type OpentypeVariationApi = {
  /**
   * Return the variation-applied path + advanceWidth for `glyph` at
   * the given axis coordinates. Coordinates are absolute (e.g.
   * `{wght: 700}`), not normalised. opentype.js 1.3.x exposes this
   * under `font.variation`.
   */
  getTransform(
    glyph: unknown,
    axes: Readonly<Record<string, number>>,
  ): {
    readonly path: FontPath;
    readonly advanceWidth: number;
  };
};

type OpentypeFontShape = AbstractFont & {
  readonly tables?: AbstractFont["tables"] & {
    readonly fvar?: {
      readonly axes?: readonly OpentypeVariationAxis[];
    };
  };
  readonly variation?: OpentypeVariationApi;
  /**
   * opentype.js exposes `font.getKerningValue(left, right)` covering
   * both the legacy `kern` table and the modern GPOS pair adjustment
   * lookup. Typed loosely here so the wrapper can forward without
   * pulling the full opentype.js types into the renderer's surface.
   */
  getKerningValue?(leftGlyph: AbstractGlyph | number, rightGlyph: AbstractGlyph | number): number;
};

/**
 * Inspect a Font for an `fvar` table. Returns the parsed axes when
 * the font carries variations; returns `undefined` for static fonts
 * so callers can skip the wrapping step entirely.
 */
export function getVariableAxes(font: AbstractFont): readonly OpentypeVariationAxis[] | undefined {
  const shape = font as OpentypeFontShape;
  const axes = shape.tables?.fvar?.axes;
  if (axes === undefined || axes.length === 0) {
    return undefined;
  }
  return axes;
}

/**
 * Marker checked by `setVariationOpticalSize` to recognise a Font
 * built by `wrapFontWithVariation`. Avoids `instanceof`, which would
 * leak the renderer's class hierarchy into consumers, and lets the
 * type stay structural-only — `text/paths/opentype-paths.ts` and any
 * other callsite simply asks "is this a Font I can tune optical size
 * on?".
 */
const VARIATION_VIEW_MARKER: unique symbol = Symbol("variation-font-view");

/**
 * Tell a Font wrapped by `wrapFontWithVariation` to apply the given
 * `opsz` (CSS-pixel font-size) for subsequent glyph-path requests.
 * No-op when the Font isn't a variation view, so callers can call it
 * unconditionally and it's free for static fonts.
 *
 * Modern CSS browsers default to `font-optical-sizing: auto`, feeding
 * the rendered `font-size` value into the `opsz` axis. The renderer
 * has to mirror that or per-character glyph widths drift from the
 * captured screenshot (small text gets too wide, large text too
 * narrow). The `opsz` axis is clamped to the font's declared range.
 */
export function setVariationOpticalSize(font: AbstractFont, fontSizePx: number): void {
  const view = font as unknown as { [VARIATION_VIEW_MARKER]?: VariationFontView };
  view[VARIATION_VIEW_MARKER]?.setOpticalSize(fontSizePx);
}

/**
 * Build the variation-coordinate map for a CSS weight on a Font that
 * carries `fvar`. Axis defaults are honoured for `wdth` (no
 * `font-stretch` plumbing yet); `wght` is clamped to the axis's
 * declared min/max so values like `font-weight: 100` on a font whose
 * `wght` axis starts at 30 still round-trip to the lightest weight
 * the font actually carries.
 *
 * `opsz` (optical size, present on SF Pro / Roboto Flex / Inter
 * variable) is set to `fontSizePx` when supplied. Modern browsers
 * apply `font-optical-sizing: auto` by default, which feeds the
 * CSS-pixel `font-size` value into the `opsz` axis — leaving `opsz`
 * at the file's default (28 on SFNS) renders every glyph at a single
 * optical instance and produces noticeably different glyph widths
 * from the captured screenshot.
 */
export function variationForWeight(
  axes: readonly OpentypeVariationAxis[],
  weight: number,
  fontSizePx?: number,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const axis of axes) {
    if (axis.tag === "wght") {
      const clamped = Math.min(axis.maxValue, Math.max(axis.minValue, weight));
      out.wght = clamped;
      continue;
    }
    if (axis.tag === "opsz" && fontSizePx !== undefined) {
      const clamped = Math.min(axis.maxValue, Math.max(axis.minValue, fontSizePx));
      out.opsz = clamped;
      continue;
    }
    out[axis.tag] = axis.defaultValue;
  }
  return out;
}

/**
 * Wrap an opentype.js Font so every `charToGlyph(c).getPath(...)`
 * call applies the given variation coordinates. The original Font is
 * not mutated — the wrapper holds it by reference and produces
 * variation-applied glyph objects on demand.
 *
 * Throws when the supplied Font has no `variation` API; that's an
 * indication the parsed buffer is a static font, in which case the
 * caller should keep the original Font unchanged.
 */
export function wrapFontWithVariation(
  font: AbstractFont,
  variation: Readonly<Record<string, number>>,
  axes: readonly OpentypeVariationAxis[],
): AbstractFont {
  const shape = font as OpentypeFontShape;
  const variationApi = shape.variation;
  if (variationApi === undefined) {
    throw new Error(
      "wrapFontWithVariation: Font does not expose a `variation` API — only opentype.js >=1.3 variable fonts are supported.",
    );
  }
  return new VariationFontView(shape, variationApi, variation, axes);
}

/**
 * View over a Font that re-routes per-glyph path extraction through
 * the variation API. Implements `AbstractFont` so the renderer's
 * existing glyph-walking loop in
 * `text/paths/opentype-paths.ts` consumes it without any changes.
 */
class VariationFontView implements AbstractFont {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly tables?: AbstractFont["tables"];
  readonly [VARIATION_VIEW_MARKER]: VariationFontView;

  private readonly inner: OpentypeFontShape;
  private readonly variationApi: OpentypeVariationApi;
  private variation: Record<string, number>;
  private readonly axes: readonly OpentypeVariationAxis[];
  // Memoise variation-applied glyph views per character. opentype.js
  // path interpolation is the hot path during text rendering — a
  // single line of `"Example Domain"` produces a dozen lookups, every
  // multi-line paragraph repeats common characters, and
  // `text-comprehensive` walks tens of thousands of glyphs. Without
  // memoisation the renderer times out at >5s on what was previously
  // a sub-second test.
  private readonly cache: Map<string, VariationGlyphView> = new Map();

  constructor(
    inner: OpentypeFontShape,
    variationApi: OpentypeVariationApi,
    variation: Readonly<Record<string, number>>,
    axes: readonly OpentypeVariationAxis[],
  ) {
    this.inner = inner;
    this.variationApi = variationApi;
    this.variation = { ...variation };
    this.axes = axes;
    this.unitsPerEm = inner.unitsPerEm;
    this.ascender = inner.ascender;
    this.descender = inner.descender;
    this.tables = inner.tables;
    this[VARIATION_VIEW_MARKER] = this;
  }

  /**
   * Pin the `opsz` (optical size) axis to the font file's declared
   * default and discard any cached glyph views so subsequent
   * `charToGlyph` calls re-derive the path. Called by the path
   * renderer at the top of each text run.
   *
   * Why a fixed default rather than the CSS-spec mapping: CSS Fonts L4
   * defines `font-optical-sizing: auto` as `opsz = font-size-pt`, but
   * Playwright's headless Chromium on macOS does not implement this —
   * empirical probing of `Range.getBoundingClientRect` on a `system-ui`
   * paragraph at 16 px and 24 px lands within ~6 px of SFNS at
   * `opsz=28` (the axis default) in both cases, while the CSS-spec
   * pt mapping (`opsz=12` and `opsz=18` respectively) overshoots by
   * 30 px on the body line and 13 px on the headline. The verifier's
   * job is to mirror what the browser actually paints, not what the
   * spec says it should — drift from the browser's behaviour is what
   * the pixel diff detects, and matching the captured screenshot is
   * the SoT.
   *
   * `fontSizePx` is kept in the signature for API stability; the
   * variable-font wrapper used to drive `opsz` from it under the
   * spec mapping. If/when headless Chromium starts implementing
   * `font-optical-sizing: auto` correctly we can re-introduce the
   * mapping here without touching call sites.
   *
   * No-op when the font has no `opsz` axis (e.g. SF Mono's variable
   * variant only carries `wght`); leaves the axis at its current value
   * otherwise.
   */
  setOpticalSize(fontSizePx: number): void {
    void fontSizePx;
    const opszAxis = this.axes.find((a) => a.tag === "opsz");
    if (opszAxis === undefined) {
      return;
    }
    const target = opszAxis.defaultValue;
    if (this.variation.opsz === target) {
      return;
    }
    this.variation.opsz = target;
    this.cache.clear();
  }

  charToGlyph(char: string): AbstractGlyph {
    const cached = this.cache.get(char);
    if (cached !== undefined) {
      return cached;
    }
    const rawGlyph = this.inner.charToGlyph(char);
    const view = new VariationGlyphView(rawGlyph, this.variationApi, this.variation, this.unitsPerEm);
    this.cache.set(char, view);
    return view;
  }

  /**
   * Delegate kerning lookup to the inner opentype.js Font. The
   * variation axes don't influence pair-adjustment values (kerning is
   * a glyph-pair geometry hint, not an outline interpolation), so the
   * inner Font's table is the SoT and the wrapper just forwards.
   */
  getKerningValue(leftGlyph: AbstractGlyph, rightGlyph: AbstractGlyph): number {
    const inner = this.inner.getKerningValue;
    if (typeof inner !== "function") {
      return 0;
    }
    return inner.call(this.inner, leftGlyph, rightGlyph);
  }

  getPath(text: string, x: number, y: number, fontSize: number, options?: { letterSpacing?: number }): FontPath {
    // The renderer doesn't actually call `font.getPath` for path
    // extraction — it walks per-glyph — but `AbstractFont` requires
    // the method for other consumers (text measurer). Delegate to the
    // inner Font's high-level path because opentype.js's own
    // `getPath` already honours variation when an axis map is
    // threaded through via `defaultRenderOptions.variation`. We
    // therefore set the variation here as a transient default.
    const inner = this.inner as { defaultRenderOptions?: { variation?: Readonly<Record<string, number>> } };
    const previous = inner.defaultRenderOptions?.variation;
    inner.defaultRenderOptions = { ...(inner.defaultRenderOptions ?? {}), variation: this.variation };
    try {
      return this.inner.getPath(text, x, y, fontSize, options);
    } finally {
      if (previous === undefined) {
        delete inner.defaultRenderOptions?.variation;
      } else {
        inner.defaultRenderOptions = { ...(inner.defaultRenderOptions ?? {}), variation: previous };
      }
    }
  }
}

class VariationGlyphView implements AbstractGlyph {
  readonly index: number;
  readonly advanceWidth: number | undefined;

  private readonly variation: Readonly<Record<string, number>>;
  private readonly unitsPerEm: number;
  // Cache the variation-applied transform from the constructor. The
  // renderer reads `advanceWidth` first (in
  // `calculateMixedFontTextWidth`) and then `getPath` (in the same
  // glyph-walking loop), so the same transform is requested twice in
  // immediate succession. Computing it once and reusing the path
  // for `getPath` cuts variation cost in half — important for
  // long-form pages where opentype.js's interpolation dominates
  // render time.
  private readonly cachedPath: FontPath;

  constructor(
    rawGlyph: AbstractGlyph,
    variationApi: OpentypeVariationApi,
    variation: Readonly<Record<string, number>>,
    unitsPerEm: number,
  ) {
    this.variation = variation;
    this.unitsPerEm = unitsPerEm;
    this.index = rawGlyph.index;
    const transform = variationApi.getTransform(rawGlyph, variation);
    this.advanceWidth = transform.advanceWidth;
    this.cachedPath = transform.path;
  }

  getPath(x: number, y: number, fontSize: number): FontPath {
    // `getTransform` already accounted for `variation`; we only need
    // to position and scale the cached path. opentype.js paths are
    // y-up in font units; the renderer treats `y` as the y-down
    // baseline, so the scale step flips y.
    const scale = fontSize / this.unitsPerEm;
    return scaleAndTranslatePath(this.cachedPath, x, y, scale);
  }
}

/**
 * Apply a uniform scale + translate to every command in a FontPath.
 * The y axis flips because opentype.js paths are y-up but the
 * renderer treats `y` as the screen-space baseline (y-down).
 */
function scaleAndTranslatePath(
  source: FontPath,
  x: number,
  y: number,
  scale: number,
): FontPath {
  const commands = source.commands.map((command) => {
    switch (command.type) {
      case "M":
      case "L":
        return {
          type: command.type,
          x: x + (command.x ?? 0) * scale,
          y: y + (command.y ?? 0) * -scale,
        };
      case "Q":
        return {
          type: command.type,
          x: x + (command.x ?? 0) * scale,
          y: y + (command.y ?? 0) * -scale,
          x1: x + (command.x1 ?? 0) * scale,
          y1: y + (command.y1 ?? 0) * -scale,
        };
      case "C":
        return {
          type: command.type,
          x: x + (command.x ?? 0) * scale,
          y: y + (command.y ?? 0) * -scale,
          x1: x + (command.x1 ?? 0) * scale,
          y1: y + (command.y1 ?? 0) * -scale,
          x2: x + (command.x2 ?? 0) * scale,
          y2: y + (command.y2 ?? 0) * -scale,
        };
      case "Z":
        return { type: "Z" as const };
    }
  });
  return {
    commands,
    toPathData: source.toPathData.bind(source),
  };
}
