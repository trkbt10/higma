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
import type { PathCommand } from "@higma-primitives/path";

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
 * CoreText-on-macOS calibrated `opsz` curve.
 *
 * Chromium delegates `font-optical-sizing: auto` to the platform shaper.
 * On macOS that is CoreText, which doesn't follow the CSS Fonts L4
 * `opsz = font-size-pt` rule: it lands `opsz` somewhere between the
 * spec's `pt` value and the font's `Display` instance, with a
 * saturating curve above ~20px font-size. Driving SFNS at the CSS
 * spec mapping leaves SFNS's body text ~9% narrower than what
 * Chromium paints — a 65px drift on a 100-character paragraph at
 * fontSize=16.
 *
 * The mapping below is fitted from per-glyph advance measurements of
 * Chromium's `system-ui` ('T' × 20 at fontSizes 10..64) against
 * `opentype.js`'s `Font.variation.getTransform` HVAR output on
 * `/System/Library/Fonts/SFNS.ttf`. Each entry pins the `opsz` that
 * reproduces Chromium's advance for that font-size. Outside the
 * tabulated range the curve clamps to the endpoint values; inside,
 * linear interpolation reproduces the observed shape closely enough
 * that the 9-case Inter regression set holds and example-com-fullpage
 * drops to a fraction of its previous diff.
 *
 * Recalibration: if Chromium / CoreText ships an opsz behaviour
 * change, run `probe-chrome-opsz-curve` (in this repo's history) and
 * update the table. The mapping is exposed as a pure function so
 * tests can swap it out for a calibration-free identity when
 * exercising other variable fonts.
 */
const CORE_TEXT_OPSZ_TABLE: ReadonlyArray<readonly [number, number]> = [
  [12, 17],
  [14, 19.5],
  [16, 21],
  [18, 22],
  [20, 23],
  [24, 23.5],
  [32, 23.5],
  [48, 25],
  [64, 26.5],
];

/**
 * Map a CSS-pixel font-size to the `opsz` axis value Chromium-on-macOS
 * effectively uses for variable fonts. Linear-interpolates inside the
 * tabulated range, clamps outside. See `CORE_TEXT_OPSZ_TABLE` for the
 * calibration source.
 */
export function coreTextOpticalSizeForFontSize(fontSizePx: number): number {
  if (!Number.isFinite(fontSizePx)) {
    return CORE_TEXT_OPSZ_TABLE[0]![1];
  }
  if (fontSizePx <= CORE_TEXT_OPSZ_TABLE[0]![0]) {
    return CORE_TEXT_OPSZ_TABLE[0]![1];
  }
  if (fontSizePx >= CORE_TEXT_OPSZ_TABLE[CORE_TEXT_OPSZ_TABLE.length - 1]![0]) {
    return CORE_TEXT_OPSZ_TABLE[CORE_TEXT_OPSZ_TABLE.length - 1]![1];
  }
  for (let i = 0; i < CORE_TEXT_OPSZ_TABLE.length - 1; i += 1) {
    const [s0, o0] = CORE_TEXT_OPSZ_TABLE[i]!;
    const [s1, o1] = CORE_TEXT_OPSZ_TABLE[i + 1]!;
    if (fontSizePx >= s0 && fontSizePx <= s1) {
      const t = (fontSizePx - s0) / (s1 - s0);
      return o0 + (o1 - o0) * t;
    }
  }
  return CORE_TEXT_OPSZ_TABLE[CORE_TEXT_OPSZ_TABLE.length - 1]![1];
}

/** Clamp an `opsz` value to the font's declared axis range. */
function clampOpsz(axis: OpentypeVariationAxis, value: number): number {
  return Math.min(axis.maxValue, Math.max(axis.minValue, value));
}

/** Apply renderer font-size to a variation-font view's optical-size axis. */
export function setVariationOpticalSize(font: AbstractFont, fontSizePx: number): void {
  font.setOpticalSize?.(fontSizePx);
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
  return createVariationFontView(shape, variationApi, variation, axes);
}

function createVariationFontView(
  inner: OpentypeFontShape,
  variationApi: OpentypeVariationApi,
  initialVariation: Readonly<Record<string, number>>,
  axes: readonly OpentypeVariationAxis[],
): AbstractFont {
  const variation: Record<string, number> = { ...initialVariation };
  // Memoise variation-applied glyph views per character. opentype.js
  // path interpolation is the hot path during text rendering — a
  // single line of `"Example Domain"` produces a dozen lookups, every
  // multi-line paragraph repeats common characters, and
  // `text-comprehensive` walks tens of thousands of glyphs.
  const cache = new Map<string, AbstractGlyph>();
  const setOpticalSize = (fontSizePx: number): void => {
    const opszAxis = axes.find((axis) => axis.tag === "opsz");
    if (opszAxis === undefined) {
      return;
    }
    const target = clampOpsz(opszAxis, coreTextOpticalSizeForFontSize(fontSizePx));
    if (variation.opsz === target) {
      return;
    }
    variation.opsz = target;
    cache.clear();
  };
  return {
    unitsPerEm: inner.unitsPerEm,
    ascender: inner.ascender,
    descender: inner.descender,
    ...(inner.tables === undefined ? {} : { tables: inner.tables }),
    setOpticalSize,
    charToGlyph: (char) => {
      const cached = cache.get(char);
      if (cached !== undefined) {
        return cached;
      }
      const rawGlyph = inner.charToGlyph(char);
      const view = createVariationGlyphView(rawGlyph, variationApi, variation, inner.unitsPerEm);
      cache.set(char, view);
      return view;
    },
    // Forward `substituteGlyph` from the inner font and wrap the
    // returned glyph in the same variation transform `charToGlyph`
    // applies. Without this, a variable font ringed through
    // `wrapFontWithVariation` after `wrapFontWithSmallCaps` would
    // lose access to the smcp / c2sc surface — the wrapper builds a
    // fresh object and doesn't forward arbitrary keys.
    ...(inner.substituteGlyph === undefined ? {} : {
      substituteGlyph: ((char: string, feature: "smcp" | "c2sc"): AbstractGlyph | undefined => {
        const innerSub = inner.substituteGlyph;
        if (innerSub === undefined) { return undefined; }
        const substituted = innerSub.call(inner, char, feature);
        if (substituted === undefined) { return undefined; }
        return createVariationGlyphView(substituted, variationApi, variation, inner.unitsPerEm);
      }),
    }),
    getKerningValue: (leftGlyph, rightGlyph) => {
      const innerKerning = inner.getKerningValue;
      if (typeof innerKerning !== "function") {
        return 0;
      }
      return innerKerning.call(inner, leftGlyph, rightGlyph);
    },
    getPath: (text, x, y, fontSize, options) => {
      // The renderer doesn't actually call `font.getPath` for path
      // extraction — it walks per-glyph — but `AbstractFont` requires
      // the method for other consumers. Delegate to opentype.js's
      // high-level path after threading the current variation map.
      const fontWithDefaults = inner as { defaultRenderOptions?: { variation?: Readonly<Record<string, number>> } };
      const previous = fontWithDefaults.defaultRenderOptions?.variation;
      fontWithDefaults.defaultRenderOptions = { ...(fontWithDefaults.defaultRenderOptions ?? {}), variation };
      try {
        return inner.getPath(text, x, y, fontSize, options);
      } finally {
        if (previous === undefined) {
          delete fontWithDefaults.defaultRenderOptions?.variation;
        } else {
          fontWithDefaults.defaultRenderOptions = { ...(fontWithDefaults.defaultRenderOptions ?? {}), variation: previous };
        }
      }
    },
  };
}

function createVariationGlyphView(
  rawGlyph: AbstractGlyph,
  variationApi: OpentypeVariationApi,
  variation: Readonly<Record<string, number>>,
  unitsPerEm: number,
): AbstractGlyph {
  // Cache the variation-applied transform at creation. The renderer
  // reads `advanceWidth` first and then `getPath`, so reusing one
  // transform halves the hot-path interpolation work.
  const transform = variationApi.getTransform(rawGlyph, variation);
  return {
    index: rawGlyph.index,
    advanceWidth: transform.advanceWidth,
    getPath: (x, y, fontSize) => {
      const scale = fontSize / unitsPerEm;
      return scaleAndTranslatePath(transform.path, x, y, scale);
    },
  };
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
  const commands: PathCommand[] = source.commands.map((command): PathCommand => {
    switch (command.type) {
      case "M":
      case "L":
        return {
          type: command.type,
          x: x + command.x * scale,
          y: y + command.y * -scale,
        };
      case "Q":
        return {
          type: "Q",
          x: x + command.x * scale,
          y: y + command.y * -scale,
          x1: x + command.x1 * scale,
          y1: y + command.y1 * -scale,
        };
      case "C":
        return {
          type: "C",
          x: x + command.x * scale,
          y: y + command.y * -scale,
          x1: x + command.x1 * scale,
          y1: y + command.y1 * -scale,
          x2: x + command.x2 * scale,
          y2: y + command.y2 * -scale,
        };
      case "A":
        // opentype.js never emits Arc commands — TrueType / OTF outlines
        // are M/L/Q/C/Z only — but the canonical `PathCommand` union
        // includes Arc to cover the SVG-`d` decoder channel. Fail
        // loudly if an Arc somehow reaches the font driver; silently
        // ignoring it would lose glyph geometry.
        throw new Error(
          "scaleAndTranslatePath: unexpected SVG Arc command in opentype FontPath — font drivers only emit M/L/C/Q/Z",
        );
      case "Z":
        return { type: "Z" };
    }
  });
  return {
    commands,
    toPathData: source.toPathData.bind(source),
  };
}
