/**
 * @file Design-token types used by both the extractor and the emitter.
 *
 * Tokens are split by *kind* (color / typography / spacing / radius /
 * shadow). Each kind owns its own map keyed by the token's CSS-variable
 * name without the leading `--`. The CSS-variable name is also the SoT
 * key that JSX style emission references — there is no second naming
 * pass downstream.
 */
import type { FigEffect, FigPaint } from "@higma-document-models/fig/types";

/** A normalized RGBA color in 0..1 range — same shape as FigColor. */
export type TokenColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

export type ColorToken = {
  /** CSS variable name without the leading `--`, e.g. "color-primary-color-black". */
  readonly id: string;
  /** Source — `style` (from a Figma style proxy) or `usage` (deduped raw color). */
  readonly source: "style" | "usage";
  /** Original Figma style name (for `style` source) or undefined. */
  readonly figmaName?: string;
  readonly value: TokenColor;
};

export type TypographyToken = {
  readonly id: string;
  readonly fontFamily: string;
  readonly fontStyle: string;
  /** CSS-ready font-weight when known (Figma style strings like "Bold" → 700). */
  readonly fontWeight?: number;
  /** px size value as authored in Figma. */
  readonly fontSize: number;
  /**
   * Line-height in CSS form: `${number}px` for PIXELS units, `${number}%`
   * for PERCENT, or `"normal"` for AUTO. Undefined when no lineHeight.
   */
  readonly lineHeight?: string;
  /**
   * Letter-spacing in CSS form: `${number}px` or `${number}em`. Undefined
   * when zero / unset.
   */
  readonly letterSpacing?: string;
};

export type SpacingToken = {
  readonly id: string;
  /** px value. */
  readonly value: number;
};

export type RadiusToken = {
  readonly id: string;
  /** px value. */
  readonly value: number;
};

export type ShadowToken = {
  readonly id: string;
  /** Original Figma effect-style name (for `style` source) or undefined. */
  readonly figmaName?: string;
  readonly source: "style" | "usage";
  /** Pre-rendered CSS box-shadow value. */
  readonly cssValue: string;
};

export type TokenSet = {
  readonly colors: ReadonlyMap<string, ColorToken>;
  readonly typography: ReadonlyMap<string, TypographyToken>;
  readonly spacing: ReadonlyMap<string, SpacingToken>;
  readonly radii: ReadonlyMap<string, RadiusToken>;
  readonly shadows: ReadonlyMap<string, ShadowToken>;
};

/**
 * Lookup helpers used by the JSX emitter to resolve raw fig values
 * into token CSS-variable references. Built alongside the TokenSet so
 * the emitter does not have to re-derive ids.
 */
export type TokenIndex = {
  /** Map a SOLID paint to its color token id, or undefined when no token covers it. */
  readonly colorIdForPaint: (paint: FigPaint) => string | undefined;
  /** Map raw paint(s) to a single token id when the paint set is fully resolvable. */
  readonly colorIdForPaints: (paints: readonly FigPaint[] | undefined) => string | undefined;
  /** Map a px spacing value to its spacing token id. */
  readonly spacingIdFor: (value: number) => string | undefined;
  /** Map a px radius value to its radius token id. */
  readonly radiusIdFor: (value: number) => string | undefined;
  /** Map an effect array to a shadow token id. */
  readonly shadowIdFor: (effects: readonly FigEffect[] | undefined) => string | undefined;
  /**
   * Map a typography descriptor (family/style/size + optional metrics) to
   * a typography token id.
   */
  readonly typographyIdFor: (
    family: string,
    style: string,
    fontSize: number,
    lineHeight?: string,
    letterSpacing?: string,
  ) => string | undefined;
};
