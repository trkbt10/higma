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
 *   `auto` + `repeat`             → tile (intrinsic size, repeated)
 *   `auto` + `no-repeat`          → THROWS — this case has no faithful
 *                                   single-paint mapping in Figma's IR
 *                                   (none of cover / contain / tile /
 *                                   stretch means "draw the image once
 *                                   at intrinsic size at a specific
 *                                   pixel offset, leave the rest
 *                                   transparent"). The normaliser must
 *                                   intercept the layer upstream and
 *                                   synthesise a natural-size child
 *                                   frame at the captured
 *                                   `background-position`. Throwing
 *                                   here keeps the SoT single — when
 *                                   we see the throw we know upstream
 *                                   forgot to take the synth path.
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
    throw new Error(
      `backgroundScaleMode: cannot map "background-size: ${layer.size ?? "auto"}; `
      + `background-repeat: no-repeat" to a single image-paint scaleMode — `
      + `caller must lift this layer out via the natural-size synth path before `
      + `invoking parseBackgroundImage`,
    );
  }
  return "tile";
}

/**
 * Decorative no-repeat backgrounds whose size is *not* the
 * container itself need to be lifted out of the host element's
 * fill and re-injected as a sized child frame. Three cases route
 * through the synth path:
 *
 *   1. `auto` / `auto auto` + `no-repeat` — natural-size single
 *      instance (Wikipedia's puzzle logo).
 *   2. `<length> <length>` / `<length>` + `no-repeat` — explicit
 *      pixel size (Yahoo's 15×15 inline SVG icon).
 *   3. `<length> auto` / `auto <length>` + `no-repeat` — partial
 *      explicit; resolved against the natural aspect ratio.
 *
 * Container-filling sizes (`cover`, `contain`, `100% 100%`,
 * `100%`) keep using the single image-paint mapping; tiled
 * (`repeat`) keeps using TILE.
 */
export function isNaturalSizeNoRepeatLayer(layer: BackgroundLayer): boolean {
  const size = (layer.size ?? "auto").trim().toLowerCase();
  if (size === "cover" || size === "contain" || size === "100% 100%" || size === "100%") {
    return false;
  }
  const repeat = (layer.repeat ?? "repeat").trim().toLowerCase();
  return repeat === "no-repeat";
}

/**
 * Parse `background-image` into a list of paints. The leftmost
 * `url()` token in the value owns `imageIds[0]`, the next `url()`
 * owns `imageIds[1]`, and so on — gradients consume no id. CSS
 * paints layers in document order (top of the comma list paints
 * last; i.e. on top), and our IR's `fills` array shares that
 * order, so we keep the input ordering 1:1.
 *
 * Supported forms:
 *   - `none` → no paints
 *   - `linear-gradient(<angle>?, <stops>)`
 *   - `url(...)` → an image paint
 *
 * `layer` carries the matching `background-size` /
 * `background-repeat` so each image paint inherits a `scaleMode`
 * faithful to the CSS declaration.
 */
export function parseBackgroundImage(
  value: string,
  imageIds: readonly string[],
  layer: BackgroundLayer = {},
): readonly PaintIR[] {
  const trimmed = value.trim();
  if (trimmed === "none" || trimmed === "") {
    return [];
  }
  const tokens = splitTopLevelCommas(trimmed);
  const out: PaintIR[] = [];
  const scaleMode = backgroundScaleMode(layer);
  // eslint-disable-next-line no-restricted-syntax -- per-layer cursor walks the imageIds list
  let urlCursor = 0;
  for (const token of tokens) {
    const tok = token.trim();
    if (tok.startsWith("linear-gradient(")) {
      try {
        out.push(parseLinearGradient(tok));
      } catch (err) {
        throw new Error(
          `parseBackgroundImage: failed parsing "${tok}" within "${value}": ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      continue;
    }
    if (tok.startsWith("url(")) {
      const layerImageId = imageIds[urlCursor];
      if (layerImageId === undefined) {
        throw new Error(
          `parseBackgroundImage: url() layer #${urlCursor} ("${tok}") has no matching imageId in `
          + `imageIds=${JSON.stringify(imageIds)}. The capture walker must register every `
          + `background-image url (including data: SVGs and additional layers in a multi-layer `
          + `stack) so each layer keeps its own imageId. Silently skipping layers introduces `
          + `visual omissions that any 0%-diff target rejects.`,
        );
      }
      urlCursor += 1;
      out.push({ kind: "image", imageId: layerImageId, scaleMode });
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
    throw new Error(`parseLinearGradient: empty body in "${input}" (inner="${inner}")`);
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
  // Naive whitespace split would break `rgb(210, 231, 255)` and
  // `rgba(...)` because their internal commas are followed by
  // spaces. Instead we look for an explicit position suffix
  // (`<color> <percent>` or `<color> <length>`) — splitting only on
  // whitespace at the *top level* of the stop token.
  const split = splitOnTopLevelWhitespace(value);
  if (split.length === 1) {
    return {
      position: total === 1 ? 0 : index / (total - 1),
      color: parseColor(split[0]!),
    };
  }
  const color = parseColor(split[0]!);
  const positionToken = split[1]!;
  return { position: parseGradientStopPosition(positionToken, value), color };
}

function parseGradientStopPosition(token: string, original: string): number {
  if (token.endsWith("%")) {
    const n = parseFloat(token.slice(0, -1));
    if (!Number.isFinite(n)) {
      throw new Error(`parseGradientStop: malformed percent stop "${token}" in "${original}"`);
    }
    return n / 100;
  }
  if (token.endsWith("px")) {
    const n = parseFloat(token.slice(0, -2));
    if (!Number.isFinite(n)) {
      throw new Error(`parseGradientStop: malformed px stop "${token}" in "${original}"`);
    }
    // CSS gradients allow length stops (`0px`, `200px`); without the
    // gradient's full extent here we approximate `0px` as 0% and any
    // other length as a clamp toward the start, since the dominant
    // failure mode in the captures we've seen is a `0px` sentinel
    // marking the gradient origin. Higher-fidelity length-stop maths
    // requires the host element's width / height — out of scope for
    // this parser, which never has access to those.
    return n === 0 ? 0 : Math.max(0, Math.min(1, n / 100));
  }
  throw new Error(`parseGradientStop: only percent / px stops supported, got "${token}" in "${original}"`);
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
/**
 * Split on whitespace at parenthesis depth 0. Used to isolate the
 * `<color> <percent>` halves of a gradient stop without slicing
 * the spaces inside `rgb(210, 231, 255)`.
 */
function splitOnTopLevelWhitespace(value: string): readonly string[] {
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
    } else if (depth === 0 && (c === " " || c === "\t")) {
      const piece = value.slice(last, i);
      if (piece.length > 0) {
        out.push(piece);
      }
      last = i + 1;
    }
  }
  const tail = value.slice(last);
  if (tail.length > 0) {
    out.push(tail);
  }
  return out;
}

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
