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
  LengthIR,
  TextNodeIR,
  TextRunIR,
  TextStyleIR,
  TransformIR,
  VectorNodeIR,
  VectorPathIR,
  ViewportIR,
} from "@higma-bridges/web-fig";
import { inferAutoLayout, percentLength, pxLength } from "@higma-bridges/web-fig";
import type {
  RawAsset,
  RawElement,
  RawViewportSnapshot,
} from "../web-source/snapshot";
import {
  isNaturalSizeNoRepeatLayer,
  parseBackgroundImage,
  parseBoxShadow,
  parseColor,
  parseFontWeight,
  parsePx,
  parsePxOr,
} from "./parse-css";
import { buildParagraphContent, isParagraphHost } from "./paragraph";
import { transformPathData } from "../web-source/svg-utils";

/** Translate a captured `RawViewportSnapshot` into the bridge IR. */
export function normalizeViewport(
  snapshot: RawViewportSnapshot,
  options: { readonly breakpoint?: string } = {},
): ViewportIR {
  const assets = normalizeAssets(snapshot.assets);
  const breakpoint = options.breakpoint ?? "default";
  // Lift `position: fixed` / `sticky` subtrees out of the static
  // tree before normalising — they paint at viewport-anchored
  // coordinates that the static layout's auto-layout inference
  // cannot model. The lifted subtrees become a separate viewport
  // layer the emitter wires onto each viewport's wrapper FRAME.
  const lifted = liftViewportLayer(snapshot.root);
  const root = normalizeNode(lifted.root, undefined, breakpoint);
  if (root.kind !== "frame") {
    throw new Error("normalizeViewport: document root must normalize to a frame");
  }
  // Normalise every lifted subtree as if it were a new top-level
  // surface. Box coordinates come from the captured rect directly
  // (viewport-absolute), so the emitter can place them inside the
  // viewport's wrapper FRAME at exactly (rect.x, rect.y).
  const viewportLayer = lifted.layer.map((el) => normalizeViewportLayerEntry(el, breakpoint));
  return {
    source: snapshot.source,
    breakpoint,
    box: snapshot.viewport,
    devicePixelRatio: snapshot.devicePixelRatio,
    background: parseColor(snapshot.background),
    root,
    viewportLayer,
    assets,
  };
}

/**
 * Normalise a fixed / sticky subtree into a single IR node anchored
 * to the viewport. The captured rect already lives in
 * `getBoundingClientRect` (viewport) coordinates, so we feed the
 * subtree to the standard normaliser using the document root as a
 * synthetic parent — `boxRelative` then gives `(rect.x, rect.y)`
 * verbatim, which is what the wrapper FRAME expects.
 */
function normalizeViewportLayerEntry(el: RawElement, breakpoint: string): NodeIR {
  // Synthesize a "viewport" parent whose contentRect starts at (0, 0)
  // so `boxRelative` returns the subtree's viewport-absolute
  // coordinates unchanged.
  const synthetic: RawElement = {
    id: "__viewport__",
    tag: "viewport",
    rect: { x: 0, y: 0, width: 0, height: 0 },
    contentRect: { x: 0, y: 0, width: 0, height: 0 },
    visible: true,
    computedStyle: { position: "static", display: "block" },
    children: [],
  };
  const node = normalizeNode(el, synthetic, breakpoint);
  // Force ABSOLUTE positioning so the emitter pins the subtree to
  // the wrapper FRAME's coordinate system.
  if (node.kind === "frame") {
    return { ...node, sizing: { mode: "absolute" } };
  }
  if (node.kind === "text") {
    return { ...node, sizing: { mode: "absolute" } };
  }
  if (node.kind === "vector") {
    return { ...node, sizing: { mode: "absolute" } };
  }
  return { ...node, sizing: { mode: "absolute" } };
}

/**
 * Walk the tree, collect every `position: fixed` / `sticky` subtree
 * into a flat list, and return a *shallow new* tree with those
 * subtrees pruned out of their original parents. Pruning prevents
 * `boxRelative` from baking in negative offsets when the static
 * parent sits below the viewport top.
 */
function liftViewportLayer(root: RawElement): { root: RawElement; layer: readonly RawElement[] } {
  const layer: RawElement[] = [];
  function rewrite(el: RawElement): RawElement {
    const newChildren: RawElement[] = [];
    let changed = false;
    for (const c of el.children) {
      const pos = c.computedStyle.position;
      if (pos === "fixed" || pos === "sticky") {
        // Capture the fixed subtree as-is (its descendants stay
        // intact). Sticky-but-not-yet-stuck elements still flow
        // normally; we don't have a way to tell at capture time, so
        // treat both the same — a fixed-in-flow `sticky` element is
        // only common at the top of long-scroll pages, and Figma's
        // ABSOLUTE pin matches its visual position either way.
        layer.push(c);
        changed = true;
        continue;
      }
      const rewritten = rewrite(c);
      if (rewritten !== c) changed = true;
      newChildren.push(rewritten);
    }
    if (!changed) return el;
    return { ...el, children: newChildren };
  }
  return { root: rewrite(root), layer };
}

function normalizeAssets(raw: ReadonlyMap<string, RawAsset>): ReadonlyMap<string, AssetIR> {
  const out = new Map<string, AssetIR>();
  for (const asset of raw.values()) {
    out.set(asset.id, { id: asset.id, mime: asset.mime, bytes: asset.bytes });
  }
  return out;
}

function normalizeNode(el: RawElement, parent: RawElement | undefined, breakpoint: string): NodeIR {
  if (el.svgContent !== undefined) {
    return normalizeSvgVector(el, parent, breakpoint);
  }
  if (el.maskSvgContent !== undefined) {
    return normalizeMaskVector(el, parent, breakpoint);
  }
  const isText = el.text !== undefined && el.children.length === 0 && el.text.length > 0;
  if (isText) {
    // `<button>Click me</button>` and similar leaf-text elements with
    // authored chrome (`background-color`, `border-radius`, border)
    // would lose every chrome surface if normalised as a bare TEXT —
    // Figma's TEXT node carries glyph fills, not a background paint
    // or a corner radius. Promote those to a FRAME wrapping a TEXT
    // child so the button's chrome lives on the FRAME and the label
    // lives on the TEXT.
    if (hasAuthoredChrome(el)) {
      return promoteLeafTextToFrame(el, parent, breakpoint);
    }
    return normalizeText(el, parent, breakpoint);
  }
  if (isParagraphHost(el)) {
    return normalizeParagraph(el, parent, breakpoint);
  }
  return normalizeFrame(el, parent, breakpoint);
}

/**
 * True when a leaf-text element carries CSS chrome that the IR's
 * TEXT node cannot represent without dropping fidelity:
 *   - opaque `background-color` (would be lost — TEXT has no bg fill)
 *   - any non-zero `border-*` width (would be lost — TEXT has no border)
 *   - any non-zero corner radius (would be lost — TEXT has no radius)
 *   - non-trivial box-shadow (would be lost — TEXT has no effects)
 *
 * Pure CSS `color` does not count — that IS the glyph fill on the
 * TEXT node, which is what TEXT IR expects.
 */
function hasAuthoredChrome(el: RawElement): boolean {
  const cs = el.computedStyle;
  const bg = cs["background-color"];
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
    return true;
  }
  const borderTotal = parsePxOr(cs["border-top-width"], 0)
    + parsePxOr(cs["border-right-width"], 0)
    + parsePxOr(cs["border-bottom-width"], 0)
    + parsePxOr(cs["border-left-width"], 0);
  if (borderTotal > 0) {
    return true;
  }
  const radii = [
    cs["border-top-left-radius"],
    cs["border-top-right-radius"],
    cs["border-bottom-right-radius"],
    cs["border-bottom-left-radius"],
  ];
  for (const r of radii) {
    if (r && r !== "0px" && r !== "0") {
      return true;
    }
  }
  if (cs["box-shadow"] && cs["box-shadow"] !== "none") {
    return true;
  }
  return false;
}

/**
 * Build a FRAME IR carrying the chrome (fills / strokes / effects /
 * corner radius) and a single TEXT child holding the label.
 *
 * Centring contract: the inner TEXT inherits the chrome's
 * `text-align` and the chrome's flex/grid `align-items` via
 * `normalizeTextStyle`'s textAlign/textAlignVertical mapping. The
 * inner TEXT's box covers the chrome's *content area* (rect minus
 * CSS padding), so Figma's `textAlignHorizontal` / `textAlignVertical`
 * place the glyphs inside that content rect just like CSS does. The
 * chrome FRAME itself stays `autoLayout: { direction: "none" }` —
 * pushing centring into FRAME auto-layout would compete with the TEXT
 * node's own alignment and double-shift the glyphs.
 */
function promoteLeafTextToFrame(el: RawElement, parent: RawElement | undefined, breakpoint: string): FrameNodeIR {
  const localBox = boxForElement(el, parent);
  const innerTextElement: RawElement = {
    ...el,
    id: `${el.id}/__label__`,
    children: [],
    pseudo: el.pseudo,
    text: el.text,
    // The inner TEXT lives in the chrome's *content* rect, i.e. the
    // captured rect minus CSS padding. Without this the TEXT box
    // covers the whole chrome (border + padding included), and the
    // captured `padding-*` is silently dropped — `<button>` UA padding
    // pushes the label into the chrome's edge and Figma's
    // textAlignHorizontal/Vertical centre against the wrong rect.
    rect: contentRectFromPadding(el),
    contentRect: contentRectFromPadding(el),
    computedStyle: {
      ...el.computedStyle,
      // Strip chrome so the inner TEXT carries only glyph styling.
      "background-color": "rgba(0, 0, 0, 0)",
      "background-image": "none",
      "border-top-width": "0px",
      "border-right-width": "0px",
      "border-bottom-width": "0px",
      "border-left-width": "0px",
      "border-top-left-radius": "0px",
      "border-top-right-radius": "0px",
      "border-bottom-right-radius": "0px",
      "border-bottom-left-radius": "0px",
      "box-shadow": "none",
    },
  };
  // Inner TEXT inherits the chrome's *flex/grid* vertical centring
  // intent through `textAlignVerticalFromCss`, but only when the
  // chrome itself is a flex/grid container. For non-flex chrome (the
  // dominant real-world case — `<button>` UA, `<a class="btn">`,
  // `<span class="badge">`) the page expresses vertical centring by
  // matching the line stride to the chrome height. We surface that
  // implicit intent on single-line leaf-text hosts so a centred chrome
  // label always renders centred regardless of CSS strategy.
  const verticalCentringNeeded = leafTextWantsVerticalCentre(el, innerTextElement);
  const innerTextWithVCentre: RawElement = verticalCentringNeeded
    ? {
        ...innerTextElement,
        computedStyle: {
          ...innerTextElement.computedStyle,
          // Force the leaf normaliser into the flex-centring branch so
          // the IR carries `textAlignVertical: center` even when the
          // captured chrome is `display: block`.
          display: "flex",
          "align-items": "center",
        },
      }
    : innerTextElement;
  const inner = normalizeText(innerTextWithVCentre, el, breakpoint);
  // Asymmetric `border-*` on the chrome (e.g. a `<button>` with only a
  // `border-bottom`) needs the same per-edge synth as a regular FRAME
  // — otherwise `collectStrokes` returns no stroke and the partial
  // border vanishes.
  const borderEdgeChildren = synthesiseBorderEdgeFrames(el, breakpoint);
  return {
    kind: "frame",
    id: el.id,
    componentKey: variantKey(el, breakpoint),
    name: el.tag,
    box: localBox,
    style: normalizeStyle(el),
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    transform: parseTransformIR(el.computedStyle.transform),
    autoLayout: { direction: "none" },
    children: [inner, ...borderEdgeChildren],
  };
}

/**
 * Compute the chrome's CSS *content* rect — i.e. the captured rect
 * minus border and padding. The inner TEXT lives here so its
 * `textAlignHorizontal` / `textAlignVertical` centre the glyphs
 * inside the content area, exactly like CSS centres them.
 *
 * Border widths are read from computed style; padding is the four
 * `padding-*` values. `getBoundingClientRect` (which feeds `el.rect`)
 * already gives the *border box*, so subtracting border + padding
 * lands the inner rect on the content edge.
 */
function contentRectFromPadding(el: RawElement): { x: number; y: number; width: number; height: number } {
  const cs = el.computedStyle;
  const borderTop = parsePxOr(cs["border-top-width"], 0);
  const borderRight = parsePxOr(cs["border-right-width"], 0);
  const borderBottom = parsePxOr(cs["border-bottom-width"], 0);
  const borderLeft = parsePxOr(cs["border-left-width"], 0);
  const paddingTop = parsePxOr(cs["padding-top"], 0);
  const paddingRight = parsePxOr(cs["padding-right"], 0);
  const paddingBottom = parsePxOr(cs["padding-bottom"], 0);
  const paddingLeft = parsePxOr(cs["padding-left"], 0);
  const x = el.rect.x + borderLeft + paddingLeft;
  const y = el.rect.y + borderTop + paddingTop;
  const width = Math.max(0, el.rect.width - borderLeft - borderRight - paddingLeft - paddingRight);
  const height = Math.max(0, el.rect.height - borderTop - borderBottom - paddingTop - paddingBottom);
  return { x, y, width, height };
}

/**
 * Decide whether a leaf-text chrome wants vertical centring based on
 * its CSS strategy. Returns true when:
 *
 *   - The chrome is `display: flex|grid` with `align-items: center`
 *     (handled by the regular normaliser, no extra signal needed —
 *     this branch returns true purely for symmetry).
 *   - The chrome is non-flex *and* the captured content rect height
 *     exceeds the line stride by more than half a line. That's the
 *     canonical "single-line label inside a tall pill / chip /
 *     button" pattern where CSS expects a vertical centre via
 *     `line-height = height` or symmetric padding. Without the
 *     promotion the label sticks to the content rect's top.
 *
 * Multi-line chromes (`text` height ≈ multiple line strides, e.g. a
 * rich `<button>` with wrapped content) keep `top` anchoring, matching
 * CSS's flow direction.
 */
function leafTextWantsVerticalCentre(host: RawElement, inner: RawElement): boolean {
  const display = host.computedStyle.display ?? "";
  if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid") {
    return (host.computedStyle["align-items"] ?? "").trim() === "center";
  }
  // Form controls — `<input>`, `<select>`, `<button>`, `<textarea>` —
  // paint their visible text vertically centred inside the UA chrome
  // by default (regardless of CSS display). The captured fixture has
  // `display: inline-block` (or just `inline`) on these so the
  // generic flex-detection branch above misses them. Hard-wire the
  // tag list so promoted form controls always centre their label.
  const tag = host.tag;
  if (tag === "input" || tag === "select" || tag === "button" || tag === "textarea") {
    return true;
  }
  const fontSize = parsePxOr(inner.computedStyle["font-size"], 16);
  const lineHeightRaw = inner.computedStyle["line-height"] ?? "normal";
  const lineStride = lineStridePxFromCss(lineHeightRaw, fontSize);
  if (lineStride <= 0) {
    return false;
  }
  // Half a line of slack accommodates ascender / descender padding
  // that the browser adds to a single line. Anything taller than
  // 1.5 line-strides is treated as deliberately roomy chrome.
  return inner.rect.height > lineStride * 1.5;
}

function lineStridePxFromCss(value: string, fontSize: number): number {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "normal") {
    return fontSize * 1.2;
  }
  if (trimmed.endsWith("px")) {
    const n = parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(n) ? n : fontSize * 1.2;
  }
  const ratio = parseFloat(trimmed);
  if (Number.isFinite(ratio)) {
    return fontSize * ratio;
  }
  return fontSize * 1.2;
}

/**
 * Compose a SYMBOL key that includes the viewport breakpoint, so
 * variants of the same DOM path (`body > div` at desktop vs mobile)
 * don't collapse onto the same SYMBOL. Without the prefix, the
 * emitter would resolve every INSTANCE for any viewport to the
 * first-seen variant — which is how a desktop-only puzzle-logo
 * background bled into the mobile rendering.
 */
function variantKey(el: RawElement, breakpoint: string): string {
  return `${breakpoint}::${el.id}`;
}

/**
 * Translate a captured `mask-image` SVG into an IR vector node.
 *
 * Semantics: CSS paints the host element's `background-color`
 * silhouetted by the mask alpha. A `<path>` from the mask SVG with
 * its own `fill="black"` (the standard "draw the silhouette"
 * sentinel) is therefore re-coloured with the host's CSS
 * `background-color`. When the host has no explicit background
 * colour we fall back to `currentColor` (CSS `color`), matching how
 * MediaWiki / wikipedia's icons inherit their tint.
 *
 * The vector lives at the element's content rect — `mask-image` is
 * sized by `mask-size` (defaults to the mask asset's intrinsic
 * size); for the captures we target every mask asset is sized
 * `mask-size: contain` or matches the element exactly, so taking
 * the whole content rect is a safe initial mapping.
 */
function normalizeMaskVector(el: RawElement, parent: RawElement | undefined, breakpoint: string): VectorNodeIR {
  const hostBox = boxForElement(el, parent);
  const svg = el.maskSvgContent!;
  const tint = maskTintForElement(el);
  // Same transform-baking as the inline-`<svg>` case — mask SVGs are
  // routinely authored with `<g transform="translate(...)">` for
  // multi-piece silhouettes; without baking the inner paths render
  // at origin regardless of the captured ancestor chain.
  const paths: VectorPathIR[] = svg.paths.map((p) => ({
    d: p.transform === undefined ? p.d : transformPathData(p.d, p.transform),
    fill: tint,
    stroke: undefined,
    strokeWeight: undefined,
    fillRule: p.fillRule,
  }));
  const maskBox = computeMaskBox(el, hostBox);
  return {
    kind: "vector",
    id: el.id,
    componentKey: variantKey(el, breakpoint),
    name: el.tag,
    box: maskBox,
    style: normalizeStyle(el),
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    transform: parseTransformIR(el.computedStyle.transform),
    viewBox: svg.viewBox,
    paths,
  };
}

function computeMaskBox(el: RawElement, hostBox: BoxIR): BoxIR {
  const cs = el.computedStyle;
  const naturalW = el.maskNaturalWidth;
  const naturalH = el.maskNaturalHeight;
  if (naturalW === undefined || naturalH === undefined) {
    return hostBox;
  }
  // CSS `mask-size`: "auto" → intrinsic; explicit length / percent
  // resolves against the host box. Yahoo / Wikipedia icons
  // generally use the default (intrinsic) so we honour that first
  // and only branch to explicit when present.
  const sizeValue = (cs["mask-size"] ?? cs["-webkit-mask-size"] ?? "auto").trim().toLowerCase();
  const sized = sizeValue === "auto" || sizeValue === "" || sizeValue === "auto auto"
    ? { width: naturalW, height: naturalH }
    : resolveMaskExplicitSize(sizeValue, naturalW, naturalH);
  if (sized === undefined) {
    return hostBox;
  }
  const positionValue = cs["mask-position"] ?? cs["-webkit-mask-position"] ?? "0% 0%";
  const offset = parseBackgroundPosition(positionValue, hostBox.width, hostBox.height, sized.width, sized.height);
  return {
    x: hostBox.x + offset.x,
    y: hostBox.y + offset.y,
    width: sized.width,
    height: sized.height,
  };
}

function resolveMaskExplicitSize(
  raw: string,
  naturalW: number,
  naturalH: number,
): { width: number; height: number } | undefined {
  if (raw === "cover" || raw === "contain") {
    // Mask-specific sizing keywords; not strictly intrinsic but
    // we don't have host box here, so defer to the natural size.
    return { width: naturalW, height: naturalH };
  }
  const tokens = raw.split(/\s+/);
  if (tokens.length === 1) {
    if (tokens[0]!.endsWith("px")) {
      const n = parseFloat(tokens[0]!.slice(0, -2));
      if (Number.isFinite(n) && naturalW > 0) {
        return { width: n, height: n * (naturalH / naturalW) };
      }
    }
    return undefined;
  }
  if (tokens.length === 2) {
    const w = parseFloat(tokens[0]!);
    const h = parseFloat(tokens[1]!);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      return { width: w, height: h };
    }
  }
  return undefined;
}

function maskTintForElement(el: RawElement): PaintIR {
  // CSS `mask-image` silhouettes the element's background-color.
  // When that's transparent (the typical mask icon case) we use
  // the foreground colour, which is what `currentColor` resolves
  // to in MediaWiki / wikipedia stylesheets.
  const cs = el.computedStyle;
  const bg = cs["background-color"];
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
    return { kind: "solid", color: parseColor(bg) };
  }
  const color = cs.color;
  if (color) {
    return { kind: "solid", color: parseColor(color) };
  }
  return { kind: "solid", color: parseColor("rgb(0, 0, 0)") };
}

function normalizeSvgVector(el: RawElement, parent: RawElement | undefined, breakpoint: string): VectorNodeIR {
  const localBox = boxForElement(el, parent);
  const svg = el.svgContent!;
  // Bake every captured `<g transform>` (and any explicit
  // `transform` on the path / shape itself) into the path data so
  // Figma's VECTOR receives geometry already in the SVG viewport's
  // coordinate frame. Without this multi-piece icons authored as
  // `<g transform="translate(...)"><path/></g>` land in Figma at
  // origin (0, 0) regardless of the captured transform — the visible
  // failure was disconnected icon parts colliding inside one VECTOR
  // node.
  const paths: VectorPathIR[] = svg.paths.map((p) => ({
    d: p.transform === undefined ? p.d : transformPathData(p.d, p.transform),
    fill: p.fill ? cssPaintToIR(p.fill) : undefined,
    stroke: p.stroke ? cssPaintToIR(p.stroke) : undefined,
    strokeWeight: p.strokeWidth,
    fillRule: p.fillRule,
  }));
  return {
    kind: "vector",
    id: el.id,
    componentKey: variantKey(el, breakpoint),
    name: el.tag,
    box: localBox,
    style: normalizeStyle(el),
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    transform: parseTransformIR(el.computedStyle.transform),
    viewBox: svg.viewBox,
    paths,
  };
}

function cssPaintToIR(value: string): PaintIR | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "none" || trimmed === "transparent") {
    return undefined;
  }
  if (trimmed === "currentColor") {
    // Without the cascading colour we can't resolve `currentColor`
    // here. Skip — the renderer falls back to its default fill.
    return undefined;
  }
  if (trimmed.startsWith("url(")) {
    // SVG `<path fill="url(#gradient-id)">` references an inline
    // `<linearGradient>` / `<pattern>` defined elsewhere in the
    // host SVG. The bridge IR has no representation for those yet
    // — propagate as "no fill" so the renderer paints the path
    // empty rather than aborting the whole capture. A higher-
    // fidelity pass will inline the referenced def into a
    // proper IR gradient paint.
    return undefined;
  }
  return { kind: "solid", color: parseColor(trimmed) };
}

/**
 * Collapse a paragraph host (block-level element whose subtree is
 * entirely inline) into a single TEXT IR. Inline children that
 * deviate from the paragraph's base computed style become runs.
 */
function normalizeParagraph(el: RawElement, parent: RawElement | undefined, breakpoint: string): TextNodeIR {
  const localBox = boxForElement(el, parent);
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
    componentKey: variantKey(el, breakpoint),
    name: el.tag,
    box: localBox,
    style,
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    transform: parseTransformIR(el.computedStyle.transform),
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
  // Figma TEXT nodes carry glyph fills only — they have no
  // surface-level border / corner-radius / overflow clip. Returning
  // the host's `normalizeStyle()` verbatim leaks `border-bottom: 1px`
  // (typical underlined-link CSS) onto the TEXT node, where it
  // renders as a stroke around every glyph instead of as the inline
  // underline the page authored. Strip strokes / cornerRadius /
  // clipsContent so the text node is glyph-only — the wrapping FRAME
  // (when promoted via `promoteLeafTextToFrame`) carries the chrome
  // that needed those fields.
  const baseStyle = normalizeStyle(el);
  const baseTextFill = textFillFromComputed(el.computedStyle.color);
  const textOnly: StyleIR = {
    fills: baseTextFill ? [baseTextFill] : baseStyle.fills,
    strokes: [],
    effects: baseStyle.effects,
    opacity: baseStyle.opacity,
    cornerRadius: undefined,
    clipsContent: false,
    blendMode: baseStyle.blendMode,
  };
  return textOnly;
}

function textFillFromComputed(color: string | undefined): PaintIR | undefined {
  if (!color) {
    return undefined;
  }
  return { kind: "solid", color: parseColor(color) };
}

/**
 * Inline-replaced descendants (e.g. `<a><img></a>`) need to climb out
 * of inline wrappers whose `getBoundingClientRect()` hugs the
 * surrounding line box rather than the replaced child's geometry.
 * If we left them inside, `boxRelative(child.rect, wrapper.contentRect)`
 * yields a large negative offset and the image paints offscreen.
 *
 * `collectFlowChildren` walks `el.children` in document order; an
 * inline-display child that *contains* an inline-replaced element
 * (img, svg, video, picture, canvas) and whose own bounding rect is
 * smaller than the replaced descendant is unwrapped — its
 * descendants surface as direct children of `el`. The wrapper's
 * own visual contributions (fills / strokes) are skipped, which is
 * acceptable because anchors / spans default to `transparent`
 * background in every CSS we've seen in practice; inline link
 * colour is already lifted via the paragraph run-style merge.
 *
 * Wrappers that carry `pseudo` content stay intact so their
 * `::before`/`::after` glyphs aren't dropped.
 */
function collectFlowChildren(el: RawElement): RawElement[] {
  const out: RawElement[] = [];
  for (const child of el.children) {
    if (!child.visible) {
      continue;
    }
    // Skip degenerate-rect frames that carry no visible content of
    // their own and no positional descendants we'd lose. The capture
    // walker keeps them because the in-page `isVisible` predicate
    // treats `display: block` with `getClientRects()` hits as visible
    // even when the rect collapses to 0×0; in the IR they become
    // empty FRAMEs that bloat the renderer's scene-graph traversal
    // (Yahoo top page goes from ~990 frames to fewer than 800 once
    // these are dropped). The skip is conservative: a 0-area frame
    // with text or descendants stays in via the recursion below.
    if (isDegenerateContainer(child)) {
      continue;
    }
    if (shouldUnwrapInlineWrapper(child)) {
      // Recurse so multi-level wrappers (`<a><span><img></span></a>`)
      // collapse all the way down.
      out.push(...collectFlowChildren(child));
      continue;
    }
    out.push(child);
  }
  return out;
}

function isDegenerateContainer(el: RawElement): boolean {
  if (el.rect.width > 0 && el.rect.height > 0) {
    return false;
  }
  if (el.text !== undefined && el.text.length > 0) {
    return false;
  }
  if (el.imageId !== undefined || el.maskImageId !== undefined || el.svgContent !== undefined) {
    return false;
  }
  if (el.pseudo !== undefined && el.pseudo.length > 0) {
    return false;
  }
  // Any descendant with non-zero size keeps the wrapper alive so
  // we don't accidentally drop a hidden ancestor of a visible
  // grandchild.
  return !descendantHasArea(el);
}

function descendantHasArea(el: RawElement): boolean {
  for (const c of el.children) {
    if (!c.visible) {
      continue;
    }
    if (c.rect.width > 0 && c.rect.height > 0) {
      return true;
    }
    if (descendantHasArea(c)) {
      return true;
    }
  }
  return false;
}

function shouldUnwrapInlineWrapper(el: RawElement): boolean {
  const display = el.computedStyle.display;
  if (display !== "inline" && display !== "inline-block") {
    return false;
  }
  if (el.pseudo !== undefined && el.pseudo.length > 0) {
    return false;
  }
  if (el.text !== undefined && el.text.length > 0) {
    return false;
  }
  // Replaced descendants whose intrinsic geometry exceeds the
  // wrapper's line-box bounds are the symptom — keep the wrapper
  // intact when no such descendant exists, so plain `<a>foo</a>`
  // links continue to participate in paragraph detection.
  return containsOversizedReplaced(el);
}

function containsOversizedReplaced(el: RawElement): boolean {
  const replacedTags = new Set(["img", "video", "picture", "canvas", "iframe"]);
  for (const child of el.children) {
    if (!child.visible) {
      continue;
    }
    if (replacedTags.has(child.tag)) {
      if (child.rect.height > el.rect.height + 1 || child.rect.width > el.rect.width + 1) {
        return true;
      }
    }
    if (child.svgContent !== undefined) {
      if (child.rect.height > el.rect.height + 1 || child.rect.width > el.rect.width + 1) {
        return true;
      }
    }
    if (containsOversizedReplaced(child)) {
      return true;
    }
  }
  return false;
}

function normalizeFrame(el: RawElement, parent: RawElement | undefined, breakpoint: string): FrameNodeIR {
  // Inline wrappers (e.g. `<figure><a><img/></a></figure>` where the
  // anchor is `display: inline`) carry a `getBoundingClientRect()`
  // that hugs the inline text-flow line they participate in, *not*
  // the geometry of any replaced descendants. Using such a wrapper
  // as the coordinate-system parent for `boxRelative` makes a
  // 150×112 image land at a negative y inside a 150×16 anchor —
  // visibly offscreen above the frame.
  //
  // We collapse those inline wrappers: their children re-parent to
  // *this* frame so the relative box maths uses a sensible
  // block-level reference. The wrapper itself contributes nothing
  // visible (no fills, no strokes — `<a>` defaults to inheriting
  // the surrounding text color, which the run-style merge already
  // handles); skipping it preserves visual fidelity. Wrappers that
  // *do* carry pseudo content stay so their `::before` / `::after`
  // glyphs survive into the IR.
  const childrenRaw = collectFlowChildren(el);
  const childrenIR = childrenRaw.map((child) => normalizeNode(child, el, breakpoint));
  const reorderedIR = reorderByZIndex(childrenRaw, childrenIR);
  const synthChildren = synthesiseNaturalBackgroundFrames(el, breakpoint);
  // Asymmetric / partial borders (e.g. `border-bottom: 1px solid`) are
  // not representable as a single Figma stroke without painting the
  // whole node's perimeter. Synthesise an absolute-positioned thin
  // FRAME per visible edge so only the edges the page authored
  // render.
  const borderEdgeChildren = synthesiseBorderEdgeFrames(el, breakpoint);
  const localBox = boxForElement(el, parent);
  const autoLayout = resolveAutoLayout(el, childrenRaw);
  return {
    kind: "frame",
    id: el.id,
    // SYMBOL key includes the viewport breakpoint so desktop /
    // tablet / mobile variants of the same DOM path don't collapse
    // onto a single SYMBOL — the bug that bled the desktop puzzle
    // logo background into mobile rendering.
    componentKey: variantKey(el, breakpoint),
    name: el.tag,
    box: localBox,
    style: normalizeStyle(el),
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    transform: parseTransformIR(el.computedStyle.transform),
    autoLayout,
    // Border edges paint last so they sit on top of any background
    // image / fill / decorative children, matching how CSS layers
    // borders above the content area.
    children: [...synthChildren, ...reorderedIR, ...borderEdgeChildren],
  };
}

/**
 * Apply CSS painting order: lower z-index paints first (= earlier in
 * the array), higher z-index paints last (= later, on top). Stable
 * within equal z-indices so source order is preserved among siblings
 * that share a stacking level.
 *
 * `z-index: auto` resolves to 0 for the purpose of ordering against
 * positioned siblings; this matches the simple-stacking-context
 * behaviour CSS specifies for elements that don't establish their
 * own stacking context. Full stacking-context modelling (negative
 * z-index below in-flow, ::before/::after rules, etc.) is out of
 * scope; the simple ascending sort handles the dominant real-world
 * case (badges, dropdowns, sticky toolbars within a single context).
 */
function reorderByZIndex(rawChildren: readonly RawElement[], irChildren: readonly NodeIR[]): readonly NodeIR[] {
  if (rawChildren.length !== irChildren.length) {
    throw new Error(
      `reorderByZIndex: raw/IR child count mismatch (${rawChildren.length} vs ${irChildren.length})`,
    );
  }
  if (rawChildren.length < 2) {
    return irChildren;
  }
  const indexed = irChildren.map((node, i) => ({
    node,
    z: parseZIndex(rawChildren[i]!.computedStyle["z-index"]),
    sourceIndex: i,
  }));
  indexed.sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z;
    }
    return a.sourceIndex - b.sourceIndex;
  });
  return indexed.map((entry) => entry.node);
}

function parseZIndex(value: string | undefined): number {
  if (!value || value === "auto") {
    return 0;
  }
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build IR child frames for any `background-image: url(...)` layer
 * whose `background-size` is `auto` (intrinsic) and whose
 * `background-repeat` is `no-repeat`. Each synthesised frame has:
 *   - `box` set to (posX, posY, naturalWidth, naturalHeight) where
 *     `posX/posY` come from `background-position` and the natural
 *     dimensions come from `imageNaturalWidth/Height` populated by
 *     `decorateImageNaturalSize`.
 *   - a single image-paint fill in `cover` mode. The image-paint is
 *     `cover` (Figma `FILL`) because the synth frame's own box is
 *     exactly the image's intrinsic size, so cover ≡ contain ≡ stretch
 *     here, and `cover` keeps the renderer on the well-tested path.
 *
 * If the host advertises `auto + no-repeat` but `imageId` /
 * `imageNaturalWidth/Height` aren't both available, we throw —
 * the visual is unrecoverable without those, and "silent skip"
 * would re-introduce the omission this synth is meant to fix.
 */
function synthesiseNaturalBackgroundFrames(el: RawElement, breakpoint: string): readonly FrameNodeIR[] {
  const cs = el.computedStyle;
  const layer = {
    size: cs["background-size"],
    repeat: cs["background-repeat"],
  };
  if (!isNaturalSizeNoRepeatLayer(layer)) {
    return [];
  }
  const bgImage = cs["background-image"] ?? "none";
  if (bgImage === "none" || bgImage === "") {
    return [];
  }
  if (!bgImage.includes("url(")) {
    return [];
  }
  const imageId = el.imageId;
  if (imageId === undefined) {
    return [];
  }
  const naturalW = el.imageNaturalWidth;
  const naturalH = el.imageNaturalHeight;
  // CSS `background-size` resolution: when neither axis is `auto`
  // we use the explicit values verbatim; when both are `auto` we
  // need the asset's intrinsic dimensions; mixed `<length> auto`
  // resolves the auto axis from the natural aspect ratio.
  const sized = resolveBackgroundSize(cs["background-size"] ?? "auto", naturalW, naturalH);
  if (sized === undefined) {
    throw new Error(
      `synthesiseNaturalBackgroundFrames: element <${el.tag} id=${el.id}> declares `
      + `background-size: ${cs["background-size"] ?? "auto"} with no-repeat but no `
      + `intrinsic image dimensions were captured for imageId="${imageId}". The host `
      + `snapshot must populate imageNaturalWidth/Height before normalisation can render `
      + `the layer.`,
    );
  }
  const offset = parseBackgroundPosition(
    cs["background-position"] ?? "0% 0%",
    el.contentRect.width,
    el.contentRect.height,
    sized.width,
    sized.height,
  );
  return [
    {
      kind: "frame",
      id: `${el.id}/__bg__`,
      componentKey: `${breakpoint}::${el.id}/__bg__`,
      name: `bg-${el.tag}`,
      box: {
        x: offset.x,
        y: offset.y,
        width: sized.width,
        height: sized.height,
      },
      style: {
        fills: [{ kind: "image", imageId, scaleMode: "stretch" }],
        strokes: [],
        effects: [],
        opacity: 1,
        cornerRadius: undefined,
        clipsContent: false,
        blendMode: "normal",
      },
      visible: true,
      sizing: { mode: "absolute" },
      autoLayout: { direction: "none" },
      children: [],
    },
  ];
}

/**
 * Resolve a CSS `background-size` value into pixel dimensions.
 *
 *   `auto` / `auto auto` → (naturalW, naturalH)
 *   `<length> <length>`  → explicit
 *   `<length>`           → that length on x, intrinsic ratio on y
 *   `<length> auto`      → explicit x, ratio-derived y
 *   `auto <length>`      → ratio-derived x, explicit y
 *
 * Returns `undefined` when the resolution requires intrinsic
 * dimensions but they aren't available — caller throws.
 */
function resolveBackgroundSize(
  raw: string,
  naturalW: number | undefined,
  naturalH: number | undefined,
): { width: number; height: number } | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "auto" || trimmed === "auto auto" || trimmed === "") {
    if (naturalW === undefined || naturalH === undefined) {
      return undefined;
    }
    return { width: naturalW, height: naturalH };
  }
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 1) {
    const x = parsePxLength(tokens[0]!);
    if (x === undefined) {
      return undefined;
    }
    if (naturalW === undefined || naturalH === undefined || naturalW === 0) {
      return undefined;
    }
    return { width: x, height: x * (naturalH / naturalW) };
  }
  if (tokens.length !== 2) {
    return undefined;
  }
  const xToken = tokens[0]!;
  const yToken = tokens[1]!;
  if (xToken === "auto" && yToken === "auto") {
    if (naturalW === undefined || naturalH === undefined) {
      return undefined;
    }
    return { width: naturalW, height: naturalH };
  }
  if (xToken === "auto") {
    const y = parsePxLength(yToken);
    if (y === undefined || naturalW === undefined || naturalH === undefined || naturalH === 0) {
      return undefined;
    }
    return { width: y * (naturalW / naturalH), height: y };
  }
  if (yToken === "auto") {
    const x = parsePxLength(xToken);
    if (x === undefined || naturalW === undefined || naturalH === undefined || naturalW === 0) {
      return undefined;
    }
    return { width: x, height: x * (naturalH / naturalW) };
  }
  const x = parsePxLength(xToken);
  const y = parsePxLength(yToken);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return { width: x, height: y };
}

function parsePxLength(token: string): number | undefined {
  if (token.endsWith("px")) {
    const n = parseFloat(token.slice(0, -2));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Resolve a CSS `background-position` value into pixel offsets
 * relative to the host element's content rect.
 *
 * Inputs come from `getComputedStyle`, which always normalises the
 * value to two space-separated tokens, each either `<length>` (in
 * px) or `<percentage>`. The percentage form is resolved against
 * `(containerSize - imageSize)` per the CSS spec, *not* simply
 * `containerSize`.
 */
function parseBackgroundPosition(
  raw: string,
  containerW: number,
  containerH: number,
  imgW: number,
  imgH: number,
): { x: number; y: number } {
  const tokens = raw.trim().split(/\s+/);
  if (tokens.length !== 2) {
    throw new Error(`parseBackgroundPosition: expected two tokens, got "${raw}"`);
  }
  const x = resolvePositionAxis(tokens[0]!, containerW, imgW);
  const y = resolvePositionAxis(tokens[1]!, containerH, imgH);
  return { x, y };
}

function resolvePositionAxis(token: string, containerExtent: number, imageExtent: number): number {
  const trimmed = token.trim();
  if (trimmed.endsWith("px")) {
    const n = parseFloat(trimmed.slice(0, -2));
    if (!Number.isFinite(n)) {
      throw new Error(`resolvePositionAxis: malformed px value "${token}"`);
    }
    return n;
  }
  if (trimmed.endsWith("%")) {
    const n = parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(n)) {
      throw new Error(`resolvePositionAxis: malformed percent value "${token}"`);
    }
    return ((containerExtent - imageExtent) * n) / 100;
  }
  throw new Error(`resolvePositionAxis: unsupported background-position token "${token}"`);
}

function normalizeText(el: RawElement, parent: RawElement | undefined, breakpoint: string): TextNodeIR {
  const localBox = boxForElement(el, parent);
  // Figma represents text color via the node's own `fills` (a single
  // SOLID). The TEXT node's CSS computed `color` is the glyph color;
  // its `background-color` is irrelevant. Replace the inherited
  // `style.fills` (which was sourced from `background-color`) with a
  // fill derived from `color` so the rendered glyphs match the
  // captured page. Multi-run TEXT (per-character color overrides for
  // inline children) is a separate task — at the current granularity
  // every TEXT node represents exactly one inline run.
  const style = textStyleForParagraph(el);
  // CSS Generated Content: `::before` content prepends the host's
  // text, `::after` appends. A leaf-text element (e.g. `<li>` with
  // a `::before { content: "•"; }`) loses the pseudo glyphs unless
  // we splice them into the characters string. Per-pseudo style
  // overrides aren't expressed in `runs` here because the leaf-text
  // path doesn't carry runs at all — the dominant real-world case
  // (bullet / arrow / separator) shares the host's colour anyway.
  const before = (el.pseudo ?? [])
    .filter((p) => p.which === "before")
    .map((p) => p.text)
    .join("");
  const after = (el.pseudo ?? [])
    .filter((p) => p.which === "after")
    .map((p) => p.text)
    .join("");
  const characters = before + (el.text ?? "") + after;
  return {
    kind: "text",
    id: el.id,
    componentKey: variantKey(el, breakpoint),
    name: el.tag,
    box: localBox,
    style,
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
    transform: parseTransformIR(el.computedStyle.transform),
    characters,
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

/**
 * Choose the coordinate system for an element. Always parent-relative
 * (`child.rect.x - parent.contentRect.x`, same for y) — Figma stacks
 * child transforms on top of the parent's, so we need the local delta
 * regardless of whether the child is in flow or `position: fixed`.
 *
 * For `fixed` / `sticky` children the local delta is often negative
 * (the captured DOM parent starts somewhere down the page while the
 * child is anchored at viewport y=0); the renderer handles the negative
 * offset correctly because we mark the child as
 * `stackPositioning: ABSOLUTE` — it opts out of auto-layout flow but
 * stays in the parent's coordinate space.
 */
function boxForElement(el: RawElement, parent: RawElement | undefined): BoxIR {
  return boxRelative(el.rect, parent?.contentRect);
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
  const layer = {
    size: cs["background-size"],
    repeat: cs["background-repeat"],
  };
  // `auto + no-repeat` carries no faithful single-paint mapping in
  // Figma — the IR's image-paint scaleModes either tile, stretch,
  // contain, or cover, none of which mean "paint once at natural
  // size at a specified pixel offset, leave the rest transparent".
  // The synth path below converts it into a natural-size child
  // frame at the captured `background-position`. Skipping the
  // paint here prevents the throw inside `parseBackgroundImage`.
  if (!isNaturalSizeNoRepeatLayer(layer)) {
    // `<img>` consumes `imageIds[0]` for its `src` attribute (handled
    // below); the remaining ids belong to `background-image` layers
    // in CSS source order. Non-image elements pass the full list
    // straight through.
    const allIds = el.imageIds ?? (el.imageId !== undefined ? [el.imageId] : []);
    const layerImageIds = el.tag === "img" ? allIds.slice(1) : allIds;
    const images = parseBackgroundImage(cs["background-image"] ?? "none", layerImageIds, layer);
    for (const img of images) {
      out.push(img);
    }
  }
  // `<img>` content surfaces as an image fill — `<svg>` is handled
  // separately via `normalizeSvgVector` (vector node). Without this
  // path raster icons emit as empty frames and the screenshot diff
  // blows up. The asset is already registered via `extractImageUrl`
  // in the in-page walker; we just need to express the relationship
  // in the IR.
  if (el.tag === "img" && el.imageId !== undefined) {
    const dup = out.some((p) => p.kind === "image" && p.imageId === el.imageId);
    if (!dup) {
      out.push({ kind: "image", imageId: el.imageId, scaleMode: "contain" });
    }
  }
  return out;
}

function collectStrokes(el: RawElement): StyleIR["strokes"] {
  const cs = el.computedStyle;
  const edges = collectBorderEdges(cs);
  const max = Math.max(...edges.map((e) => e.width));
  if (max <= 0) {
    return [];
  }
  // Symmetry guard: only fold the per-edge captures into a single
  // `style.strokes[0]` entry when every visible edge agrees on width
  // *and* colour. CSS pages routinely use one-edge borders for
  // dividers (table-row separators, tab strips, focus underlines) and
  // two-edge borders for inset rules (top + bottom on a quote block).
  // Painting a uniform stroke around the whole node in those cases
  // turns "decorative bottom rule" into "outlined card", a high-
  // visibility regression. Asymmetric borders are surfaced as
  // synthetic edge-line FRAMEs in `synthesiseBorderEdgeFrames`
  // instead, and the FRAME-level stroke is left empty so Figma
  // doesn't double-paint.
  if (!bordersAreUniform(edges)) {
    return [];
  }
  const dominant = edges.find((e) => e.width > 0)!;
  if (!dominant.color) {
    return [];
  }
  return [{
    paint: { kind: "solid", color: parseColor(dominant.color) },
    weight: max,
    align: "center",
  }];
}

type BorderEdge = {
  readonly side: "top" | "right" | "bottom" | "left";
  readonly width: number;
  readonly color: string | undefined;
  readonly style: string | undefined;
};

function collectBorderEdges(cs: Readonly<Record<string, string>>): readonly BorderEdge[] {
  return [
    {
      side: "top",
      width: parsePxOr(cs["border-top-width"], 0),
      color: cs["border-top-color"],
      style: cs["border-top-style"],
    },
    {
      side: "right",
      width: parsePxOr(cs["border-right-width"], 0),
      color: cs["border-right-color"],
      style: cs["border-right-style"],
    },
    {
      side: "bottom",
      width: parsePxOr(cs["border-bottom-width"], 0),
      color: cs["border-bottom-color"],
      style: cs["border-bottom-style"],
    },
    {
      side: "left",
      width: parsePxOr(cs["border-left-width"], 0),
      color: cs["border-left-color"],
      style: cs["border-left-style"],
    },
  ];
}

/**
 * True when every edge with non-zero width carries the same width
 * and colour, *and* every visible edge has the same `border-style`
 * (`solid` / `dashed` / `dotted`). The IR's single-stroke surface can
 * fold this case losslessly. Anything else needs the per-edge synth
 * to avoid painting strokes the page never authored.
 */
function bordersAreUniform(edges: readonly BorderEdge[]): boolean {
  const visible = edges.filter((e) => e.width > 0);
  if (visible.length === 0) {
    return true;
  }
  if (visible.length !== 4) {
    // A 1- / 2- / 3-edge border is, by definition, asymmetric.
    return false;
  }
  const [first, ...rest] = visible;
  for (const e of rest) {
    if (Math.abs(e.width - first!.width) > 0.5) {
      return false;
    }
    if ((e.color ?? "") !== (first!.color ?? "")) {
      return false;
    }
    if ((e.style ?? "") !== (first!.style ?? "")) {
      return false;
    }
  }
  return true;
}

/**
 * Build absolute-positioned edge-line FRAMEs for the asymmetric
 * border case. Each visible edge becomes a thin filled FRAME whose
 * `box` lives on the parent's *content + border* rectangle (the
 * border-box itself), painted in the captured `border-*-color`. The
 * children sit on top of the parent's content because `style.strokes`
 * was deliberately left empty above — there is no double-paint.
 *
 * Coordinate frame: returned boxes are *parent-local* (origin =
 * parent's top-left), so the caller can splice them straight into
 * the FRAME's `children` array. The local coordinates match what
 * `boxRelative` produces for any other absolute child, so Figma's
 * coordinate maths stays uniform.
 *
 * Out of scope: dashed / dotted strokes — the synthesised line is
 * always solid. Real fidelity for those would require either a
 * dedicated stroke-dash IR or per-segment vector geometry; both are
 * larger features than the per-edge case warrants. The captured
 * `border-style` is preserved on the IR so a downstream pass can
 * upgrade later.
 */
function synthesiseBorderEdgeFrames(el: RawElement, breakpoint: string): readonly FrameNodeIR[] {
  const cs = el.computedStyle;
  const edges = collectBorderEdges(cs);
  if (bordersAreUniform(edges)) {
    return [];
  }
  const frames: FrameNodeIR[] = [];
  const w = el.rect.width;
  const h = el.rect.height;
  for (const edge of edges) {
    if (edge.width <= 0) {continue;}
    if (!edge.color) {continue;}
    if (edge.style === "none" || edge.style === "hidden") {continue;}
    const box = edgeBox(edge.side, edge.width, w, h);
    if (box.width <= 0 || box.height <= 0) {continue;}
    frames.push({
      kind: "frame",
      id: `${el.id}/__border-${edge.side}__`,
      componentKey: `${breakpoint}::${el.id}/__border-${edge.side}__`,
      name: `border-${edge.side}`,
      box,
      style: {
        fills: [{ kind: "solid", color: parseColor(edge.color) }],
        strokes: [],
        effects: [],
        opacity: 1,
        cornerRadius: undefined,
        clipsContent: false,
        blendMode: "normal",
      },
      visible: true,
      sizing: { mode: "absolute" },
      autoLayout: { direction: "none" },
      children: [],
    });
  }
  return frames;
}

function edgeBox(side: BorderEdge["side"], width: number, hostW: number, hostH: number): BoxIR {
  switch (side) {
    case "top":
      return { x: 0, y: 0, width: hostW, height: width };
    case "bottom":
      return { x: 0, y: hostH - width, width: hostW, height: width };
    case "left":
      return { x: 0, y: 0, width, height: hostH };
    case "right":
      return { x: hostW - width, y: 0, width, height: hostH };
  }
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
  // `border-*-radius` may be `<length>` (`12px`) or `<percentage>`
  // (`50%` for full circles). The IR carries both verbatim through a
  // `LengthIR` and resolves percentages at emit time against the
  // owning element's `min(width, height)` (CSS Backgrounds 3 §5.3).
  // The single source of truth for that resolution lives in
  // `@higma-bridges/web-fig/length.resolveCornerRadius`.
  const tl = parseLength(cs["border-top-left-radius"]);
  const tr = parseLength(cs["border-top-right-radius"]);
  const br = parseLength(cs["border-bottom-right-radius"]);
  const bl = parseLength(cs["border-bottom-left-radius"]);
  if (isZero(tl) && isZero(tr) && isZero(br) && isZero(bl)) {
    return undefined;
  }
  return [tl, tr, br, bl];
}

function isZero(length: LengthIR): boolean {
  return length.value === 0;
}

function parseLength(value: string | undefined): LengthIR {
  if (value === undefined) {return pxLength(0);}
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "0" || trimmed === "0px") {return pxLength(0);}
  if (trimmed.endsWith("%")) {
    const n = parseFloat(trimmed.slice(0, -1));
    return percentLength(Number.isFinite(n) ? n : 0);
  }
  return pxLength(parsePxOr(trimmed, 0));
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
  // Out-of-flow children (`fixed`, `sticky`, AND `absolute`) must
  // not feed `inferAutoLayout`. `fixed` / `sticky` were already
  // excluded; `absolute` is added here too because:
  //
  //   - CSS removes absolutely-positioned children from the normal
  //     flow; the parent's autoLayout intent is determined by its
  //     in-flow siblings only.
  //   - A real-world badge / dropdown / overlay sits in the parent's
  //     content rect by happenstance, but its position contradicts
  //     any consistent gap/direction the in-flow siblings would
  //     suggest. Including it would corrupt the inferred direction.
  //   - The absolute child still has a sensible parent-relative box
  //     (the parent IS a positioned ancestor in this fixture, so
  //     `boxRelative` returns the right offset), so the IR can keep
  //     it as a child with `sizing.mode === "absolute"`.
  const flowChildren = childrenRaw.filter((c) => {
    const p = c.computedStyle.position;
    if (p === "fixed" || p === "sticky" || p === "absolute") {
      return false;
    }
    // `float: left|right` is also out-of-flow for the purposes of
    // auto-layout inference. Including a floated image would push
    // the inferred direction towards the float edge and break the
    // padding maths for its in-flow siblings.
    const flt = (c.computedStyle.float ?? "none").trim();
    if (flt === "left" || flt === "right") {
      return false;
    }
    return true;
  });
  if (flowChildren.length === 0) {
    return { direction: "none" };
  }
  const childBoxes = flowChildren.map((c) => boxRelative(c.rect, el.contentRect));
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
  const gap = parsePxOr(cs.gap ?? cs["row-gap"] ?? cs["column-gap"], 0);
  const paddingTop = parsePxOr(cs["padding-top"], 0);
  const paddingRight = parsePxOr(cs["padding-right"], 0);
  const paddingBottom = parsePxOr(cs["padding-bottom"], 0);
  const paddingLeft = parsePxOr(cs["padding-left"], 0);
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
  // Out-of-flow positions (`fixed`, `sticky`, `absolute`) are marked
  // with `mode: "absolute"` so the emitter pins the element with
  // `stackPositioning: ABSOLUTE` and the autolayout inferer (run via
  // `resolveAutoLayout`) knows to skip them. The previous code only
  // marked `fixed` / `sticky`; an `absolute` badge or overlay was
  // being treated as a flow child in IR, which led the figma side to
  // attempt to fit it into the parent's stack and shifted other
  // children's positions.
  const pos = el.computedStyle.position;
  if (pos === "fixed" || pos === "sticky" || pos === "absolute") {
    return { mode: "absolute" };
  }
  // CSS `float: left|right` similarly removes the element from inline
  // flow and re-flows siblings around it. Figma auto-layout has no
  // float concept, so map floated children to ABSOLUTE — the captured
  // rect already reflects the post-float geometry, and ABSOLUTE
  // pinning matches the captured visual without trying to re-derive a
  // flow stack that only makes sense in CSS.
  const flt = (el.computedStyle.float ?? "none").trim();
  if (flt === "left" || flt === "right") {
    return { mode: "absolute" };
  }
  // Default to flow with fixed primary/counter axis. `inferAutoLayout`
  // (run inside fig-to-web at render time) decides whether the parent
  // becomes a real flex container by inspecting the child boxes — we
  // don't second-guess it here. Marking every non-flex-parented child
  // as ABSOLUTE used to be the default; it caused fig-to-web to render
  // every block-flow child as a positioned overlay and mis-render
  // sub-trees whose layout the inferer would otherwise have detected.
  return { mode: "flow", primary: "fixed", counter: "fixed" };
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
    textAlignVertical: textAlignVerticalFromCss(cs),
    textTransform: transform,
    textDecoration: decoration,
  };
}

/**
 * Translate the host element's CSS into Figma's vertical text
 * alignment.
 *
 * CSS does not have a direct text-vertical-align, so we read the
 * intent from the element's *own* computed style:
 *
 *   - `display: flex` / `inline-flex` + `align-items: center` (the
 *     canonical "centred button label" pattern) ⇒ `center`. The
 *     element being a leaf-text host means the flex container holds a
 *     single text run, so the only line of glyphs inherits the cross-
 *     axis centring.
 *   - same display + `align-items: flex-end` / `end` ⇒ `bottom`.
 *   - `display: grid` with `place-items` / `align-items` resolving to
 *     a centred / end value ⇒ same mapping.
 *
 * Anything else falls back to `top` (Figma's default), matching how
 * an ordinary `<p>` paragraph anchors its first line at the box top.
 *
 * The mapping is intentionally conservative: we only promote when the
 * CSS unambiguously asserts vertical centring on the captured element.
 * Pages that drive vertical centring through `padding-top` or a tall
 * `line-height` keep the default — the existing rect / line-stride
 * geometry already places the glyphs correctly without re-anchoring.
 */
function textAlignVerticalFromCss(
  cs: Readonly<Record<string, string>>,
): TextStyleIR["textAlignVertical"] {
  const display = cs.display ?? "";
  const isFlex = display === "flex" || display === "inline-flex";
  const isGrid = display === "grid" || display === "inline-grid";
  if (!isFlex && !isGrid) {
    return "top";
  }
  const alignItems = (cs["align-items"] ?? "normal").trim();
  switch (alignItems) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "bottom";
    default:
      return "top";
  }
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

/**
 * Parse a CSS `transform` computed-style value into IR matrix form.
 *
 * `getComputedStyle` always emits the resolved matrix:
 *   - `matrix(a, b, c, d, tx, ty)` for 2D
 *   - `matrix3d(...)` for 3D (rare on layout-driven content)
 *   - `none` when no transform applies
 *
 * Returns:
 *   - `undefined` for `none` / `matrix3d(...)` (3D not yet in IR) /
 *     parse failures.
 *   - `undefined` for the identity matrix `matrix(1, 0, 0, 1, 0, 0)`
 *     so the IR field stays absent in the no-op case.
 *   - `undefined` for *pure translation* `matrix(1, 0, 0, 1, tx, ty)`
 *     because the browser already baked the translate into the rect
 *     via `getBoundingClientRect`. Surfacing it again would
 *     double-count the offset at emit time.
 *   - The full matrix otherwise (rotation, scale, skew, mixed).
 */
function parseTransformIR(value: string | undefined): TransformIR | undefined {
  if (!value || value === "none") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("matrix(") || !trimmed.endsWith(")")) {
    // matrix3d / unsupported function — leave undefined rather than
    // silently emitting a 2D approximation. A future patch can teach
    // the IR a 3D matrix type if real-world captures ever need it.
    return undefined;
  }
  const inner = trimmed.slice("matrix(".length, -1);
  const parts = inner.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 6 || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  const [a, b, c, d, tx, ty] = parts as [number, number, number, number, number, number];
  // Identity → no IR transform needed.
  if (a === 1 && b === 0 && c === 0 && d === 1 && tx === 0 && ty === 0) {
    return undefined;
  }
  // Pure translation → already baked into rect.
  if (a === 1 && b === 0 && c === 0 && d === 1) {
    return undefined;
  }
  return { a, b, c, d, tx, ty };
}
