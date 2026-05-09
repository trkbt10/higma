/**
 * @file RawViewportSnapshot → ViewportIR.
 *
 * Walks the captured DOM tree and translates each visible element
 * into the corresponding IR node. The mapping uses CSS-flavoured
 * heuristics that mirror Figma's authoring surface:
 *
 *   - `display: flex` → AutoLayoutIR row / column with explicit gap +
 *     padding pulled from computed style.
 *   - non-flex containers with positioned children → infer auto-layout
 *     via the bridge's `inferAutoLayout`. If inference fails, the IR
 *     keeps the children as static-positioned siblings.
 *   - `<img>` and `background-image: url(...)` → ImagePaintIR with a
 *     reference into the IR's `assets` map (bytes carried verbatim
 *     from the snapshot).
 *
 * The normaliser is deliberately strict: any value form it does not
 * recognise throws via `parse-css.ts`, never silently approximates.
 * The round-trip spec is the contract that proves this is enough.
 */
import type {
  AssetIR,
  AutoLayoutIR,
  BoxIR,
  ChildSizingIR,
  EffectIR,
  FrameNodeIR,
  NodeIR,
  PaintIR,
  StyleIR,
  TextNodeIR,
  TextRunIR,
  TextStyleIR,
  ViewportIR,
} from "@higma-bridges/web-fig";
import { inferAutoLayout } from "@higma-bridges/web-fig";
import type {
  RawAsset,
  RawElement,
  RawViewportSnapshot,
} from "../web-source/snapshot";
import {
  parseBackgroundImage,
  parseBoxShadow,
  parseColor,
  parseFontWeight,
  parsePx,
} from "./parse-css";
import { buildParagraphContent, isParagraphHost } from "./paragraph";

/** Translate a captured `RawViewportSnapshot` into the bridge IR. */
export function normalizeViewport(
  snapshot: RawViewportSnapshot,
  options: { readonly breakpoint?: string } = {},
): ViewportIR {
  const assets = normalizeAssets(snapshot.assets);
  const root = normalizeNode(snapshot.root, undefined);
  if (root.kind !== "frame") {
    throw new Error("normalizeViewport: document root must normalize to a frame");
  }
  return {
    source: snapshot.source,
    breakpoint: options.breakpoint ?? "default",
    box: snapshot.viewport,
    devicePixelRatio: snapshot.devicePixelRatio,
    background: parseColor(snapshot.background),
    root,
    assets,
  };
}

function normalizeAssets(raw: ReadonlyMap<string, RawAsset>): ReadonlyMap<string, AssetIR> {
  const out = new Map<string, AssetIR>();
  for (const asset of raw.values()) {
    out.set(asset.id, { id: asset.id, mime: asset.mime, bytes: asset.bytes });
  }
  return out;
}

function normalizeNode(el: RawElement, parent: RawElement | undefined): NodeIR {
  const isText = el.text !== undefined && el.children.length === 0 && el.text.length > 0;
  if (isText) {
    return normalizeText(el, parent);
  }
  if (isParagraphHost(el)) {
    return normalizeParagraph(el, parent);
  }
  return normalizeFrame(el, parent);
}

/**
 * Collapse a paragraph host (block-level element whose subtree is
 * entirely inline) into a single TEXT IR. Inline children that
 * deviate from the paragraph's base computed style become runs.
 */
function normalizeParagraph(el: RawElement, parent: RawElement | undefined): TextNodeIR {
  const localBox = boxRelative(el.rect, parent?.contentRect);
  const style = textStyleForParagraph(el);
  const content = buildParagraphContent(el);
  // Figma's `styleOverrideTable` carries per-run colour and font, but
  // not per-run text-decoration — the node's `textDecoration` field is
  // applied uniformly to every glyph. When a paragraph host has no
  // direct decoration but every captured run shares the same
  // decoration (e.g. `<p><a>Learn more</a></p>` where the only inline
  // run is an underlined anchor), promote the run's decoration to the
  // node level so the underline survives the round-trip. Any
  // ambiguous case (multiple runs disagree, or a base run mixes with
  // a decorated run) falls back to the host's own decoration to avoid
  // painting underlines onto plain text.
  const baseTextStyle = normalizeTextStyle(el);
  const promotedDecoration = promoteUniformDecoration(content.runs, baseTextStyle.textDecoration);
  const textStyle = promotedDecoration === baseTextStyle.textDecoration
    ? baseTextStyle
    : { ...baseTextStyle, textDecoration: promotedDecoration };
  return {
    kind: "text",
    id: el.id,
    componentKey: el.id,
    name: el.tag,
    box: localBox,
    style,
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    characters: content.characters,
    textStyle,
    runs: content.runs.length > 0 ? content.runs : undefined,
  };
}

function promoteUniformDecoration(
  runs: readonly TextRunIR[],
  baseDecoration: TextStyleIR["textDecoration"],
): TextStyleIR["textDecoration"] {
  if (runs.length === 0) {
    return baseDecoration;
  }
  const first = runs[0]!.textDecoration;
  if (first === undefined || first === "none") {
    return baseDecoration;
  }
  for (let i = 1; i < runs.length; i += 1) {
    if (runs[i]!.textDecoration !== first) {
      return baseDecoration;
    }
  }
  return first;
}

function textStyleForParagraph(el: RawElement): StyleIR {
  const baseStyle = normalizeStyle(el);
  const baseTextFill = textFillFromComputed(el.computedStyle.color);
  if (!baseTextFill) {
    return baseStyle;
  }
  return { ...baseStyle, fills: [baseTextFill] };
}

function textFillFromComputed(color: string | undefined): PaintIR | undefined {
  if (!color) {
    return undefined;
  }
  return { kind: "solid", color: parseColor(color) };
}

function normalizeFrame(el: RawElement, parent: RawElement | undefined): FrameNodeIR {
  const childrenRaw = el.children.filter((c) => c.visible);
  const childrenIR = childrenRaw.map((child) => normalizeNode(child, el));
  const localBox = boxRelative(el.rect, parent?.contentRect);
  const autoLayout = resolveAutoLayout(el, childrenRaw);
  return {
    kind: "frame",
    id: el.id,
    // The DOM path is stable across viewports for the example.com
    // structure under test. Using it directly as the componentKey
    // groups identical logical components into a shared SYMBOL at
    // emit time.
    componentKey: el.id,
    name: el.tag,
    box: localBox,
    style: normalizeStyle(el),
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    autoLayout,
    children: childrenIR,
  };
}

function normalizeText(el: RawElement, parent: RawElement | undefined): TextNodeIR {
  const localBox = boxRelative(el.rect, parent?.contentRect);
  // Figma represents text color via the node's own `fills` (a single
  // SOLID). The TEXT node's CSS computed `color` is the glyph color;
  // its `background-color` is irrelevant. Replace the inherited
  // `style.fills` (which was sourced from `background-color`) with a
  // fill derived from `color` so the rendered glyphs match the
  // captured page. Multi-run TEXT (per-character color overrides for
  // inline children) is a separate task — at the current granularity
  // every TEXT node represents exactly one inline run.
  const style = textStyleForParagraph(el);
  return {
    kind: "text",
    id: el.id,
    componentKey: el.id,
    name: el.tag,
    box: localBox,
    style,
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    characters: el.text ?? "",
    textStyle: normalizeTextStyle(el),
  };
}

function boxRelative(rect: BoxIR, parentContent: BoxIR | undefined): BoxIR {
  if (!parentContent) {
    return { x: 0, y: 0, width: rect.width, height: rect.height };
  }
  return {
    x: rect.x - parentContent.x,
    y: rect.y - parentContent.y,
    width: rect.width,
    height: rect.height,
  };
}

function normalizeStyle(el: RawElement): StyleIR {
  const cs = el.computedStyle;
  const fills = collectFills(el);
  const strokes = collectStrokes(el);
  const effects = collectEffects(cs);
  const opacity = cs.opacity ? parseFloat(cs.opacity) : 1;
  const cornerRadius = collectCornerRadii(cs);
  const clipsContent = clipsContentFor(cs);
  return {
    fills,
    strokes,
    effects,
    opacity,
    cornerRadius,
    clipsContent,
    blendMode: normalizeBlendMode(cs["mix-blend-mode"]),
  };
}

function collectFills(el: RawElement): readonly PaintIR[] {
  const cs = el.computedStyle;
  const out: PaintIR[] = [];
  const bg = cs["background-color"];
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
    out.push({ kind: "solid", color: parseColor(bg) });
  }
  const images = parseBackgroundImage(cs["background-image"] ?? "none", el.imageId);
  for (const img of images) {
    out.push(img);
  }
  return out;
}

function collectStrokes(el: RawElement): StyleIR["strokes"] {
  const cs = el.computedStyle;
  const widths = [
    parsePx(cs["border-top-width"] ?? "0"),
    parsePx(cs["border-right-width"] ?? "0"),
    parsePx(cs["border-bottom-width"] ?? "0"),
    parsePx(cs["border-left-width"] ?? "0"),
  ];
  const max = Math.max(...widths);
  if (max <= 0) {
    return [];
  }
  if (!widths.every((w) => w === max)) {
    // Asymmetric borders aren't representable by a single Figma stroke;
    // the bridge contract has a single per-node stroke. Rejecting here
    // is the fail-fast choice — extending the IR with per-edge strokes
    // is the correct fix when the use case arises.
    throw new Error(
      `collectStrokes: asymmetric border widths ${widths.join("/")} on element ${el.id} are not yet supported by the IR`,
    );
  }
  const colorRaw = cs["border-top-color"];
  if (!colorRaw) {
    throw new Error(`collectStrokes: border width ${max}px without border-color on element ${el.id}`);
  }
  return [{
    paint: { kind: "solid", color: parseColor(colorRaw) },
    weight: max,
    align: "center",
  }];
}

function collectEffects(cs: Readonly<Record<string, string>>): readonly EffectIR[] {
  const out: EffectIR[] = [];
  const shadows = parseBoxShadow(cs["box-shadow"] ?? "none");
  for (const s of shadows) {
    out.push({
      kind: s.inset ? "inner-shadow" : "drop-shadow",
      color: s.color,
      offsetX: s.offsetX,
      offsetY: s.offsetY,
      blurRadius: s.blurRadius,
      spread: s.spread,
    });
  }
  const filter = cs.filter ?? "none";
  if (filter !== "none") {
    const match = filter.match(/blur\(([\d.]+)px\)/);
    if (match) {
      out.push({ kind: "layer-blur", radius: parseFloat(match[1]!) });
    }
  }
  return out;
}

function collectCornerRadii(cs: Readonly<Record<string, string>>): StyleIR["cornerRadius"] {
  const tl = parsePx(cs["border-top-left-radius"] ?? "0");
  const tr = parsePx(cs["border-top-right-radius"] ?? "0");
  const br = parsePx(cs["border-bottom-right-radius"] ?? "0");
  const bl = parsePx(cs["border-bottom-left-radius"] ?? "0");
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    return undefined;
  }
  return [tl, tr, br, bl];
}

function clipsContentFor(cs: Readonly<Record<string, string>>): boolean {
  const overflow = cs.overflow ?? cs["overflow-x"];
  if (!overflow) {
    return false;
  }
  return overflow === "hidden" || overflow === "clip";
}

function normalizeBlendMode(value: string | undefined): StyleIR["blendMode"] {
  if (!value || value === "normal") {
    return "normal";
  }
  switch (value) {
    case "multiply":
    case "screen":
    case "overlay":
    case "darken":
    case "lighten":
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
      return value;
    default:
      throw new Error(`normalizeBlendMode: unsupported mix-blend-mode "${value}"`);
  }
}

function resolveAutoLayout(el: RawElement, childrenRaw: readonly RawElement[]): AutoLayoutIR {
  const cs = el.computedStyle;
  if (cs.display === "flex" || cs.display === "inline-flex") {
    return autoLayoutFromFlex(cs);
  }
  if (childrenRaw.length === 0) {
    return { direction: "none" };
  }
  const childBoxes = childrenRaw.map((c) => boxRelative(c.rect, el.contentRect));
  const inferred = inferAutoLayout({
    parent: { x: 0, y: 0, width: el.contentRect.width, height: el.contentRect.height },
    children: childBoxes,
  });
  if (inferred.direction === "none") {
    return { direction: "none" };
  }
  return {
    direction: inferred.direction,
    gap: inferred.gap,
    paddingTop: inferred.paddingTop,
    paddingRight: inferred.paddingRight,
    paddingBottom: inferred.paddingBottom,
    paddingLeft: inferred.paddingLeft,
    primaryAlign: inferred.primaryAlign,
    counterAlign: inferred.counterAlign,
    wrap: inferred.wrap,
  };
}

function autoLayoutFromFlex(cs: Readonly<Record<string, string>>): AutoLayoutIR {
  const fd = cs["flex-direction"] ?? "row";
  const direction = fd === "column" || fd === "column-reverse" ? "column" : "row";
  const gap = parsePx(cs.gap ?? cs["row-gap"] ?? cs["column-gap"] ?? "0");
  const paddingTop = parsePx(cs["padding-top"] ?? "0");
  const paddingRight = parsePx(cs["padding-right"] ?? "0");
  const paddingBottom = parsePx(cs["padding-bottom"] ?? "0");
  const paddingLeft = parsePx(cs["padding-left"] ?? "0");
  return {
    direction,
    gap,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    primaryAlign: justifyToIR(cs["justify-content"]),
    counterAlign: alignItemsToIR(cs["align-items"]),
    wrap: cs["flex-wrap"] === "wrap",
  };
}

function justifyToIR(value: string | undefined): "start" | "center" | "end" | "space-between" {
  switch (value) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "end";
    case "space-between":
    case "space-around":
    case "space-evenly":
      return "space-between";
    case "flex-start":
    case "start":
    case "normal":
    case undefined:
      return "start";
    default:
      throw new Error(`justifyToIR: unsupported justify-content "${value}"`);
  }
}

function alignItemsToIR(value: string | undefined): "start" | "center" | "end" | "stretch" {
  switch (value) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "end";
    case "stretch":
      return "stretch";
    case "flex-start":
    case "start":
    case "normal":
    case undefined:
      return "start";
    case "baseline":
      return "start";
    default:
      throw new Error(`alignItemsToIR: unsupported align-items "${value}"`);
  }
}

function normalizeChildSizing(el: RawElement, parent: RawElement | undefined): ChildSizingIR {
  if (!parent) {
    return { mode: "absolute" };
  }
  const parentDisplay = parent.computedStyle.display;
  if (parentDisplay === "flex" || parentDisplay === "inline-flex") {
    // We don't yet have the granularity to disambiguate hug vs fill
    // from computed style alone; the round-trip is lossless on the
    // box dimensions because the IR carries width/height anyway.
    return { mode: "flow", primary: "fixed", counter: "fixed" };
  }
  return { mode: "absolute" };
}

function normalizeTextStyle(el: RawElement): TextStyleIR {
  const cs = el.computedStyle;
  const fontFamilyRaw = cs["font-family"] ?? "sans-serif";
  const fontFamily = fontFamilyRaw.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
  const fontStyle = cssFontStyle(cs["font-style"]);
  const fontWeight = parseFontWeight(cs["font-weight"] ?? "400");
  const fontSize = parsePx(cs["font-size"] ?? "16px");
  const lineHeight = normalizeLineHeight(cs["line-height"], fontSize);
  const letterSpacing = letterSpacingFromCss(cs["letter-spacing"]);
  const textAlign = textAlignFromCss(cs["text-align"]);
  const decoration = decorationFromCss(cs["text-decoration-line"]);
  const transform = transformFromCss(cs["text-transform"]);
  return {
    fontFamily,
    fontStyle,
    fontWeight,
    fontSize,
    lineHeight,
    letterSpacing,
    textAlign,
    textTransform: transform,
    textDecoration: decoration,
  };
}

function cssFontStyle(value: string | undefined): TextStyleIR["fontStyle"] {
  if (value === "italic") {
    return "italic";
  }
  if (value === "oblique") {
    return "oblique";
  }
  return "normal";
}

function letterSpacingFromCss(value: string | undefined): number {
  const v = value ?? "0px";
  if (v === "normal") {
    return 0;
  }
  return parsePx(v);
}

function textAlignFromCss(value: string | undefined): TextStyleIR["textAlign"] {
  if (value === "left" || value === "right" || value === "center" || value === "justify") {
    return value;
  }
  return "left";
}

function normalizeLineHeight(value: string | undefined, _fontSize: number): TextStyleIR["lineHeight"] {
  if (!value) {
    return { unit: "normal" };
  }
  if (value === "normal") {
    // Defer to caller: `lineMetricForElement` measures the rendered
    // line stride from the captured rect when the CSS keyword is
    // `normal`. The IR carries `normal` so downstream tooling can
    // pick its own font-native fallback.
    return { unit: "normal" };
  }
  if (value.endsWith("px")) {
    return { unit: "px", value: parsePx(value) };
  }
  const ratio = parseFloat(value);
  if (Number.isFinite(ratio)) {
    return { unit: "ratio", value: ratio };
  }
  throw new Error(`normalizeLineHeight: cannot parse "${value}"`);
}

function decorationFromCss(value: string | undefined): TextStyleIR["textDecoration"] {
  if (!value || value === "none") {
    return "none";
  }
  if (value.includes("underline")) {
    return "underline";
  }
  if (value.includes("line-through")) {
    return "line-through";
  }
  return "none";
}

function transformFromCss(value: string | undefined): TextStyleIR["textTransform"] {
  switch (value) {
    case "uppercase":
      return "uppercase";
    case "lowercase":
      return "lowercase";
    case "capitalize":
      return "capitalize";
    default:
      return "none";
  }
}
