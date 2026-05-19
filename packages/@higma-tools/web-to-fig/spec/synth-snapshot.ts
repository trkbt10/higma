/**
 * @file Synthetic `RawViewportSnapshot` builders for spec tests.
 *
 * Why exist: per-feature spec coverage of the web-to-fig pipeline
 * requires a way to exercise `normalizeViewport` (and the downstream
 * `buildDocument`) on tiny, focused DOM shapes without paying for a
 * Playwright launch. The shapes the runtime walker emits are
 * `RawElement` trees with computed-style maps; building those by hand
 * is verbose because most properties need a default to keep the
 * normaliser's parsers from throwing on missing keys (`background-color`
 * defaults to `rgba(0, 0, 0, 0)`, `border-top-width` to `0px`, etc.).
 *
 * This module owns the canonical "neutral" computed-style map plus a
 * small `synthEl` constructor that lets a spec describe the variant
 * fields it cares about (fontSize, display: flex, padding, …) and
 * inherits the rest. The neutral map mirrors what Playwright's
 * `getComputedStyle` returns for an unstyled `<div>` rendered into a
 * 1280x800 viewport — no spec is allowed to rely on a different
 * baseline because that would split the SoT.
 *
 * Co-located with the integration suite under `spec/` rather than
 * inside `src/` because it is test-only infrastructure; promoting it
 * to `src/` would leak fixture-shaped APIs into the package's public
 * surface (per AGENTS.md: cross-module spec functions live in `spec/`).
 */
import type {
  RawAsset,
  RawElement,
  RawRect,
  RawViewportSnapshot,
} from "../src/web-source/snapshot";

/**
 * Computed-style baseline mirroring Chromium's `getComputedStyle` on
 * an unstyled `<div>`. Every property the normaliser reads is present
 * with a non-throwing default so a spec only declares the deltas it
 * actually exercises. Adding a new property the normaliser reads
 * REQUIRES adding the corresponding default here — a missing key is
 * not an oversight worth tolerating because it would make the spec
 * pass spuriously when `getComputedStyle` returns the property in
 * production.
 */
export const NEUTRAL_COMPUTED: Readonly<Record<string, string>> = {
  "background-color": "rgba(0, 0, 0, 0)",
  "background-image": "none",
  "background-position": "0% 0%",
  "background-repeat": "repeat",
  "background-size": "auto auto",
  "border-top-width": "0px",
  "border-right-width": "0px",
  "border-bottom-width": "0px",
  "border-left-width": "0px",
  "border-top-color": "rgb(0, 0, 0)",
  "border-right-color": "rgb(0, 0, 0)",
  "border-bottom-color": "rgb(0, 0, 0)",
  "border-left-color": "rgb(0, 0, 0)",
  "border-top-style": "none",
  "border-right-style": "none",
  "border-bottom-style": "none",
  "border-left-style": "none",
  "border-radius": "0px",
  "border-top-left-radius": "0px",
  "border-top-right-radius": "0px",
  "border-bottom-right-radius": "0px",
  "border-bottom-left-radius": "0px",
  "box-shadow": "none",
  color: "rgb(0, 0, 0)",
  display: "block",
  filter: "none",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  float: "none",
  "font-family": "sans-serif",
  "font-size": "16px",
  "font-style": "normal",
  "font-weight": "400",
  gap: "0px",
  "row-gap": "0px",
  "column-gap": "0px",
  "justify-content": "normal",
  "letter-spacing": "normal",
  "line-height": "normal",
  "mix-blend-mode": "normal",
  opacity: "1",
  overflow: "visible",
  "overflow-x": "visible",
  "overflow-y": "visible",
  "padding-top": "0px",
  "padding-right": "0px",
  "padding-bottom": "0px",
  "padding-left": "0px",
  position: "static",
  "text-align": "left",
  "text-decoration-line": "none",
  "text-transform": "none",
  transform: "none",
  visibility: "visible",
  "align-items": "normal",
  "z-index": "auto",
};

/** Merge an overrides map onto the neutral baseline. */
export function withStyle(overrides: Record<string, string>): Readonly<Record<string, string>> {
  return { ...NEUTRAL_COMPUTED, ...overrides };
}

/**
 * Full-shape `RawElement` constructor. Allows a spec to omit the
 * fields it doesn't exercise — `contentRect` defaults to `rect`
 * (no padding/border), `visible` defaults to true, `children` to an
 * empty list. `id` is required because the normaliser uses it as the
 * SYMBOL key seed and hand-rolling collisions across a synthesised
 * tree silently breaks instance lookups during the round trip.
 */
export type SynthElInput = {
  readonly id: string;
  readonly tag: string;
  readonly rect: RawRect;
  readonly contentRect?: RawRect;
  readonly visible?: boolean;
  readonly computedStyle?: Readonly<Record<string, string>>;
  readonly styleOverrides?: Record<string, string>;
  readonly text?: string;
  readonly textFragments?: readonly string[];
  readonly textLineRects?: readonly RawRect[];
  readonly textLineBaselineYs?: readonly number[];
  readonly children?: readonly RawElement[];
  readonly imageId?: string;
  readonly imageIds?: readonly string[];
  readonly imageNaturalWidth?: number;
  readonly imageNaturalHeight?: number;
  readonly maskImageId?: string;
  readonly maskNaturalWidth?: number;
  readonly maskNaturalHeight?: number;
  readonly svgContent?: RawElement["svgContent"];
  readonly maskSvgContent?: RawElement["maskSvgContent"];
  readonly pseudo?: RawElement["pseudo"];
};

/**
 * Build a `RawElement` from a sparse `SynthElInput`. Defaults
 * `contentRect` to `rect`, `visible` to true, and `computedStyle` to
 * the neutral baseline (or to `withStyle(styleOverrides)` when the
 * caller supplies overrides). Required `id` keeps the SYMBOL key
 * unique across the synthetic tree.
 */
export function synthEl(input: SynthElInput): RawElement {
  const cs = input.computedStyle
    ?? (input.styleOverrides !== undefined ? withStyle(input.styleOverrides) : NEUTRAL_COMPUTED);
  const textLineRects = input.textLineRects ?? synthTextLineRects(input, cs);
  return {
    id: input.id,
    tag: input.tag,
    rect: input.rect,
    contentRect: input.contentRect ?? input.rect,
    visible: input.visible ?? true,
    computedStyle: cs,
    text: input.text,
    textFragments: input.textFragments,
    textLineRects,
    textLineBaselineYs: input.textLineBaselineYs,
    children: input.children ?? [],
    imageId: input.imageId,
    imageIds: input.imageIds,
    imageNaturalWidth: input.imageNaturalWidth,
    imageNaturalHeight: input.imageNaturalHeight,
    maskImageId: input.maskImageId,
    maskNaturalWidth: input.maskNaturalWidth,
    maskNaturalHeight: input.maskNaturalHeight,
    svgContent: input.svgContent,
    maskSvgContent: input.maskSvgContent,
    pseudo: input.pseudo,
  };
}

function synthTextLineRects(
  input: SynthElInput,
  computedStyle: Readonly<Record<string, string>>,
): readonly RawRect[] | undefined {
  if (!inputHasTextBearingLine(input)) {
    return undefined;
  }
  const lineHeight = lineHeightPxForSynthText(input, computedStyle);
  return [{
    x: input.rect.x,
    y: input.rect.y,
    width: input.rect.width,
    height: lineHeight,
  }];
}

function inputHasTextBearingLine(input: SynthElInput): boolean {
  if (input.visible === false) {
    return false;
  }
  if (input.text !== undefined && input.text.length > 0) {
    return true;
  }
  if (input.textFragments !== undefined && input.textFragments.some((fragment) => fragment.length > 0)) {
    return true;
  }
  if (input.pseudo !== undefined && input.pseudo.length > 0) {
    return true;
  }
  return input.children !== undefined && input.children.some((child) => rawElementHasTextBearingLine(child));
}

function rawElementHasTextBearingLine(el: RawElement): boolean {
  if (!el.visible) {
    return false;
  }
  if (el.text !== undefined && el.text.length > 0) {
    return true;
  }
  if (el.textFragments !== undefined && el.textFragments.some((fragment) => fragment.length > 0)) {
    return true;
  }
  if (el.pseudo !== undefined && el.pseudo.length > 0) {
    return true;
  }
  return el.children.some((child) => rawElementHasTextBearingLine(child));
}

function lineHeightPxForSynthText(
  input: SynthElInput,
  computedStyle: Readonly<Record<string, string>>,
): number {
  const raw = computedStyle["line-height"];
  if (raw === undefined) {
    throw new Error(`synthEl: ${input.id} text requires computedStyle["line-height"]`);
  }
  if (raw === "normal") {
    return positiveSynthTextRectHeight(input);
  }
  if (raw.endsWith("px")) {
    return parseSynthPx(raw, input.id, "line-height");
  }
  const ratio = Number.parseFloat(raw);
  if (Number.isFinite(ratio)) {
    const fontSize = parseSynthPx(computedStyle["font-size"], input.id, "font-size");
    return ratio * fontSize;
  }
  throw new Error(`synthEl: ${input.id} cannot resolve line-height "${raw}"`);
}

function positiveSynthTextRectHeight(input: SynthElInput): number {
  if (input.rect.height <= 0) {
    throw new Error(`synthEl: ${input.id} line-height=normal requires a positive text rect height`);
  }
  return input.rect.height;
}

function parseSynthPx(value: string | undefined, id: string, field: string): number {
  if (value === undefined || !value.endsWith("px")) {
    throw new Error(`synthEl: ${id} ${field} must be an explicit px value`);
  }
  const parsed = Number.parseFloat(value.slice(0, -2));
  if (!Number.isFinite(parsed)) {
    throw new Error(`synthEl: ${id} ${field} has malformed px value "${value}"`);
  }
  return parsed;
}

/** Wrap a single body subtree in a viewport snapshot of the given size. */
export type SynthViewportInput = {
  readonly source?: string;
  readonly viewport?: RawRect;
  readonly devicePixelRatio?: number;
  readonly background?: string;
  readonly bodyStyleOverrides?: Record<string, string>;
  readonly children: readonly RawElement[];
  readonly assets?: ReadonlyMap<string, RawAsset>;
};

const DEFAULT_VIEWPORT: RawRect = { x: 0, y: 0, width: 1280, height: 800 };

/**
 * Wrap one or more body subtrees into a `RawViewportSnapshot` of the
 * requested viewport size. The synthetic body uses neutral computed
 * style unless `bodyStyleOverrides` is provided. Defaults: viewport
 * 1280x800, devicePixelRatio 1, transparent background, empty assets.
 */
export function synthViewport(input: SynthViewportInput): RawViewportSnapshot {
  const viewport = input.viewport ?? DEFAULT_VIEWPORT;
  const body = synthEl({
    id: "0",
    tag: "body",
    rect: viewport,
    contentRect: viewport,
    styleOverrides: input.bodyStyleOverrides,
    children: input.children,
  });
  return {
    source: input.source ?? "spec://synth",
    viewport,
    devicePixelRatio: input.devicePixelRatio ?? 1,
    background: input.background ?? "rgba(0, 0, 0, 0)",
    root: body,
    assets: input.assets ?? new Map(),
  };
}
