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
    return normalizeText(el, parent, breakpoint);
  }
  if (isParagraphHost(el)) {
    return normalizeParagraph(el, parent, breakpoint);
  }
  return normalizeFrame(el, parent, breakpoint);
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
  const paths: VectorPathIR[] = svg.paths.map((p) => ({
    d: p.d,
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
  const paths: VectorPathIR[] = svg.paths.map((p) => ({
    d: p.d,
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
  const synthChildren = synthesiseNaturalBackgroundFrames(el, breakpoint);
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
    autoLayout,
    children: [...synthChildren, ...childrenIR],
  };
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
  const characters = el.text ?? "";
  return {
    kind: "text",
    id: el.id,
    componentKey: variantKey(el, breakpoint),
    name: el.tag,
    box: localBox,
    style,
    visible: el.visible,
    sizing: normalizeChildSizing(el, parent),
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
  const widths = [
    parsePxOr(cs["border-top-width"], 0),
    parsePxOr(cs["border-right-width"], 0),
    parsePxOr(cs["border-bottom-width"], 0),
    parsePxOr(cs["border-left-width"], 0),
  ];
  const max = Math.max(...widths);
  if (max <= 0) {
    return [];
  }
  // Real-world pages frequently use one-edge borders (table dividers,
  // tab strips, focus outlines). Figma's IR carries a single stroke
  // per node, so we approximate asymmetric borders with the widest
  // edge — better than aborting the whole capture. A future IR
  // extension that models per-edge strokes would replace this
  // narrowing.
  const colorRaw = cs["border-top-color"];
  if (!colorRaw) {
    return [];
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
  // Viewport-anchored children (`fixed` / `sticky`) don't sit inside
  // the parent's content box — their getBoundingClientRect is the
  // viewport's, so feeding them to `inferAutoLayout` produces a bogus
  // negative offset that distorts the inferred direction / gap. Drop
  // them from inference; they re-enter the tree as ABSOLUTE-positioned
  // children at emit time and stay where the browser put them.
  // `position: absolute` children stay in this list because their
  // rects are still inside the captured DOM ancestor (their nearest
  // positioned ancestor *is* a real DOM node), so the layout maths
  // still works for them.
  const flowChildren = childrenRaw.filter((c) => {
    const p = c.computedStyle.position;
    return p !== "fixed" && p !== "sticky";
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
  // Viewport-anchored CSS positions (`fixed`, and `sticky` once it
  // sticks) detach the element from its DOM ancestor's content box —
  // their `getBoundingClientRect()` is whatever the viewport says,
  // not "child rect inside parent contentRect". If we left them in
  // flow, `boxRelative` would emit large negative offsets (the parent
  // is somewhere below the viewport top while the child is at y=0)
  // and the auto-layout inferer would treat the negative-offset
  // child as a regular sibling. Mark them out-of-flow so the emitter
  // can flip on `stackPositioning: ABSOLUTE`.
  //
  // `position: absolute` is intentionally *not* treated this way:
  // its containing block is the nearest positioned DOM ancestor,
  // which the `getBoundingClientRect()` already accounts for, and
  // the absolute child's rect *does* lie inside the captured DOM
  // ancestor. Treating `absolute` the same as `fixed` would
  // misclassify YouTube's ~190 absolute layout helpers and break
  // their parents' auto-layout.
  const pos = el.computedStyle.position;
  if (pos === "fixed" || pos === "sticky") {
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
