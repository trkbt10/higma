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

export type ElementJson = {
  readonly id: string;
  readonly tag: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly contentRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly visible: boolean;
  readonly computedStyle: Readonly<Record<string, string>>;
  readonly imageId?: string;
  readonly text?: string;
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
    if (r.width === 0 && r.height === 0) {
      return false;
    }
    return true;
  }

  function extractImageUrl(el: Element, style: Record<string, string>): string | undefined {
    if (el.tagName === "IMG") {
      const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
      if (src) {
        return src;
      }
    }
    const bg = style["background-image"];
    if (bg && bg !== "none") {
      const match = bg.match(/url\((['"]?)([^'")]+)\1\)/);
      if (match) {
        return match[2];
      }
    }
    return undefined;
  }

  function directText(el: Element): string {
    return Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
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

  function walk(el: Element, path: string): ElementJson {
    const style = pickComputedStyle(el);
    const visible = isVisible(el, style);
    const rect = rectFrom(el.getBoundingClientRect());
    const contentRect = contentRectFor(el, style);
    const imageUrl = extractImageUrl(el, style);
    const imageId = imageUrl ? registerImage(imageUrl) : undefined;
    const text = directText(el);
    const children: ElementJson[] = Array.from(el.children).map(
      (child, index) => walk(child, `${path}/${index}`),
    );
    return {
      id: path,
      tag: el.tagName.toLowerCase(),
      rect,
      contentRect,
      visible,
      computedStyle: style,
      imageId,
      text: text.length > 0 ? text : undefined,
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
