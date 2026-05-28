/**
 * @file `TokenSet` — the unified, source-agnostic token shape this
 * package both produces (via `extract/`) and consumes (via `emit/`).
 *
 * Two ingestion paths converge here:
 *
 *   - **Figma Variables** — first-class typed values with modes. A
 *     single token carries one value per mode under `valuesByMode`.
 *     `defaultModeName` names the mode the consumer's `:root` block
 *     (or any other mode-less surface) should use.
 *   - **Figma Styles** — paint / typography / effect style proxies
 *     enumerated by `buildFigStyleRegistry`. Modeless; the `valuesByMode`
 *     map carries exactly one entry whose key matches `defaultModeName`.
 *
 * That single-shape policy keeps the emitter free of source-specific
 * branching: it iterates `valuesByMode` regardless of origin and
 * decides selector / nesting purely from the token's `groupName` and
 * `valuesByMode` keys.
 *
 * `valueKind` discriminates the payload shape so the emitter can
 * choose the right rendering (hex / number / typography expansion /
 * shadow). Composite types like typography carry already-CSS-ready
 * sub-properties; the emitter does not re-do unit / family lookup.
 */

/** Hex `#rrggbb` or `rgba(...)` colour. Already CSS-shaped. */
export type ColorValue = { readonly kind: "color"; readonly css: string };

/** Number with optional unit suffix, e.g. `{ value: 16, unit: "px" }`. */
export type NumberValue = {
  readonly kind: "number";
  readonly value: number;
  readonly unit: "px" | "em" | "rem" | "%" | null;
};

export type BooleanValue = { readonly kind: "boolean"; readonly value: boolean };

export type StringValue = { readonly kind: "string"; readonly value: string };

/**
 * Composite typography record. The CSS emitter expands this into one
 * variable per sub-property (`--<id>-font-family`, `-font-size`, etc.)
 * so consumers can mix and match. The DTCG emitter keeps it nested.
 */
export type TypographyValue = {
  readonly kind: "typography";
  readonly fontFamily: string;
  readonly fontWeight: number | undefined;
  /** Pre-formatted CSS, e.g. `"16px"`. */
  readonly fontSize: string;
  /** Pre-formatted CSS, e.g. `"24px"` / `"150%"` / `"normal"`. */
  readonly lineHeight: string | undefined;
  /** Pre-formatted CSS, e.g. `"0.05em"` / `"0.5px"`. */
  readonly letterSpacing: string | undefined;
};

/** A single CSS `box-shadow` value (already concatenated for multi-layer shadows). */
export type ShadowValue = { readonly kind: "shadow"; readonly css: string };

/** Generic CSS literal (gradients, blurs, anything pre-formatted). */
export type RawCssValue = { readonly kind: "raw-css"; readonly css: string };

export type TokenValue =
  | ColorValue
  | NumberValue
  | BooleanValue
  | StringValue
  | TypographyValue
  | ShadowValue
  | RawCssValue;

export type TokenSource = "variable" | "style";

export type Token = {
  /**
   * Slash-separated path used as the JSON nesting key, e.g.
   * `"Colors/Brand/Primary"`. The CSS id is derived by replacing `/` +
   * unsafe chars with `-` so a token always has one stable JSON path
   * and one stable CSS variable id.
   */
  readonly path: string;
  /** CSS variable id without leading `--`. */
  readonly cssId: string;
  /** `variable` or `style` — preserved for downstream consumers. */
  readonly source: TokenSource;
  /**
   * For variable-sourced tokens: the VARIABLE_SET's slug; the CSS
   * emitter uses this to namespace mode selectors so multiple sets can
   * be toggled independently. `null` for style-sourced tokens.
   */
  readonly variableSetSlug: string | null;
  /** Display name of the variable set (preserved for `$extensions`). */
  readonly variableSetName: string | null;
  /**
   * Mode-keyed values. For style-sourced tokens this carries exactly
   * one entry under `defaultModeName`.
   */
  readonly valuesByMode: ReadonlyMap<string, TokenValue>;
  /** The mode the CSS `:root` block uses (first mode of the variable set, or `"default"`). */
  readonly defaultModeName: string;
};

export type TokenSet = {
  readonly tokens: readonly Token[];
  /**
   * For each variable set slug, the ordered list of mode names. The CSS
   * emitter walks this to emit `[data-<slug>-mode="<name>"]` overrides
   * for every non-default mode.
   */
  readonly modesBySetSlug: ReadonlyMap<string, readonly string[]>;
};
