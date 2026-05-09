/**
 * @file Small CSS-value parsers consumed by the normalizer.
 *
 * Scope: ONLY the value forms that real-browser computed-style emits.
 * `getComputedStyle` already resolves keywords / shorthands so we
 * never have to handle `border: 1px solid red` — it shows up as four
 * `border-*-width` props plus matching colour / style. That keeps
 * these parsers small and predictable. Anything outside the set we've
 * seen in computed-style output throws, so silent approximation is
 * impossible.
 */
import type { ColorIR, GradientStopIR, ImagePaintIR, LinearGradientPaintIR, PaintIR } from "@higma-bridges/web-fig";
import { cssToColorIR } from "@higma-bridges/web-fig";
import { FONT_WEIGHTS } from "@higma-document-models/fig/font";

/** Parse a `<length>` like `12px` / `0.5px`. Throws on non-px units. */
export function parsePx(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "auto" || trimmed === "none") {
    return 0;
  }
  if (trimmed.endsWith("px")) {
    const n = parseFloat(trimmed.slice(0, -2));
    if (!Number.isFinite(n)) {
      throw new Error(`parsePx: cannot parse "${value}"`);
    }
    return n;
  }
  // Computed style normalises every length to px on most browsers.
  // The only real exception is `line-height: normal`, handled by the
  // caller before reaching here.
  throw new Error(`parsePx: expected a px length, got "${value}"`);
}

/**
 * Lenient `parsePx` — returns `fallback` instead of throwing when the
 * input is `undefined`, an empty string, or a CSS keyword like
 * `normal`. Use at every caller that reads a property which can
 * legitimately be a keyword in computed style (`gap: normal`,
 * `column-gap: normal`, `letter-spacing: normal`, …).
 */
export function parsePxOr(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "auto" || trimmed === "none" || trimmed === "normal") {
    return fallback;
  }
  if (trimmed.endsWith("px")) {
    const n = parseFloat(trimmed.slice(0, -2));
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return n;
  }
  return fallback;
}

/**
 * Parse `font-weight` from computed style (always returns a number 1..1000).
 *
 * The CSS `font-weight` keyword set (`normal` / `bold` / `bolder` /
 * `lighter`) maps to the same numeric weight space `FontQuery` uses,
 * so we route the keyword cases through `FONT_WEIGHTS` rather than
 * inline literals. Anything that hard-codes `400` for "normal" or
 * `700` for "bold" elsewhere is duplicating this knowledge.
 *
 * `bolder` / `lighter` are CSS-specific relative keywords; they map
 * to the nearest standard weight that browsers actually compute when
 * the parent's resolved weight is the spec's default 400. We accept
 * that approximation because the input here is already-resolved
 * computed style rather than authored markup.
 */
export function parseFontWeight(value: string): number {
  const trimmed = value.trim();
  switch (trimmed) {
    case "normal":
      return FONT_WEIGHTS.REGULAR;
    case "bold":
      return FONT_WEIGHTS.BOLD;
    case "bolder":
      return FONT_WEIGHTS.BOLD;
    case "lighter":
      return FONT_WEIGHTS.LIGHT;
  }
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`parseFontWeight: cannot parse "${value}"`);
  }
  return n;
}

export type BackgroundLayer = {
  /** CSS `background-size`. Defaults to `auto` per the CSS spec. */
  readonly size?: string;
  /** CSS `background-repeat`. Defaults to `repeat` per the CSS spec. */
  readonly repeat?: string;
};

/**
 * Map a CSS `background-size` / `background-repeat` pair onto the
 * IR's `scaleMode` enum (`cover | contain | tile | stretch`).
 *
 *   `cover`                       → cover
 *   `contain`                     → contain
 *   `100% 100%` / `100%`          → stretch
 *   `auto` (or omitted) + repeat  → tile (intrinsic size, repeated)
 *   `auto` (or omitted) + no-rep. → contain (intrinsic-size single
 *                                   instance has no faithful IR map;
 *                                   `contain` keeps the image inside
 *                                   the container and preserves its
 *                                   aspect ratio, which is closer to
 *                                   the source than the previous
 *                                   blanket `cover` fallback)
 *
 * Pre-this-function the normaliser hard-coded `"cover"` for every
 * background, which forced images like Wikipedia's
 * "Wikipedia-logo-v2-200px-transparent.png" decorative overlay to
 * paint across the whole frame instead of staying at their intrinsic
 * footprint. The new map respects the captured CSS so decorative
 * overlays land in roughly the right place.
 */
function backgroundScaleMode(layer: BackgroundLayer): ImagePaintIR["scaleMode"] {
  const size = (layer.size ?? "auto").trim().toLowerCase();
  if (size === "cover") {
    return "cover";
  }
  if (size === "contain") {
    return "contain";
  }
  if (size === "100% 100%" || size === "100%") {
    return "stretch";
  }
  const repeat = (layer.repeat ?? "repeat").trim().toLowerCase();
  if (repeat === "no-repeat") {
    return "contain";
  }
  return "tile";
}

/**
 * Parse `background-image` into a list of paints. The leftmost gradient
 * paints last in CSS but first in our IR's bottom-up `fills` array, so
 * the caller is responsible for reversing.
 *
 * Supported forms:
 *   - `none` → no paints
 *   - `linear-gradient(<angle>?, <stops>)`
 *   - `url(...)` → an image paint
 *
 * `layer` carries the matching `background-size` / `background-repeat`
 * so the image paint inherits a `scaleMode` faithful to the CSS
 * declaration. Callers that don't pass it get the spec defaults
 * (`auto` / `repeat`), which collapses to a `tile` paint — every
 * site uses sized backgrounds explicitly anyway.
 */
export function parseBackgroundImage(
  value: string,
  imageId: string | undefined,
  layer: BackgroundLayer = {},
): readonly PaintIR[] {
  const trimmed = value.trim();
  if (trimmed === "none" || trimmed === "") {
    return [];
  }
  const tokens = splitTopLevelCommas(trimmed);
  const out: PaintIR[] = [];
  const scaleMode = backgroundScaleMode(layer);
  for (const token of tokens) {
    const tok = token.trim();
    if (tok.startsWith("linear-gradient(")) {
      out.push(parseLinearGradient(tok));
      continue;
    }
    if (tok.startsWith("url(")) {
      if (!imageId) {
        throw new Error(`parseBackgroundImage: url() found but no imageId provided for "${value}"`);
      }
      out.push({ kind: "image", imageId, scaleMode });
      continue;
    }
    throw new Error(`parseBackgroundImage: unsupported background-image token "${tok}"`);
  }
  return out;
}

function parseLinearGradient(input: string): LinearGradientPaintIR {
  const inner = input.slice("linear-gradient(".length, -1);
  const parts = splitTopLevelCommas(inner);
  if (parts.length === 0) {
    throw new Error(`parseLinearGradient: empty body in "${input}"`);
  }
  const first = parts[0]!.trim();
  const hasAngleHeader = first.endsWith("deg") || first.startsWith("to ");
  // CSS default: top → bottom (180deg).
  const angle = hasAngleHeader ? parseAngleSpec(first) : 180;
  const stopParts = hasAngleHeader ? parts.slice(1) : parts;
  const stops: GradientStopIR[] = stopParts.map((part, index) =>
    parseGradientStop(part.trim(), index, stopParts.length),
  );
  return { kind: "linear-gradient", angle, stops };
}

function parseAngleSpec(value: string): number {
  if (value.endsWith("deg")) {
    return parseFloat(value.slice(0, -3));
  }
  if (value === "to top") {
    return 0;
  }
  if (value === "to right") {
    return 90;
  }
  if (value === "to bottom") {
    return 180;
  }
  if (value === "to left") {
    return 270;
  }
  if (value === "to top right" || value === "to right top") {
    return 45;
  }
  if (value === "to bottom right" || value === "to right bottom") {
    return 135;
  }
  if (value === "to bottom left" || value === "to left bottom") {
    return 225;
  }
  if (value === "to top left" || value === "to left top") {
    return 315;
  }
  throw new Error(`parseLinearGradient: unsupported angle spec "${value}"`);
}

function parseGradientStop(value: string, index: number, total: number): GradientStopIR {
  const parts = value.split(/\s+/);
  if (parts.length === 1) {
    return {
      position: total === 1 ? 0 : index / (total - 1),
      color: parseColor(parts[0]!),
    };
  }
  const color = parseColor(parts[0]!);
  const positionToken = parts[1]!;
  if (!positionToken.endsWith("%")) {
    throw new Error(`parseGradientStop: only percent stops supported, got "${value}"`);
  }
  return { position: parseFloat(positionToken.slice(0, -1)) / 100, color };
}

/** Parse a `<color>` computed-style value (always functional rgb / rgba). */
export function parseColor(value: string): ColorIR {
  return cssToColorIR(value);
}

/**
 * Parse `box-shadow` value list into IR shadow effects.
 *
 * Shape from `getComputedStyle`: each shadow is `<color> <ox> <oy> <blur> [<spread>] [inset]`.
 * Multiple shadows are comma-separated.
 */
export function parseBoxShadow(value: string): readonly { readonly inset: boolean; readonly color: ColorIR; readonly offsetX: number; readonly offsetY: number; readonly blurRadius: number; readonly spread: number }[] {
  const trimmed = value.trim();
  if (trimmed === "none" || trimmed === "") {
    return [];
  }
  const items = splitTopLevelCommas(trimmed);
  return items.map((item) => parseSingleShadow(item.trim()));
}

function parseSingleShadow(input: string): { readonly inset: boolean; readonly color: ColorIR; readonly offsetX: number; readonly offsetY: number; readonly blurRadius: number; readonly spread: number } {
  const inset = / inset\b/.test(input) || /^inset /.test(input);
  const cleaned = input.replace(/(^inset )|( inset)/g, "").trim();

  // Pull off the colour: computed style always emits the colour first
  // as a functional `rgb(...)` / `rgba(...)`. Extract that, then the
  // remaining tokens are lengths.
  const colorMatch = cleaned.match(/^(rgba?\([^)]+\)|#[0-9a-fA-F]+|\w+)/);
  if (!colorMatch) {
    throw new Error(`parseBoxShadow: cannot find a leading colour in "${input}"`);
  }
  const color = parseColor(colorMatch[0]!);
  const rest = cleaned.slice(colorMatch[0]!.length).trim();
  const lengths = rest.split(/\s+/).filter((t) => t.length > 0).map((t) => parsePx(t));
  if (lengths.length < 2) {
    throw new Error(`parseBoxShadow: not enough length tokens in "${input}"`);
  }
  return {
    inset,
    color,
    offsetX: lengths[0]!,
    offsetY: lengths[1]!,
    blurRadius: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
  };
}

/**
 * Split a CSS value at top-level commas, respecting balanced
 * parentheses (so `rgb(0,0,0)` survives as a single token).
 *
 * Implemented as a single-pass state machine — depth and last-cut
 * position are intrinsically mutable across the loop. Wrapping each
 * step in its own function would obscure the linear nature of the
 * scan without changing the semantics.
 */
function splitTopLevelCommas(value: string): readonly string[] {
  // eslint-disable-next-line no-restricted-syntax -- state machine: depth & last-cut intrinsically mutable
  let depth = 0;
  // eslint-disable-next-line no-restricted-syntax -- see above
  let last = 0;
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i]!;
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      out.push(value.slice(last, i));
      last = i + 1;
    }
  }
  out.push(value.slice(last));
  return out;
}
