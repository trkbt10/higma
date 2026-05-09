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
 * SVG path captured from the in-page walker. Mirrors `RawSvgPath` in
 * `snapshot.ts` exactly so the JSON payload can be re-hydrated
 * without coercion.
 */
export type SvgPathJson = {
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly fillRule?: "nonzero" | "evenodd";
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
  readonly svgContent?: SvgContentJson;
  readonly text?: string;
  /**
   * Per-position direct-text fragments. See `RawElement.textFragments`
   * in `snapshot.ts` for semantics — this is the JSON-friendly mirror
   * of that field. Length equals `children.length + 1` when present.
   */
  readonly textFragments?: readonly string[];
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
    "mask-image",
    "-webkit-mask-image",
    "mask-size",
    "mask-position",
    "mask-repeat",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-color",
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
  ];
  const imageRegistry = new Map<string, string>();
  // The counter intentionally lives behind a getter object: it's the
  // only mutable state in the in-page walker, and exposing it through
  // a wrapper keeps the rest of the function `let`-free.
  const imageCounter = { value: 0 };

  function nextImageId(): string {
    imageCounter.value += 1;
    return `img-${imageCounter.value}`;
  }

  function registerImage(url: string): string {
    const existing = imageRegistry.get(url);
    if (existing !== undefined) {
      return existing;
    }
    const id = nextImageId();
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
    return false;
  }

  function extractImageUrl(el: Element, style: Record<string, string>): string | undefined {
    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      // `<img src="">` resolves `currentSrc`/`src` to the document's
      // own URL (the spec says an empty `src` resolves against the
      // base URL). Treat that case — and the explicitly-empty
      // `getAttribute("src")` — as "no image", so we don't register
      // the host page itself as an asset to fetch.
      const rawSrc = img.getAttribute("src");
      if (!rawSrc || rawSrc.length === 0) {
        return undefined;
      }
      const src = img.currentSrc || img.src;
      if (src && src !== window.location.href) {
        return src;
      }
    }
    // Inline `<svg>` is captured separately via `extractSvgContent` —
    // emit treats it as a vector node, not an image fill.
    const bg = style["background-image"];
    if (bg && bg !== "none") {
      const match = bg.match(/url\((['"]?)([^'")]+)\1\)/);
      if (match) {
        return match[2];
      }
    }
    // CSS `mask-image` is the third major path icon frameworks use
    // (Polymer's `<yt-icon>`, Material symbols, …). The visible
    // glyph is sourced from a URL the browser pulls in just like a
    // background image — surface it the same way.
    const mask = style["mask-image"] ?? style["-webkit-mask-image"];
    if (mask && mask !== "none") {
      const match = mask.match(/url\((['"]?)([^'")]+)\1\)/);
      if (match) {
        return match[2];
      }
    }
    return undefined;
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
    // Resolve `<use>` references where possible by following the
    // `href`/`xlink:href` attribute. The shadow DOM ones (custom
    // elements) won't resolve via querySelector because the target
    // sits in another document — those are dropped silently.
    function collectPaths(root: Element): void {
      const queue: Element[] = [root];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.tagName === "path" || current.tagName === "PATH") {
          const d = current.getAttribute("d");
          if (d && d.length > 0) {
            const computed = window.getComputedStyle(current);
            const fillAttr = current.getAttribute("fill") ?? computed.fill;
            const strokeAttr = current.getAttribute("stroke") ?? computed.stroke;
            const strokeWidthAttr = current.getAttribute("stroke-width") ?? computed.strokeWidth;
            const fillRuleAttr = current.getAttribute("fill-rule") ?? computed.fillRule;
            const path: SvgPathJson = {
              d,
              fill: fillAttr && fillAttr !== "none" ? fillAttr : undefined,
              stroke: strokeAttr && strokeAttr !== "none" ? strokeAttr : undefined,
              strokeWidth: strokeWidthAttr ? parseFloat(strokeWidthAttr) : undefined,
              fillRule: fillRuleAttr === "evenodd" ? "evenodd" : undefined,
            };
            paths.push(path);
          }
        } else if (current.tagName === "use" || current.tagName === "USE") {
          const useEl = current as SVGUseElement;
          const href = useEl.getAttribute("href") ?? useEl.getAttribute("xlink:href");
          if (href && href.startsWith("#")) {
            const target = svgEl.ownerDocument?.getElementById(href.slice(1));
            if (target) {
              queue.push(target);
              continue;
            }
          }
        }
        for (const child of Array.from(current.children)) {
          queue.push(child);
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
    return rectFrom(r);
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
    return undefined;
  }

  function walk(el: Element, path: string): ElementJson {
    const style = pickComputedStyle(el);
    const visible = isVisible(el, style);
    const rect = effectiveRectFor(el);
    const contentRect = contentRectFor(el, style);
    const svgContent = extractSvgContent(el);
    const imageUrl = svgContent === undefined ? extractImageUrl(el, style) : undefined;
    const imageId = imageUrl ? registerImage(imageUrl) : undefined;
    const directTextValue = directText(el);
    // Form controls have no child text node carrying the painted
    // string, so we lift `value` / `placeholder` up into the
    // element's `text` field. The normaliser then treats the
    // control as a self-contained paragraph host.
    const formText = formControlText(el);
    const text = formText !== undefined && directTextValue.length === 0
      ? formText
      : directTextValue;
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
    const shadowChildren = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot
      ? Array.from((el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot!.children)
      : [];
    const allChildren = [...shadowChildren, ...lightChildren];
    const children: ElementJson[] = svgContent !== undefined
      ? []
      : allChildren.map((child, index) => walk(child, `${path}/${index}`));
    return {
      id: path,
      tag: el.tagName.toLowerCase(),
      rect,
      contentRect,
      visible,
      computedStyle: style,
      imageId,
      svgContent,
      text: text.length > 0 ? text : undefined,
      pseudo: pseudo.length > 0 ? pseudo : undefined,
      children,
    };
  }

  const docEl = document.documentElement;
  const root = walk(docEl, "0");
  const viewportRect = {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const background = window.getComputedStyle(document.body).backgroundColor || "rgb(255, 255, 255)";
  return {
    source: window.location.href,
    viewport: viewportRect,
    devicePixelRatio: window.devicePixelRatio,
    background,
    root,
    imageRefs: Array.from(imageRegistry.entries()).map(([url, id]) => ({ id, url })),
  };
}
