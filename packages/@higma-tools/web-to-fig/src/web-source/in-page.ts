/**
 * @file Browser-side capture function.
 *
 * Serialised verbatim and run inside the Playwright page context via
 * `page.evaluate`. Returns a JSON-friendly shape that the caller
 * (`capture.ts`) re-hydrates into a `RawViewportSnapshot`.
 *
 * Why a separate file: keeping the in-page payload here means
 * `capture.ts` does not have to embed it as a template literal, the
 * function is type-checked against the snapshot contract, and we can
 * unit-test the walker against jsdom without a Playwright browser.
 */

/** Serialisable snapshot (no Maps, no Uint8Array). The bytes are reattached host-side. */
export type RawSnapshotJson = {
  readonly source: string;
  readonly viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly background: string;
  readonly root: ElementJson;
  /** image url → opaque id; bytes are fetched host-side. */
  readonly imageRefs: ReadonlyArray<{ readonly id: string; readonly url: string }>;
};

/**
 * 2x3 affine matrix in column-major order. Maps (x, y) to
 * (a*x + c*y + e, b*x + d*y + f). Mirrors the type of the same name
 * in `svg-utils.ts`.
 */
export type SvgAffineJson = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

/**
 * SVG path captured from the in-page walker. Mirrors `RawSvgPath` in
 * `snapshot.ts` exactly so the JSON payload can be re-hydrated
 * without coercion.
 *
 * `transform` carries the accumulated `<g transform>` chain of every
 * ancestor between the path / shape and the host `<svg>`. The host-
 * side normaliser bakes it into `d` via `transformPathData` so Figma
 * receives geometry already in the SVG viewport's coordinate frame —
 * matching what the page paints. Without this layer multi-piece
 * icons authored as `<g transform="translate(...)"><path/></g>`
 * arrive in Figma at the wrong location and visibly merge with
 * neighbouring subpaths because their unbaked `d` lands outside the
 * VECTOR's box.
 */
export type SvgPathJson = {
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly fillRule?: "nonzero" | "evenodd";
  readonly transform?: SvgAffineJson;
};

export type SvgContentJson = {
  readonly viewBox?: { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number };
  readonly paths: readonly SvgPathJson[];
};

/**
 * Captured `::before` / `::after` pseudo-element entry. Only literal
 * `content: "..."` is surfaced; `attr()`, `counter()`, image / URL
 * forms are not — those need richer modelling than the IR's TEXT
 * node currently supports.
 */
export type PseudoJson = {
  readonly which: "before" | "after";
  readonly text: string;
  readonly computedStyle: Readonly<Record<string, string>>;
};

export type ElementJson = {
  readonly id: string;
  readonly tag: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly contentRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly visible: boolean;
  readonly computedStyle: Readonly<Record<string, string>>;
  readonly imageId?: string;
  /** Per-layer ids for `background-image` URL layers in CSS source order. */
  readonly imageIds?: readonly string[];
  /** Intrinsic pixel size of the `imageId` asset, populated host-side. */
  readonly imageNaturalWidth?: number;
  readonly imageNaturalHeight?: number;
  /** id for the `mask-image` URL, kept separate from `imageId` so
   * host-side can route SVG masks through the vector pipeline. */
  readonly maskImageId?: string;
  /**
   * Vector parse of the mask SVG, populated host-side. Inline so
   * snapshot fixtures replayed without a Playwright capture still
   * carry the mask geometry. Same shape as `svgContent`.
   */
  readonly maskSvgContent?: SvgContentJson;
  /** Intrinsic pixel size of the mask asset. */
  readonly maskNaturalWidth?: number;
  readonly maskNaturalHeight?: number;
  readonly svgContent?: SvgContentJson;
  readonly text?: string;
  /**
   * Per-position direct-text fragments. See `RawElement.textFragments`
   * in `snapshot.ts` for semantics — this is the JSON-friendly mirror
   * of that field. Length equals `children.length + 1` when present.
   */
  readonly textFragments?: readonly string[];
  /**
   * Per-line rects captured via `Range.getClientRects()` over the
   * element's text content. Length == number of *visual* lines the
   * browser laid the text into. The renderer trusts this list as
   * the canonical line-break decision so it doesn't have to
   * re-derive wrap points (where opentype.js advance metrics
   * disagree with CoreText's, producing visible mid-paragraph
   * break drift on captured pages).
   *
   * Absent for non-text elements (empty `text` and no `textFragments`).
   * `text.length` agrees with the sum of characters across all lines —
   * any disagreement indicates the walker captured text from a
   * subtree that doesn't contribute to the element's layout (e.g.
   * `display: none` descendant) and is treated as "no reliable line
   * breakdown".
   */
  readonly textLineRects?: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
  /**
   * Per-visual-line baseline Y positions in viewport coordinates,
   * captured from the browser's text layout pass. One entry per
   * `textLineRects` entry; renderers use them to place each line's
   * glyph baseline at the exact spot the browser painted.
   *
   * Per-line rather than first-line-only because CSS allows the line
   * box's baseline to vary line-to-line (inline children with
   * mismatched font-sizes / line-heights, vertical-align deltas, …).
   * A single baseline value would collapse that variation; capturing
   * one per line preserves it.
   *
   * Absent for elements with no text-bearing line, when the
   * browser-side Canvas font-metric API was unavailable, or when not
   * every line could be measured (we don't mix valid and undefined
   * entries — see `collectTextLineBaselineYs`). The renderer falls
   * back to font-metric-derived baseline placement when this field
   * is absent.
   */
  readonly textLineBaselineYs?: readonly number[];
  /**
   * Per-codepoint runs of resolved font family — collapsed to one
   * entry per `[start, end)` half-open range over the element's
   * direct `text` whose runs share the same resolved family. This
   * reproduces Chromium's per-glyph font fallback (`<p style=
   * "font-family: Inter, 'Noto Sans JP', sans-serif">The fox 狐</p>`
   * → `[{0..20, "Inter"}, {20..21, "Noto Sans JP"}]`).
   *
   * The first family in the CSS `font-family` stack that
   * `document.fonts.check(font, char)` reports as available for that
   * codepoint wins — this is the Blink `FontFallbackIterator` order.
   * The element-level resolved family (carried by
   * `computedStyle["font-family"]`) is only correct when every
   * codepoint resolves to the stack head; the moment a fallback
   * fires (CJK in a Latin-first stack, emoji in any stack) the
   * element-level value lies. Emit consumers should prefer
   * per-codepoint runs to per-element resolution.
   *
   * Half-open ranges over the same character sequence `text` carries.
   * Absent for non-text elements.
   */
  readonly textCharacterFontRuns?: readonly { readonly start: number; readonly end: number; readonly fontFamily: string }[];
  readonly pseudo?: readonly PseudoJson[];
  readonly children: readonly ElementJson[];
};

/**
 * Capture the document under `window` into a serialisable snapshot.
 * Designed for `page.evaluate(() => captureSnapshot())` — must not
 * close over any host-side state. All helpers and constants live
 * inside the function body because Playwright serialises the
 * function into the page context, where outer-module bindings are
 * unreachable.
 */
export function captureSnapshot(): RawSnapshotJson {
  // Subset of CSS properties the IR needs. Adding a property
  // requires extending the IR + normalizer in lockstep — this is the
  // contract boundary between "what we capture" and "what we
  // interpret". Inlined inside the function so the in-page evaluate
  // sees it.
  const RELEVANT_STYLE_PROPS: readonly string[] = [
    "background-color",
    "background-image",
    "background-position",
    "background-repeat",
    "background-size",
    // CSS `float` removes a child from inline flow and floats it left
    // / right. Figma auto-layout has no float concept, so the
    // normaliser maps floated children to ABSOLUTE so their captured
    // bounding rect anchors them in the correct geometry without
    // pulling siblings out of flow.
    "float",
    "mask-image",
    "-webkit-mask-image",
    "mask-size",
    "-webkit-mask-size",
    "mask-position",
    "-webkit-mask-position",
    "mask-repeat",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-top-style",
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
    "box-shadow",
    "color",
    "display",
    "filter",
    "flex-direction",
    "flex-wrap",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "gap",
    "row-gap",
    "column-gap",
    "justify-content",
    "letter-spacing",
    "line-height",
    "mix-blend-mode",
    "opacity",
    "overflow",
    "overflow-x",
    "overflow-y",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "position",
    "text-align",
    "text-decoration-line",
    "text-transform",
    "transform",
    "visibility",
    "align-items",
    "z-index",
  ];
  const imageRegistry = new Map<string, string>();

  /**
   * Stable image id derived from the URL, *not* from observation
   * order. A monotonic counter (`img-1`, `img-2`, …) used to be
   * the registry key, which meant the same URL got a different id
   * across captures (depending on what other images preceded it
   * during the walk). That made fixtures non-reproducible and made
   * it impossible to correlate ids across `IR ↔ asset map ↔
   * downstream snapshots`. The current scheme hashes the URL with
   * a portable djb2-style fold and surfaces both the hash digest
   * and the URL inside the id, so a) two captures of the same
   * page produce identical ids, and b) a developer can tell at a
   * glance which asset an `img-…` id refers to without consulting
   * the registry.
   */
  function imageIdFor(url: string): string {
    // djb2 hash variant — straightforward, deterministic, no
    // platform-specific crypto dependency. Mask down to 32-bit and
    // hex-encode so the digest is short enough to embed in the id.
    // eslint-disable-next-line no-restricted-syntax -- accumulator for the hash fold
    let hash = 5381;
    for (let i = 0; i < url.length; i += 1) {
      hash = (hash * 33) ^ url.charCodeAt(i);
    }
    const digest = (hash >>> 0).toString(16).padStart(8, "0");
    return `img-${digest}`;
  }

  function registerImage(url: string): string {
    const existing = imageRegistry.get(url);
    if (existing !== undefined) {
      return existing;
    }
    const id = imageIdFor(url);
    imageRegistry.set(url, id);
    return id;
  }

  function rectFrom(r: DOMRect): { x: number; y: number; width: number; height: number } {
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function pickComputedStyle(el: Element): Record<string, string> {
    const computed = window.getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const prop of RELEVANT_STYLE_PROPS) {
      out[prop] = computed.getPropertyValue(prop);
    }
    // HTML4 presentation attributes — `<body background="...">`,
    // `<table background>`, etc. — are still rendered by every
    // major browser but `getComputedStyle().backgroundImage` returns
    // `none` because the resolution path is the legacy
    // "presentation hint", not CSS. Without this fixup the captured
    // computed style claims the element has no background and the
    // normaliser's `parseBackgroundImage` discards every imageId we
    // registered for the legacy attribute. Promote the attribute to
    // a synthetic `background-image: url(...)` so the rest of the
    // pipeline (normalize → emit) handles it via the standard
    // background-image path with no special case downstream.
    const legacyBg = legacyBackgroundUrl(el);
    if (legacyBg !== undefined && (out["background-image"] === "" || out["background-image"] === "none")) {
      out["background-image"] = `url("${legacyBg}")`;
    }
    return out;
  }

  function isVisible(el: Element, style: Record<string, string>): boolean {
    if (style.display === "none") {
      return false;
    }
    if (style.visibility === "hidden") {
      return false;
    }
    if (parseFloat(style.opacity ?? "1") === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    // Both axes must be > 0 for the element to occupy any pixels.
    // Sites use `height: 0` (or `width: 0`) as a "render this in the
    // DOM but show nothing" trick — typically for consent bars and
    // measurement helpers that animate open later. These should not
    // be captured as visible.
    if (r.width > 0 && r.height > 0) {
      return true;
    }
    // Block-level structural elements whose `getBoundingClientRect`
    // collapses on one axis but whose `offsetWidth`/`offsetHeight` /
    // `scrollWidth`/`scrollHeight` reports the real layout size. The
    // canonical case is `<html>` / `<body>` on a captured `body`-only
    // fixture where the browser's compositor reports a viewport-tall
    // body rect but the standalone document needs the scrollHeight
    // signal. Same for `<table>` descendants whose CSS table layout
    // computes correctly into offset metrics even when the bounding
    // rect is empty.
    const tagLow = el.tagName.toLowerCase();
    const isStructuralFallback = tagLow === "html" || tagLow === "body"
      || tagLow === "table" || tagLow === "thead" || tagLow === "tbody"
      || tagLow === "tfoot" || tagLow === "tr" || tagLow === "td" || tagLow === "th"
      || tagLow === "colgroup" || tagLow === "col";
    if (isStructuralFallback && el instanceof HTMLElement) {
      const w = Math.max(el.scrollWidth, el.offsetWidth, el.clientWidth);
      const h = Math.max(el.scrollHeight, el.offsetHeight, el.clientHeight);
      if (w > 0 && h > 0) {
        return true;
      }
      // `<tr>` (and the wrapping `<thead>` / `<tbody>` /
      // `<tfoot>`) report 0×0 from `offsetWidth/Height` in
      // browsers that treat row-level tags as anonymous boxes. A
      // visible cell descendant proves the row is actually
      // painting; trusting that signal keeps Wikipedia's nested-
      // table chrome (sidebars, infoboxes, navboxes) from being
      // dropped wholesale.
      if (descendantHasPaintArea(el)) {
        return true;
      }
    }
    // Inline-only elements (`<span>`, `<a>`) hit `boundingClientRect`
    // 0×0 even when they contain wrapped text — the union rect is
    // empty when the runs straddle a line break. Falling back to
    // `getClientRects()` lets us keep those text-bearing nodes
    // visible.
    const rects = el.getClientRects();
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i]!;
      if (rect.width !== 0 || rect.height !== 0) {
        return true;
      }
    }
    // Inline `<svg>` reports a 0×0 bounding rect when its host has
    // intrinsic geometry but the SVG itself doesn't — common inside
    // an icon button (`<yt-icon><svg>...</svg></yt-icon>`) where the
    // wrapper sizes the icon. Trust the parent's layout *only* in the
    // genuinely 0×0 case. SVGs with `width=N height=0` (or vice
    // versa) are sprite-sheet containers (Polymer/legacy YouTube put
    // their icon `<symbol>` definitions inside a body-level
    // `<svg width="100%" height="0">`) — those carry full-canvas
    // path geometry that paints across the whole frame if we
    // declare them visible. Excluding the partially-collapsed case
    // matches what the browser renders.
    if ((el.tagName === "SVG" || el.tagName === "svg") && r.width === 0 && r.height === 0) {
      return true;
    }
    // Lazy-loaded `<img loading="lazy">` outside the initial
    // viewport reports `getBoundingClientRect()` as 0×0 even when
    // the element has a real `src` and the browser has decoded the
    // bytes (the layout is suspended pending intersection). The
    // image is still part of the captured page surface — dropping
    // it would silently strip every below-the-fold thumbnail. We
    // restore visibility when the `<img>` advertises a non-zero
    // intrinsic size (`naturalWidth` is the post-decode pixel
    // dimension, which is independent of the lazy layout
    // suspension). The IR's `imageNaturalWidth/Height` decoration
    // already feeds these into the synth-frame path, so the image
    // ends up rendered at its intrinsic size at the captured (x,y).
    if (el.tagName === "IMG" && r.width === 0 && r.height === 0) {
      const img = el as HTMLImageElement;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Walk descendants and return true when any one paints a non-
   * zero-area rect. Used as the last-resort visibility signal for
   * structural wrappers (`<tr>` etc.) whose own rect may collapse
   * to 0×0 even though their cells render. We do NOT honour
   * descendant `<svg>` here — the caller's existing SVG fallback
   * handles those.
   */
  function descendantHasPaintArea(el: Element): boolean {
    const children = el.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      const rect = child.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return true;
      }
      if (descendantHasPaintArea(child)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Surface every distinct image URL the element references for
   * paint purposes, in CSS layer order. `<img src>` (single
   * value) plus every `url(...)` token inside `background-image`
   * (multi-layer comma-separated list).
   *
   * The walker keeps the order CSS authors wrote — `background-
   * image` layers paint top-to-bottom in source order, and the
   * downstream IR expects `imageIds[0]` to be the topmost paint.
   * Returning duplicates intentionally so the `<img>` tag and a
   * matching `background-image` layer both keep their own ids
   * (the registry de-duplicates by URL anyway, so duplicates
   * collapse onto a single asset).
   */
  function extractImageUrls(el: Element, style: Record<string, string>): string[] {
    const out: string[] = [];
    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      // Resolve the most authoritative source URL the browser knows
      // about. `currentSrc` is the post-srcset/picture decision; `src`
      // is the authored attribute (already absolutised by the
      // HTMLImageElement). Lazy-loaders also stash the real URL in
      // `data-src` / `data-original` / `data-lazy-src` while the
      // `src` attribute serves a placeholder — we honour those when
      // the live `currentSrc` is empty or points at a data URI smaller
      // than 200 bytes (the canonical 1×1 placeholder size). The order
      // of the lazy-loader fallbacks matches the most common
      // conventions in production CMSes (WordPress, MediaWiki,
      // Lazysizes, etc.).
      const candidates: string[] = [];
      const live = img.currentSrc || img.src;
      if (live && live.length > 0) {
        candidates.push(live);
      }
      const lazyAttrs = ["data-src", "data-original", "data-lazy-src", "data-srcset"];
      for (const attr of lazyAttrs) {
        const v = img.getAttribute(attr);
        if (v && v.length > 0) {
          candidates.push(v);
        }
      }
      const chosen = chooseImageSrc(candidates);
      if (chosen && chosen !== window.location.href) {
        out.push(chosen);
      }
    }
    // `<picture>` does not paint anything itself — its child `<img>`
    // is what carries the resolved geometry. We don't intercept here;
    // the walker descends into the picture and pulls the img's
    // currentSrc on its own visit. The same applies to `<video>`
    // poster: handled by the CSS poster image attribute below if the
    // page authored one as a `background-image`, otherwise out of
    // scope for the current IR.
    const bg = style["background-image"];
    if (bg && bg !== "none") {
      for (const u of extractUrlTokens(bg)) {
        out.push(u);
      }
    }
    // HTML4 presentation attribute `<body background="...">` /
    // `<table background>` / `<td background>` /
    // `<th background>` / `<tr background>`. Browsers still
    // render these (Abe Hiroshi's frameset site is the canonical
    // surviving example) but `getComputedStyle().backgroundImage`
    // returns `none` because the attribute resolves through the
    // legacy "presentation hint" path, not CSS. We pick it up
    // explicitly so the host-side response cache can resolve the
    // bytes.
    const presentationBg = legacyBackgroundUrl(el);
    if (presentationBg !== undefined) {
      out.push(presentationBg);
    }
    return out;
  }

  /**
   * Read the HTML4 `background` attribute on legacy presentation
   * elements and return the resolved absolute URL, or `undefined`
   * when no attribute is set. Resolution goes through the element's
   * own URL parsing (the browser handles absolute / relative paths
   * the same way it does for CSS `url()`), so a value of
   * `"image/abehiroshi.jpg"` on
   * `https://abehiroshi.la.coocan.jp/top.htm` becomes the absolute
   * `https://abehiroshi.la.coocan.jp/image/abehiroshi.jpg`.
   */
  function legacyBackgroundUrl(el: Element): string | undefined {
    const tag = el.tagName;
    if (tag !== "BODY" && tag !== "TABLE" && tag !== "TD" && tag !== "TH" && tag !== "TR") {
      return undefined;
    }
    const raw = el.getAttribute("background");
    if (raw === null || raw.length === 0) {
      return undefined;
    }
    // Resolve relative to the document's base URL. `URL` accepts the
    // base as the second arg; `document.baseURI` is the canonical
    // browser-resolved base for relative URLs in attributes.
    try {
      return new URL(raw, document.baseURI).href;
    } catch (_err: unknown) {
      void _err;
      return undefined;
    }
  }

  /**
   * Pick the most useful image URL from a list of candidates. Skips
   * tiny placeholder data URIs (1×1 GIFs, 1×1 PNGs that lazy-loaders
   * inject as the `src` placeholder while a `data-src` carries the
   * real URL). Picks the first non-placeholder candidate.
   */
  function chooseImageSrc(candidates: readonly string[]): string | undefined {
    for (const c of candidates) {
      if (!isPlaceholderDataUri(c)) {
        return c;
      }
    }
    // Every candidate looked like a placeholder — return the first
    // one anyway so the registry still gets *something* (better a
    // placeholder than nothing).
    return candidates[0];
  }

  function isPlaceholderDataUri(url: string): boolean {
    if (!url.startsWith("data:")) {
      return false;
    }
    // Sub-200-byte data URIs are essentially always 1×1 placeholders
    // (gif87a / 1x1 PNG / "blank.gif" base64 patterns). Real captured
    // images are always orders of magnitude bigger.
    return url.length < 200;
  }

  /**
   * Walk a CSS value and return every `url(...)` token's interior
   * URL in source order. Handles all three CSS forms:
   *   `url("...")` — double-quoted; `)` and `"` may appear inside
   *      only as `\)` / `\"` (rare but legal).
   *   `url('...')` — single-quoted; symmetric.
   *   `url(...)`   — unquoted; `)`, whitespace, `"`, `'` are
   *      forbidden inside per the CSS spec, so a plain reverse-
   *      scan to the matching `)` is sufficient.
   *
   * The naïve `/url\(['"]?([^'")]+)['"]?\)/g` regex breaks on
   * `data:image/svg+xml,...` URLs whose body contains the
   * *opposite* quote (e.g. a double-quoted url whose SVG body
   * uses single quotes for path attribute values). The
   * character-stream walker below stops only at the
   * **opening-quote-matched** terminator.
   */
  function extractUrlTokens(value: string): string[] {
    const out: string[] = [];
    const length = value.length;
    // eslint-disable-next-line no-restricted-syntax -- character cursor is intrinsically mutable
    let i = 0;
    while (i < length) {
      const start = value.indexOf("url(", i);
      if (start < 0) {
        return out;
      }
      // eslint-disable-next-line no-restricted-syntax -- cursor advances past the literal
      let cur = start + 4;
      while (cur < length && (value[cur] === " " || value[cur] === "\t")) {
        cur += 1;
      }
      if (cur >= length) {
        return out;
      }
      const head = value[cur]!;
      if (head === '"' || head === "'") {
        const quote = head;
        cur += 1;
        // eslint-disable-next-line no-restricted-syntax -- accumulator
        let body = "";
        while (cur < length) {
          const c = value[cur]!;
          if (c === "\\" && cur + 1 < length) {
            body += value[cur + 1]!;
            cur += 2;
            continue;
          }
          if (c === quote) {
            break;
          }
          body += c;
          cur += 1;
        }
        out.push(body);
        // Skip to the closing `)` after the quoted string.
        const close = value.indexOf(")", cur);
        i = close < 0 ? length : close + 1;
        continue;
      }
      // Unquoted: read until the closing `)`. CSS forbids ')'
      // inside an unquoted url, so a literal scan suffices.
      const close = value.indexOf(")", cur);
      if (close < 0) {
        return out;
      }
      const body = value.slice(cur, close).trim();
      if (body.length > 0) {
        out.push(body);
      }
      i = close + 1;
    }
    return out;
  }

  function extractMaskImageUrl(style: Record<string, string>): string | undefined {
    // CSS `mask-image`: the browser silhouettes the element's
    // `background-color` (or `color` when the layer flows from the
    // foreground) through the mask asset's alpha. Returning the
    // URL here lets the host walk pull the SVG bytes out of the
    // Playwright response cache and parse them into a vector node.
    const mask = style["mask-image"] ?? style["-webkit-mask-image"];
    if (!mask || mask === "none") {
      return undefined;
    }
    const match = mask.match(/url\((['"]?)([^'")]+)\1\)/);
    if (!match) {
      return undefined;
    }
    return match[2];
  }

  /**
   * Concatenate every direct text node into a single string.
   *
   * The order between a text node and its sibling elements is *not*
   * preserved here — the consumer assumes "all direct text first,
   * then children". For paragraphs whose source order is `<a>X</a>Y`
   * (text after element) the run order produced by the normaliser
   * therefore disagrees with the visual flow. `interleavedTextSlots`
   * fixes that by emitting per-position text fragments; this helper
   * stays as a convenience for the rare callers that genuinely
   * want the concatenated form.
   */
  function directText(el: Element): string {
    return Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
  }

  /**
   * Build a parallel array (one slot per element child) of the text
   * that immediately precedes each element child plus a trailing
   * tail-text slot. The output length equals `el.children.length + 1`.
   *
   * Example for `<div>foo<a>bar</a> baz<b>qux</b></div>`:
   *   [ "foo", " baz", "" ]
   * which the normaliser interleaves with the rendered children to
   * produce the visual "foo bar baz qux" sequence.
   *
   * Whitespace handling matches the legacy `directText` for the
   * common case (`.trim()` on both ends), but inter-element runs of
   * whitespace are preserved verbatim — they're what carries the
   * inter-anchor space in `<a>foo</a> <a>bar</a>`.
   */
  function interleavedTextSlots(el: Element): string[] {
    const elementChildren = Array.from(el.children);
    const slots: string[] = new Array(elementChildren.length + 1).fill("");
    const cursor = { value: 0 };
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const idx = elementChildren.indexOf(node as Element);
        if (idx >= 0) {
          cursor.value = idx + 1;
        }
        continue;
      }
      if (node.nodeType !== Node.TEXT_NODE) {
        continue;
      }
      const text = node.textContent ?? "";
      slots[cursor.value] = (slots[cursor.value] ?? "") + text;
    }
    // Collapse runs of whitespace into a single space — that's what
    // the browser renders. Leading / trailing whitespace at the
    // outermost slot edges (before any element + after every element)
    // is stripped to keep the IR free of decorative line breaks the
    // browser hides.
    return slots.map((slot, i) => {
      const collapsed = slot.replace(/\s+/g, " ");
      if (i === 0) {
        return collapsed.replace(/^\s+/, "");
      }
      if (i === slots.length - 1) {
        return collapsed.replace(/\s+$/, "");
      }
      return collapsed;
    });
  }

  function contentRectFor(el: Element, style: Record<string, string>): { x: number; y: number; width: number; height: number } {
    const r = el.getBoundingClientRect();
    const bt = parseFloat(style["border-top-width"] ?? "0");
    const bl = parseFloat(style["border-left-width"] ?? "0");
    const br = parseFloat(style["border-right-width"] ?? "0");
    const bb = parseFloat(style["border-bottom-width"] ?? "0");
    return {
      x: r.x + bl,
      y: r.y + bt,
      width: Math.max(0, r.width - bl - br),
      height: Math.max(0, r.height - bt - bb),
    };
  }

  function extractSvgContent(el: Element): SvgContentJson | undefined {
    if (el.tagName !== "SVG" && el.tagName !== "svg") {
      return undefined;
    }
    const svgEl = el as SVGSVGElement;
    const paths: SvgPathJson[] = [];

    // ---- Inline mirrors of `svg-utils.ts` helpers ----
    //
    // Playwright's `page.evaluate` serialises the function body into
    // the page context and outer-module bindings (the `parseSvgTransform`
    // / `shapeToPathData` exports) are unreachable. So the algorithms
    // below intentionally *duplicate* those helpers verbatim. The SoT
    // is `svg-utils.ts` (where they are unit-tested); any drift in
    // either copy is a bug to be reconciled — keep the two in sync
    // when you change one.
    type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
    const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    function multiply(m1: Affine, m2: Affine): Affine {
      return {
        a: m1.a * m2.a + m1.c * m2.b,
        b: m1.b * m2.a + m1.d * m2.b,
        c: m1.a * m2.c + m1.c * m2.d,
        d: m1.b * m2.c + m1.d * m2.d,
        e: m1.a * m2.e + m1.c * m2.f + m1.e,
        f: m1.b * m2.e + m1.d * m2.f + m1.f,
      };
    }
    function transformFnToAffine(name: string, args: number[]): Affine {
      switch (name) {
        case "matrix":
          if (args.length !== 6) {return IDENTITY;}
          return { a: args[0]!, b: args[1]!, c: args[2]!, d: args[3]!, e: args[4]!, f: args[5]! };
        case "translate":
          return { a: 1, b: 0, c: 0, d: 1, e: args[0] ?? 0, f: args[1] ?? 0 };
        case "scale": {
          const sx = args[0] ?? 1;
          const sy = args.length > 1 ? args[1]! : sx;
          return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
        }
        case "rotate": {
          const angle = (args[0] ?? 0) * Math.PI / 180;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          if (args.length >= 3) {
            const cx = args[1]!;
            const cy = args[2]!;
            const t1: Affine = { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy };
            const r: Affine = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
            const t2: Affine = { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy };
            return multiply(multiply(t1, r), t2);
          }
          return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
        }
        case "skewx": {
          const tan = Math.tan((args[0] ?? 0) * Math.PI / 180);
          return { a: 1, b: 0, c: tan, d: 1, e: 0, f: 0 };
        }
        case "skewy": {
          const tan = Math.tan((args[0] ?? 0) * Math.PI / 180);
          return { a: 1, b: tan, c: 0, d: 1, e: 0, f: 0 };
        }
        default:
          return IDENTITY;
      }
    }
    function parseTransform(value: string | null): Affine {
      if (value === null || value === undefined) {return IDENTITY;}
      const trimmed = value.trim();
      if (trimmed.length === 0) {return IDENTITY;}
      const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
      const acc: Affine[] = [];
      for (let m = re.exec(trimmed); m !== null; m = re.exec(trimmed)) {
        const name = m[1]!.toLowerCase();
        const args = m[2]!
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => parseFloat(s))
          .filter((n) => Number.isFinite(n));
        acc.push(transformFnToAffine(name, args));
      }
      return acc.reduce((a, b) => multiply(a, b), IDENTITY);
    }
    function isIdentity(m: Affine): boolean {
      return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
    }
    function composeTransform(parent: Affine, own: Affine): Affine {
      if (isIdentity(own)) {
        return parent;
      }
      return multiply(parent, own);
    }
    function makeTranslateAffine(tx: number, ty: number): Affine {
      if (tx === 0 && ty === 0) {
        return IDENTITY;
      }
      return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
    }
    function getNumAttr(node: Element, name: string, fallback: number): number {
      const raw = node.getAttribute(name);
      if (raw === null) {return fallback;}
      const trimmed = raw.trim();
      if (trimmed.length === 0) {return fallback;}
      const n = parseFloat(trimmed);
      return Number.isFinite(n) ? n : fallback;
    }
    const KAPPA = 0.5522847498307933;
    function shapeToD(node: Element): string | undefined {
      const tag = node.tagName.toLowerCase();
      switch (tag) {
        case "rect": {
          const x = getNumAttr(node, "x", 0);
          const y = getNumAttr(node, "y", 0);
          const w = getNumAttr(node, "width", 0);
          const h = getNumAttr(node, "height", 0);
          if (w <= 0 || h <= 0) {return undefined;}
          const rxRaw = getNumAttr(node, "rx", NaN);
          const ryRaw = getNumAttr(node, "ry", NaN);
          const rxResolved = Number.isFinite(rxRaw) ? rxRaw : (Number.isFinite(ryRaw) ? ryRaw : 0);
          const ryResolved = Number.isFinite(ryRaw) ? ryRaw : (Number.isFinite(rxRaw) ? rxRaw : 0);
          const rx = Math.min(Math.max(0, rxResolved), w / 2);
          const ry = Math.min(Math.max(0, ryResolved), h / 2);
          if (rx === 0 && ry === 0) {
            return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
          }
          const cx = rx * KAPPA;
          const cy = ry * KAPPA;
          return [
            `M ${x + rx} ${y}`,
            `H ${x + w - rx}`,
            `C ${x + w - rx + cx} ${y}, ${x + w} ${y + ry - cy}, ${x + w} ${y + ry}`,
            `V ${y + h - ry}`,
            `C ${x + w} ${y + h - ry + cy}, ${x + w - rx + cx} ${y + h}, ${x + w - rx} ${y + h}`,
            `H ${x + rx}`,
            `C ${x + rx - cx} ${y + h}, ${x} ${y + h - ry + cy}, ${x} ${y + h - ry}`,
            `V ${y + ry}`,
            `C ${x} ${y + ry - cy}, ${x + rx - cx} ${y}, ${x + rx} ${y}`,
            "Z",
          ].join(" ");
        }
        case "circle": {
          const ccx = getNumAttr(node, "cx", 0);
          const ccy = getNumAttr(node, "cy", 0);
          const r = getNumAttr(node, "r", 0);
          if (r <= 0) {return undefined;}
          const ox = r * KAPPA;
          return [
            `M ${ccx - r} ${ccy}`,
            `C ${ccx - r} ${ccy - ox}, ${ccx - ox} ${ccy - r}, ${ccx} ${ccy - r}`,
            `C ${ccx + ox} ${ccy - r}, ${ccx + r} ${ccy - ox}, ${ccx + r} ${ccy}`,
            `C ${ccx + r} ${ccy + ox}, ${ccx + ox} ${ccy + r}, ${ccx} ${ccy + r}`,
            `C ${ccx - ox} ${ccy + r}, ${ccx - r} ${ccy + ox}, ${ccx - r} ${ccy}`,
            "Z",
          ].join(" ");
        }
        case "ellipse": {
          const ecx = getNumAttr(node, "cx", 0);
          const ecy = getNumAttr(node, "cy", 0);
          const erx = getNumAttr(node, "rx", 0);
          const ery = getNumAttr(node, "ry", 0);
          if (erx <= 0 || ery <= 0) {return undefined;}
          const ox = erx * KAPPA;
          const oy = ery * KAPPA;
          return [
            `M ${ecx - erx} ${ecy}`,
            `C ${ecx - erx} ${ecy - oy}, ${ecx - ox} ${ecy - ery}, ${ecx} ${ecy - ery}`,
            `C ${ecx + ox} ${ecy - ery}, ${ecx + erx} ${ecy - oy}, ${ecx + erx} ${ecy}`,
            `C ${ecx + erx} ${ecy + oy}, ${ecx + ox} ${ecy + ery}, ${ecx} ${ecy + ery}`,
            `C ${ecx - ox} ${ecy + ery}, ${ecx - erx} ${ecy + oy}, ${ecx - erx} ${ecy}`,
            "Z",
          ].join(" ");
        }
        case "line": {
          const x1 = getNumAttr(node, "x1", 0);
          const y1 = getNumAttr(node, "y1", 0);
          const x2 = getNumAttr(node, "x2", 0);
          const y2 = getNumAttr(node, "y2", 0);
          return `M ${x1} ${y1} L ${x2} ${y2}`;
        }
        case "polygon":
        case "polyline": {
          const raw = (node.getAttribute("points") ?? "").trim();
          const tokens = raw.split(/[\s,]+/).map((s) => parseFloat(s)).filter((n) => Number.isFinite(n));
          if (tokens.length < 4 || tokens.length % 2 !== 0) {return undefined;}
          const segs: string[] = [`M ${tokens[0]!} ${tokens[1]!}`];
          for (let i = 2; i < tokens.length; i += 2) {
            segs.push(`L ${tokens[i]!} ${tokens[i + 1]!}`);
          }
          if (tag === "polygon") {segs.push("Z");}
          return segs.join(" ");
        }
        default:
          return undefined;
      }
    }
    // ---- end inline mirror ----

    // Resolve `<use>` references where possible by following the
    // `href`/`xlink:href` attribute. The shadow DOM ones (custom
    // elements) won't resolve via querySelector because the target
    // sits in another document — those are dropped silently.
    function recordPath(d: string, source: Element, transform: Affine): void {
      if (!d || d.length === 0) {return;}
      const computed = window.getComputedStyle(source);
      const fillAttr = source.getAttribute("fill") ?? computed.fill;
      const strokeAttr = source.getAttribute("stroke") ?? computed.stroke;
      const strokeWidthAttr = source.getAttribute("stroke-width") ?? computed.strokeWidth;
      const fillRuleAttr = source.getAttribute("fill-rule") ?? computed.fillRule;
      const path: SvgPathJson = {
        d,
        fill: fillAttr && fillAttr !== "none" ? fillAttr : undefined,
        stroke: strokeAttr && strokeAttr !== "none" ? strokeAttr : undefined,
        strokeWidth: strokeWidthAttr ? parseFloat(strokeWidthAttr) : undefined,
        fillRule: fillRuleAttr === "evenodd" ? "evenodd" : undefined,
        transform: isIdentity(transform) ? undefined : transform,
      };
      paths.push(path);
    }
    function collectPaths(root: Element): void {
      type Frame = { node: Element; transform: Affine };
      const queue: Frame[] = [{ node: root, transform: IDENTITY }];
      while (queue.length > 0) {
        const frame = queue.shift()!;
        const current = frame.node;
        // Compose the current node's `transform` attribute on top of
        // the inherited matrix. `<g transform>` is the canonical
        // case; `<path transform>` and `<rect transform>` are
        // permitted by SVG and we honour them here too.
        const ownTransform = parseTransform(current.getAttribute("transform"));
        const accumulated = composeTransform(frame.transform, ownTransform);
        const tag = current.tagName.toLowerCase();
        if (tag === "path") {
          const d = current.getAttribute("d");
          if (d && d.length > 0) {
            recordPath(d, current, accumulated);
          }
        } else if (tag === "rect" || tag === "circle" || tag === "ellipse"
          || tag === "line" || tag === "polygon" || tag === "polyline") {
          const d = shapeToD(current);
          if (d !== undefined) {
            recordPath(d, current, accumulated);
          }
        } else if (tag === "use") {
          const useEl = current as SVGUseElement;
          const href = useEl.getAttribute("href") ?? useEl.getAttribute("xlink:href");
          if (href && href.startsWith("#")) {
            const target = svgEl.ownerDocument?.getElementById(href.slice(1));
            if (target) {
              // `<use>` may carry its own x/y offset which acts as a
              // translate on top of the referenced subtree.
              const ux = getNumAttr(useEl, "x", 0);
              const uy = getNumAttr(useEl, "y", 0);
              const useOffset = makeTranslateAffine(ux, uy);
              const useTransform = composeTransform(accumulated, useOffset);
              queue.push({ node: target, transform: useTransform });
              continue;
            }
          }
        }
        for (const child of Array.from(current.children)) {
          queue.push({ node: child, transform: accumulated });
        }
      }
    }
    collectPaths(svgEl);
    const viewBoxAttr = svgEl.getAttribute("viewBox");
    let viewBox: SvgContentJson["viewBox"];
    if (viewBoxAttr) {
      const parts = viewBoxAttr.trim().split(/[\s,]+/).map((s) => parseFloat(s));
      if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
        viewBox = { minX: parts[0]!, minY: parts[1]!, width: parts[2]!, height: parts[3]! };
      }
    }
    if (paths.length === 0) {
      return undefined;
    }
    return { viewBox, paths };
  }

  function effectiveRectFor(el: Element): { x: number; y: number; width: number; height: number } {
    const r = el.getBoundingClientRect();
    // For `<html>` and `<body>` the bounding rect intentionally pins
    // to the viewport (CSS spec: ICB is the initial containing
    // block) — even on a 7000px-tall document the rect reports
    // 1280×800. The web-to-fig IR's root must cover the *document*
    // because that is what the rendered `.fig` represents (full
    // page capture, not a viewport screenshot). Take the
    // scrollHeight so the root expands to the document's authored
    // size.
    const tag = el.tagName.toLowerCase();
    if (tag === "html" || tag === "body") {
      const html = el as HTMLElement;
      const w = Math.max(r.width, html.scrollWidth, html.offsetWidth, html.clientWidth);
      const h = Math.max(r.height, html.scrollHeight, html.offsetHeight, html.clientHeight);
      if (w > 0 && h > 0) {
        return { x: r.x, y: r.y, width: w, height: h };
      }
    }
    if (r.width !== 0 && r.height !== 0) {
      return rectFrom(r);
    }
    // Inline `<svg>` reports its bounding box as 0×0 even though its
    // child paths paint visible glyphs. Use the parent's content
    // rect as the effective box so the IR carries a non-zero size
    // for icon assets.
    //
    // Only inherit when *both* axes of the parent rect are positive.
    // A "1280 × 0" or "0 × 768" rect (typical body-level sprite
    // container `<svg width="100%" height="0">`) would otherwise
    // bake in a degenerate axis: Figma's renderer leaves degenerate
    // VECTOR nodes undefined, so smuggling a 1280-wide / 0-tall path
    // through silently drops it on Figma proper but trips the WebGL
    // renderer's path filler into painting a giant black slab.
    // Keeping the original 0×0 makes `isVisible` mark the node not
    // visible and `normalizeFrame` filters it out.
    if (el.tagName === "SVG" || el.tagName === "svg") {
      const parent = el.parentElement;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (pr.width > 0 && pr.height > 0) {
          return rectFrom(pr);
        }
      }
    }
    // Block-level structural elements (`<html>`, `<body>`, table
    // descendants) sometimes report 0 on one axis even when their
    // descendants paint thousands of pixels:
    //
    //   - `<html>` and `<body>` collapse to viewport height when the
    //     document has no positioned content yet `scrollHeight` reports
    //     the real authored height. This happens on full-page captures
    //     where `body` is the extraction selector — the standalone
    //     fixture's `<body>` carries every column, footer, and modal
    //     descendant under a 0-height root.
    //   - `<table>`, `<thead>`, `<tbody>`, `<tfoot>`, `<tr>` and
    //     `<colgroup>` participate in CSS table layout, where browsers
    //     occasionally report a degenerate `getBoundingClientRect()`
    //     for the wrapper while every child cell is sized correctly.
    //     Using `offsetWidth` / `offsetHeight` from the underlying
    //     HTMLElement closes the gap because table layout DOES expose
    //     non-zero offset metrics even when the bounding rect is empty.
    //
    // `<html>` / `<body>` are handled at the top of this function
    // (their bounding rect is non-zero but viewport-pinned, which we
    // override with scrollHeight so the IR root covers the full
    // document). `offsetWidth` / `offsetHeight` is the right escape
    // hatch for table descendants because CSS table layout pins it
    // to the rendered cell geometry — bounding rect can still be
    // 0×0 there.
    const isTablePart = tag === "table" || tag === "thead" || tag === "tbody"
      || tag === "tfoot" || tag === "tr" || tag === "colgroup" || tag === "col"
      || tag === "td" || tag === "th";
    if (isTablePart && el instanceof HTMLElement) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        return { x: r.x, y: r.y, width: w, height: h };
      }
      // `<tr>` / `<tbody>` etc. that report 0×0 from offset
      // metrics still have visible cells; reconstruct their box
      // as the union of their painting descendants. Without this
      // the visibility filter drops the row, the row's children
      // are unreachable from normalize, and every nested
      // `<table>` (Wikipedia's navboxes, infoboxes and sidebars)
      // disappears from the IR.
      const union = unionOfDescendantRects(el);
      if (union !== undefined) {
        return union;
      }
    }
    return rectFrom(r);
  }

  /**
   * Return the union of `getBoundingClientRect()` over every
   * descendant that paints non-zero area, or `undefined` when no
   * descendant qualifies. Used to reconstruct an opaque box for a
   * structural wrapper whose own rect is degenerate.
   */
  function unionOfDescendantRects(el: Element): { x: number; y: number; width: number; height: number } | undefined {
    const acc = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, hit: false };
    function walkDeep(n: Element): void {
      const children = n.children;
      for (let i = 0; i < children.length; i += 1) {
        const c = children[i]!;
        if (!(c instanceof HTMLElement)) {
          continue;
        }
        const r2 = c.getBoundingClientRect();
        if (r2.width > 0 && r2.height > 0) {
          if (r2.x < acc.minX) { acc.minX = r2.x; }
          if (r2.y < acc.minY) { acc.minY = r2.y; }
          if (r2.x + r2.width > acc.maxX) { acc.maxX = r2.x + r2.width; }
          if (r2.y + r2.height > acc.maxY) { acc.maxY = r2.y + r2.height; }
          acc.hit = true;
        }
        walkDeep(c);
      }
    }
    walkDeep(el);
    if (!acc.hit) {
      return undefined;
    }
    return { x: acc.minX, y: acc.minY, width: acc.maxX - acc.minX, height: acc.maxY - acc.minY };
  }

  function pseudoStyleSubset(pseudoStyle: CSSStyleDeclaration): Record<string, string> {
    const out: Record<string, string> = {};
    for (const prop of RELEVANT_STYLE_PROPS) {
      out[prop] = pseudoStyle.getPropertyValue(prop);
    }
    return out;
  }

  /**
   * Decode a CSS `content` value into the literal text it injects.
   *
   * `getComputedStyle(el, "::before").content` returns the value
   * post-resolution: literal strings come back wrapped in matching
   * `"` or `'` quotes (e.g. `"\" / \""`); `attr(href)` resolves to
   * the attribute value also quoted; `none`/`normal`/empty mean the
   * pseudo doesn't paint anything. We only handle the literal-string
   * form here because the IR's TEXT node has no concept of
   * `attr()` / `counter()` / `url(...)` injection.
   */
  function decodeContentValue(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "none" || trimmed === "normal") {
      return undefined;
    }
    // Multiple content tokens (`"foo " attr(href)`) merge in document
    // order. We only honour the leading literal-string token; any
    // remaining tokens that aren't literal strings drop the whole
    // pseudo (rather than half-render it).
    if (trimmed[0] !== '"' && trimmed[0] !== "'") {
      return undefined;
    }
    const quote = trimmed[0]!;
    if (trimmed[trimmed.length - 1] !== quote) {
      return undefined;
    }
    return trimmed.slice(1, -1);
  }

  function readPseudo(el: Element): PseudoJson[] {
    const out: PseudoJson[] = [];
    for (const which of ["before", "after"] as const) {
      const pseudoStyle = window.getComputedStyle(el, `::${which}`);
      const decoded = decodeContentValue(pseudoStyle.content);
      if (decoded === undefined) {
        continue;
      }
      // `display: none` pseudos paint nothing — skip so the IR
      // doesn't synthesise empty TEXT children for a styling-only
      // sentinel.
      if (pseudoStyle.display === "none") {
        continue;
      }
      out.push({
        which,
        text: decoded,
        computedStyle: pseudoStyleSubset(pseudoStyle),
      });
    }
    return out;
  }

  /**
   * Surface the visible string a form control paints. The DOM tree
   * has no child node carrying that text, so without this fallback
   * the search box, button labels, and select options render as
   * empty rectangles. We honour:
   *   - `<input value="...">` and `<textarea>` text content
   *   - `<input placeholder="...">` when `value` is empty
   *   - `<button>` / `<option>` direct text (already covered by
   *     `directText`, but the formControlText pull keeps the API
   *     uniform)
   */
  function formControlText(el: Element): string | undefined {
    if (el.tagName === "INPUT") {
      const input = el as HTMLInputElement;
      if (input.type === "hidden" || input.type === "checkbox" || input.type === "radio") {
        return undefined;
      }
      // Submit/reset/button type inputs paint their `value` as the
      // label inside the UA chrome — same as a `<button>` would.
      const value = input.value;
      if (value && value.length > 0) {
        return value;
      }
      const placeholder = input.placeholder;
      if (placeholder && placeholder.length > 0) {
        return placeholder;
      }
      return undefined;
    }
    if (el.tagName === "TEXTAREA") {
      const ta = el as HTMLTextAreaElement;
      const value = ta.value;
      if (value && value.length > 0) {
        return value;
      }
      const placeholder = ta.placeholder;
      if (placeholder && placeholder.length > 0) {
        return placeholder;
      }
      return undefined;
    }
    if (el.tagName === "SELECT") {
      // The selected `<option>` text is what the UA chrome renders
      // as the closed control's label. Skipping it would leave the
      // dropdown blank in the captured snapshot.
      const select = el as HTMLSelectElement;
      const idx = select.selectedIndex;
      if (idx >= 0 && idx < select.options.length) {
        const opt = select.options[idx]!;
        const text = opt.text || opt.label || opt.value;
        if (text && text.length > 0) {
          return text;
        }
      }
      return undefined;
    }
    return undefined;
  }

  function walk(el: Element, path: string): ElementJson {
    const style = pickComputedStyle(el);
    const visible = isVisible(el, style);
    const rect = effectiveRectFor(el);
    const contentRect = contentRectFor(el, style);
    const svgContent = extractSvgContent(el);
    const imageUrls = svgContent === undefined ? extractImageUrls(el, style) : [];
    const imageIds = imageUrls.map((u) => registerImage(u));
    const imageId = imageIds.length > 0 ? imageIds[0] : undefined;
    const maskUrl = svgContent === undefined ? extractMaskImageUrl(style) : undefined;
    const maskImageId = maskUrl ? registerImage(maskUrl) : undefined;
    const directTextValue = directText(el);
    const fragments = interleavedTextSlots(el);
    // Form controls have no child text node carrying the painted
    // string, so we lift `value` / `placeholder` up into the
    // element's `text` field. The normaliser then treats the
    // control as a self-contained paragraph host.
    const formText = formControlText(el);
    const text = pickTextForElement(formText, directTextValue);
    const pseudo = readPseudo(el);
    // Inline SVG content is captured as a vector node; do not
    // recurse into its `<path>` / `<g>` descendants — they would
    // emit as confused frame children otherwise.
    //
    // Custom elements (Polymer / Lit / etc.) hide visible content
    // inside their shadow root — walking only `el.children` would
    // skip every YouTube `<yt-icon>` / `<yt-img-shadow>` / search
    // box. Combine light-DOM children with the shadow root's
    // children so the snapshot captures both layers.
    const lightChildren = Array.from(el.children);
    const shadowChildren = readShadowChildren(el);
    const allChildren = [...shadowChildren, ...lightChildren];
    const children: ElementJson[] = walkChildrenUnlessSvg(svgContent, allChildren, path);
    // `interleavedTextSlots` is keyed off `el.children` only — the
    // shadow-DOM pseudo-children we prepended don't contribute text
    // nodes the slot map can address. Pad the leading shadow-child
    // count with empty fragments so `fragments[i]` continues to line
    // up with `children[i]` after the prepend.
    const paddedFragments = buildPaddedFragments(svgContent, fragments, shadowChildren.length, lightChildren.length);
    // Capture per-line rects for text-bearing elements. `Range
    // .getClientRects()` returns one rect per visual line the browser
    // laid the element's text into — the canonical source of truth
    // for "did this paragraph wrap, and where?". The renderer trusts
    // these to skip its own approximate wrap re-derivation.
    //
    // Inlined here because Playwright serialises this whole walker
    // into the page context — extracting it into a helper outside
    // `walk` would lose the closure reference and break in-page
    // execution.
    const textLineRects = text.length > 0 ? collectTextLineRects(el) : undefined;
    const textLineBaselineYs = text.length > 0 ? collectTextLineBaselineYs(el) : undefined;
    return {
      id: path,
      tag: el.tagName.toLowerCase(),
      rect,
      contentRect,
      visible,
      computedStyle: style,
      imageId,
      imageIds: imageIds.length > 0 ? imageIds : undefined,
      maskImageId,
      svgContent,
      text: text.length > 0 ? text : undefined,
      textFragments: emitPaddedFragmentsIfNonEmpty(paddedFragments),
      textLineRects,
      textLineBaselineYs,
      pseudo: pseudo.length > 0 ? pseudo : undefined,
      children,
    };
  }

  /**
   * Read per-line client rects off an element's text content via the
   * Range API. Returns `undefined` when the API throws (detached /
   * shadow-host nodes) or no non-zero-area rects come back. The
   * caller decides whether to surface `undefined` as "no captured
   * line breakdown" or pass it through verbatim.
   */
  function collectTextLineRects(
    el: Element,
  ): readonly { x: number; y: number; width: number; height: number }[] | undefined {
    const collected: { x: number; y: number; width: number; height: number }[] = [];
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lineList = range.getClientRects();
      for (let i = 0; i < lineList.length; i += 1) {
        const r = lineList[i]!;
        if (r.width > 0 && r.height > 0) {
          collected.push({ x: r.left, y: r.top, width: r.width, height: r.height });
        }
      }
    } catch (_err) {
      void _err;
      return undefined;
    }
    return collected.length > 0 ? collected : undefined;
  }

  /**
   * Read per-visual-line baseline Y positions (in viewport
   * coordinates) from the browser's own typesetting. The renderer
   * uses these to place each line's glyph baseline at the exact spot
   * the browser painted, sidestepping the half-leading /
   * sTypoAscender / CoreText interpretation differences that
   * font-metric-only baseline derivation cannot fully recover.
   *
   * Per-line rather than first-line-only because CSS allows the line
   * box's baseline to vary line-to-line — `vertical-align`, inline
   * children with taller `line-height`, image inlines, or
   * `font-size`-changing spans within a paragraph all reshape the
   * dominant baseline of the line they appear on. A single
   * `firstLineBaselineY` would collapse that variation; capturing
   * one baseline per line preserves it.
   *
   * Strategy: walk `Range.getClientRects()` (the same lines
   * `collectTextLineRects` returns). For each line subtract the
   * element's `fontBoundingBoxDescent` from the rect's `bottom`. The
   * element-level font is correct here because text within a single
   * walker entry shares a font face — runs with different fonts
   * surface as separate inline elements that get their own walker
   * entry and per-line baseline.
   *
   * Length contract: returned array has the same length as the rect
   * list `collectTextLineRects` would return. When the descent
   * metric is unavailable (Canvas API missing or font not parseable)
   * the whole array is omitted; mixing valid and undefined entries
   * would force every downstream consumer to handle nullable items,
   * which buys nothing — the fallback path already covers the
   * "no baseline available" case for the entire element.
   */
  function collectTextLineBaselineYs(el: Element): readonly number[] | undefined {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lineList = range.getClientRects();
      const lineRects: DOMRect[] = [];
      for (let i = 0; i < lineList.length; i += 1) {
        const r = lineList[i]!;
        if (r.width > 0 && r.height > 0) {
          lineRects.push(r);
        }
      }
      if (lineRects.length === 0) {
        return undefined;
      }
      const cs = window.getComputedStyle(el);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return undefined;
      }
      // Build a CSS `font` shorthand from the element's computed style
      // so Canvas's metrics describe the same face the layout used.
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      // `fontBoundingBox*` depends only on the font + size, not the
      // string — the probe character is arbitrary.
      const metrics = ctx.measureText("x");
      const fbDescent = (metrics as TextMetrics & { fontBoundingBoxDescent?: number }).fontBoundingBoxDescent;
      if (typeof fbDescent !== "number") {
        return undefined;
      }
      const out: number[] = [];
      for (const r of lineRects) {
        out.push(r.bottom - fbDescent);
      }
      return out;
    } catch (_err) {
      void _err;
      return undefined;
    }
  }

  /**
   * Form controls have no child text node carrying the painted string,
   * so we lift `value` / `placeholder` up into the element's `text`
   * field. Direct text content always wins when present.
   */
  function pickTextForElement(formText: string | undefined, directTextValue: string): string {
    if (formText !== undefined && directTextValue.length === 0) return formText;
    return directTextValue;
  }

  /**
   * Light/shadow walker for `el.shadowRoot`. Returns `[]` when the
   * element has no shadow root so callers can spread without branching.
   */
  function readShadowChildren(el: Element): Element[] {
    const host = el as Element & { shadowRoot?: ShadowRoot | null };
    if (!host.shadowRoot) return [];
    return Array.from(host.shadowRoot.children);
  }

  /**
   * Inline SVG content is captured as a vector node — don't recurse
   * into its `<path>` / `<g>` descendants.
   */
  function walkChildrenUnlessSvg(
    svgContent: unknown,
    allChildren: readonly Element[],
    path: string,
  ): ElementJson[] {
    if (svgContent !== undefined) return [];
    return allChildren.map((child, index) => walk(child, `${path}/${index}`));
  }

  function buildPaddedFragments(
    svgContent: unknown,
    fragments: readonly string[],
    shadowCount: number,
    lightCount: number,
  ): readonly string[] | undefined {
    if (svgContent !== undefined) return undefined;
    return padFragments(fragments, shadowCount, lightCount);
  }

  function emitPaddedFragmentsIfNonEmpty(
    paddedFragments: readonly string[] | undefined,
  ): readonly string[] | undefined {
    if (paddedFragments && paddedFragmentsHaveContent(paddedFragments)) return paddedFragments;
    return undefined;
  }

  function padFragments(
    lightFragments: readonly string[],
    shadowCount: number,
    lightCount: number,
  ): readonly string[] {
    if (shadowCount === 0) {
      return lightFragments;
    }
    // Insert `shadowCount` empty leading slots so fragment[i]
    // matches the ordering of `[...shadowChildren, ...lightChildren]`.
    // The light fragments themselves remain attached to their
    // original light-children positions; the trailing slot stays
    // last because it represents "after every child".
    const out: string[] = [];
    for (let i = 0; i < shadowCount; i += 1) {
      out.push("");
    }
    for (let i = 0; i < lightCount + 1; i += 1) {
      out.push(lightFragments[i] ?? "");
    }
    return out;
  }

  function paddedFragmentsHaveContent(fragments: readonly string[]): boolean {
    for (const f of fragments) {
      if (f.length > 0) {
        return true;
      }
    }
    return false;
  }

  const docEl = document.documentElement;
  const root = walk(docEl, "0");
  const viewportRect = {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  // Frameset documents (HTML 4 `<frameset>` instead of `<body>`) and
  // about:blank-style edge cases lack a `<body>`. Reading
  // `getComputedStyle(null)` would throw; fall back to the document
  // element so the in-page payload still resolves.
  const backgroundHost = document.body ?? document.documentElement;
  const background = window.getComputedStyle(backgroundHost).backgroundColor || "rgb(255, 255, 255)";
  return {
    source: window.location.href,
    viewport: viewportRect,
    devicePixelRatio: window.devicePixelRatio,
    background,
    root,
    imageRefs: Array.from(imageRegistry.entries()).map(([url, id]) => ({ id, url })),
  };
}
