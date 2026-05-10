/**
 * @file Single-element HTML snippet extractor.
 *
 * Drives Playwright to a target URL, picks a subtree by CSS selector,
 * and serialises that subtree into a *standalone* HTML document whose
 * rendered appearance matches what the live page paints — every
 * descendant's computed style is inlined as a `style="..."` attribute,
 * every `<img src>` / `background-image` / `mask-image` / `<svg>
 * <use>` reference and every `@font-face` URL is inlined as a `data:`
 * URL using bytes the page itself loaded (sourced from the Playwright
 * response cache, never re-fetched). The result is a self-contained
 * `*.html` file that renders independently of the source origin —
 * suitable as a deterministic fixture for the web-to-fig spec runner.
 *
 * The extractor is intentionally a different surface than `capture.ts`:
 *   - `capture.ts` produces a `RawViewportSnapshot` (DOM tree of
 *     `RawElement` records, IR-ready).
 *   - `extract.ts` produces an HTML *string* (a fixture suitable for
 *     `captureViewport({ url: "file://..." })` to round-trip through
 *     the same pipeline a live URL would).
 *
 * Both share the Playwright launch / response-cache plumbing in
 * `playwright-shared.ts`, so neither hand-rolls a duplicate browser
 * lifecycle.
 */
import { Buffer } from "node:buffer";
import {
  importPlaywright,
  isFontMime,
  isImageMime,
  startResponseCache,
  type BrowserContextLike,
  type BrowserLike,
  type PageLike,
  type ResponseCache,
} from "./playwright-shared";
import { waitForReady } from "./wait-for-ready";

/**
 * Common knobs for both extraction sources (`url` and `cdp`).
 * Split out so the union below stays tidy.
 */
type CommonExtractOptions = {
  /**
   * CSS selector identifying the subtree to extract. Must match
   * exactly one element — multiple matches would silently pick the
   * first one and that's the kind of sloppy behaviour this codebase
   * fails fast on. Use `:nth-of-type` etc. to disambiguate.
   */
  readonly selector: string;
  /**
   * Optional title baked into the output `<title>`. Useful when the
   * fixture sits in a directory of related extractions and you want
   * the file to identify itself when opened in a browser.
   */
  readonly title?: string;
  /**
   * Wait for a selector to appear before evaluating the extractor.
   * SPAs (YouTube, modern Twitter, app shells) only mount their main
   * surface a few seconds after `domcontentloaded` / `load` /
   * `waitForReady` fire. Defaults to the extraction selector itself,
   * so the most common "the thing I'm extracting also gates on its
   * own arrival" case is satisfied without an extra flag. Pass an
   * explicit selector here to wait on something else (e.g. wait for
   * `ytd-app` to mount, then extract `#header` once it lands).
   */
  readonly waitForSelector?: string;
  /** Cap on `waitForSelector` polling. */
  readonly waitForSelectorTimeoutMs?: number;
};

/** Extract by launching a fresh Chromium and navigating to a URL. */
export type UrlExtractOptions = CommonExtractOptions & {
  readonly source?: "url";
  readonly url: string;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly devicePixelRatio?: number;
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle";
  readonly timeoutMs?: number;
};

/**
 * Extract by connecting to an existing Chromium / Electron instance
 * over the Chrome DevTools Protocol. The target must be running with
 * `--remote-debugging-port=<port>`; this is how Electron apps (Slack,
 * VSCode, Discord, …) and standalone Chrome expose their inspector
 * surface to external tooling.
 *
 * The extractor reads the *current* DOM of the matching page — it
 * does **not** navigate, reload, or otherwise mutate the live app.
 * That makes it suitable for capturing post-interaction state (a
 * dialog the user just opened, a list filtered by a control they
 * just toggled) which a URL-launch path can't reproduce.
 *
 * Resource-inlining caveat: Playwright's `page.on('response')` only
 * fires for navigations that happen *after* the listener attaches.
 * When connecting to a page that has already loaded its assets, the
 * response cache stays empty and the inlined HTML keeps absolute
 * URLs in `<img src>` / `background-image` / `@font-face` instead
 * of `data:` URLs. Open the resulting fixture in an environment that
 * still has reach to the original asset host (or trigger a
 * navigation in the app to repopulate the cache before extracting).
 */
export type CdpExtractOptions = CommonExtractOptions & {
  readonly source: "cdp";
  /**
   * CDP endpoint. Either:
   *   - HTTP form: `http://localhost:9222` (Playwright resolves
   *     the WebSocket URL automatically via `/json/version`)
   *   - WebSocket form: `ws://localhost:9222/devtools/browser/<id>`
   */
  readonly endpoint: string;
  /**
   * Filter for picking which existing page to extract from. Defaults
   * to "the first page in the first context". Pass a substring
   * matched against `page.url()` to disambiguate.
   */
  readonly pageMatch?: string | ((url: string) => boolean);
  /** Optional override for the source URL stamped onto the fixture's `<body data-source-url>`. Defaults to the matched page's URL. */
  readonly sourceLabel?: string;
};

export type ExtractOptions = UrlExtractOptions | CdpExtractOptions;

export type ExtractResult = {
  /** Self-contained HTML document. UTF-8 encoded when written to disk. */
  readonly html: string;
  /** Source URL the snippet was extracted from. */
  readonly source: string;
  /** Selector that matched the extracted subtree. */
  readonly selector: string;
  /** Captured background-color of the host page's `<body>`. */
  readonly background: string;
  /** Number of resources inlined as data URLs. */
  readonly inlinedResources: number;
  /** Number of `@font-face` rules inlined. */
  readonly inlinedFontFaces: number;
};

/**
 * Extract a single element subtree as a standalone HTML document.
 *
 * Throws when:
 *   - Playwright is not installed (caller's responsibility to install).
 *   - The selector matches zero or more than one element.
 *   - The selector matches an element with zero rendered size.
 *   - (CDP mode) the endpoint refuses connection or has no matching page.
 */
export async function extractElement(options: ExtractOptions): Promise<ExtractResult> {
  if (isCdpOptions(options)) {
    return extractViaCdp(options);
  }
  return extractViaLaunch(options);
}

function isCdpOptions(options: ExtractOptions): options is CdpExtractOptions {
  return options.source === "cdp";
}

async function extractViaLaunch(options: UrlExtractOptions): Promise<ExtractResult> {
  const playwright = await importPlaywright();
  const browser = await playwright.chromium.launch();
  try {
    return await extractViaLaunchInBrowser(browser, options);
  } finally {
    await browser.close();
  }
}

async function extractViaLaunchInBrowser(
  browser: BrowserLike,
  options: UrlExtractOptions,
): Promise<ExtractResult> {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 800 },
    deviceScaleFactor: options.devicePixelRatio ?? 1,
  });
  try {
    const page = await context.newPage();
    // Listen for both image and font responses so the host can inline
    // either kind of asset by URL after navigation. Web fonts route
    // through the same `page.on('response')` path as images — the
    // cache is just keyed by mime filter.
    const cache = startResponseCache(page, (mime) => isImageMime(mime) || isFontMime(mime));
    await page.goto(options.url, {
      waitUntil: options.waitUntil ?? "domcontentloaded",
      timeout: options.timeoutMs,
    });
    // SPA mount barrier — `waitForReady` asserts on rendered images
    // / injected icons, but a freshly-mounted SPA may not have
    // inserted the requested selector into the DOM yet. Wait until
    // the selector appears before invoking the in-page harvester so
    // we don't trip the "selector matched no elements" guard while
    // the app shell is still hydrating.
    const waitSelector = options.waitForSelector ?? options.selector;
    await waitForSelectorPresence(page, waitSelector, options.waitForSelectorTimeoutMs ?? options.timeoutMs ?? 30000);
    await waitForReady(page, { timeoutMs: options.timeoutMs });
    await cache.settle();

    const harvested = await harvestFromPage(page, options.selector);
    const inlined = inlineResources(harvested, cache);
    const html = assembleDocument(inlined, options.title, options.selector);
    return {
      html,
      source: options.url,
      selector: options.selector,
      background: harvested.background,
      inlinedResources: inlined.inlinedResources,
      inlinedFontFaces: inlined.inlinedFontFaces,
    };
  } finally {
    await context.close();
  }
}

async function extractViaCdp(options: CdpExtractOptions): Promise<ExtractResult> {
  const playwright = await importPlaywright();
  const browser = await playwright.chromium.connectOverCDP(options.endpoint);
  try {
    const { page } = pickExistingPage(browser, options.pageMatch);
    // Attach the response cache before any further interaction. We
    // can only catch responses for navigations that happen *after*
    // this point — assets the page already loaded are unreachable
    // through `page.on('response')`. The harvester proceeds
    // regardless; URLs without bytes stay as absolute URLs in the
    // emitted HTML rather than `data:` URLs.
    const cache = startResponseCache(page, (mime) => isImageMime(mime) || isFontMime(mime));
    const waitSelector = options.waitForSelector ?? options.selector;
    if (waitSelector) {
      // Best-effort — the page is already mounted in the typical
      // CDP-connect case, but waiting for the selector lets us
      // also handle the situation where the inspector connection
      // races a re-render the user just triggered.
      await waitForSelectorPresence(page, waitSelector, options.waitForSelectorTimeoutMs ?? 5000);
    }
    await cache.settle();

    const harvested = await harvestFromPage(page, options.selector);
    const inlined = inlineResources(harvested, cache);
    const html = assembleDocument(inlined, options.title, options.selector);
    return {
      html,
      source: options.sourceLabel ?? page.url(),
      selector: options.selector,
      background: harvested.background,
      inlinedResources: inlined.inlinedResources,
      inlinedFontFaces: inlined.inlinedFontFaces,
    };
  } finally {
    // CDP connections must `close()` to release the WebSocket; this
    // does NOT close the underlying browser/Electron app — only the
    // Playwright client connection.
    await browser.close();
  }
}

/**
 * Pick a page out of an existing CDP-connected browser. Default
 * behaviour: first page of the first context. With `pageMatch`,
 * iterate every (context, page) pair and return the first whose URL
 * matches the predicate.
 */
function pickExistingPage(
  browser: BrowserLike,
  pageMatch: CdpExtractOptions["pageMatch"],
): { context: BrowserContextLike; page: PageLike } {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("extractViaCdp: connected browser has no existing contexts");
  }
  const matcher = buildPageMatcher(pageMatch);
  for (const context of contexts) {
    for (const page of context.pages()) {
      if (matcher(page.url())) {
        return { context, page };
      }
    }
  }
  if (pageMatch === undefined) {
    throw new Error("extractViaCdp: connected browser has no pages");
  }
  throw new Error(`extractViaCdp: no page matched ${describePageMatch(pageMatch)}`);
}

function buildPageMatcher(pageMatch: CdpExtractOptions["pageMatch"]): (url: string) => boolean {
  if (pageMatch === undefined) {
    return () => true;
  }
  if (typeof pageMatch === "function") {
    return pageMatch;
  }
  return (url) => url.includes(pageMatch);
}

function describePageMatch(pageMatch: CdpExtractOptions["pageMatch"]): string {
  if (typeof pageMatch === "string") {
    return `pageMatch substring "${pageMatch}"`;
  }
  return "the supplied pageMatch predicate";
}

/**
 * Browser-side payload returned by `harvestFromPage`. Strings are
 * already serialised — the host only walks them to do data-URL
 * substitution. Keeping the shape JSON-friendly avoids marshalling
 * binary across `page.evaluate`.
 */
type HarvestedSnippet = {
  readonly snippetHtml: string;
  readonly hostUrl: string;
  readonly background: string;
  /** Image / mask / svg-use URLs the snippet references, in document order. */
  readonly imageUrls: readonly string[];
  /** Inlined `@font-face` rules with the URL still pointing to the original (host-side will swap). */
  readonly fontFaces: readonly { readonly cssText: string; readonly urls: readonly string[] }[];
  /** Bounding box of the matched element, for the spec runner to reason about. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
};

/**
 * Poll `document.querySelector(selector)` inside the page until it
 * returns a non-null element with non-zero rendered size, capped at
 * `timeoutMs`. The `waitForFunction` host-side runs the predicate on
 * every animation frame, so the cost on already-mounted DOM is a
 * single tick.
 *
 * Falls through silently on timeout — the harvester then throws its
 * own "selector matched no elements" error, which carries the
 * selector text and is more actionable than a Playwright timeout.
 */
async function waitForSelectorPresence(
  page: PageLike,
  selector: string,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    (sel: string) => {
      const el = document.querySelector(sel);
      if (el === null) {
        return false;
      }
      const r = el.getBoundingClientRect();
      // Some SPAs insert the host element first and only fill it on a
      // later tick; require non-zero geometry so the harvester reads
      // a fully-laid-out subtree.
      return r.width > 0 && r.height > 0;
    },
    selector,
    { timeout: timeoutMs },
  ).catch((_err: unknown) => {
    // Suppressed — see function doc comment. The harvester will
    // throw with a more actionable error message if the selector is
    // genuinely missing at evaluation time.
    void _err;
  });
}

async function harvestFromPage(page: PageLike, selector: string): Promise<HarvestedSnippet> {
  return page.evaluate((sel: string) => {
    // ---- Inline-everything serializer ----
    // The complete set of CSS properties the browser knows about.
    // We snapshot every one of them so the standalone snippet is
    // independent of the source origin's stylesheets — there is no
    // "implicit cascade" left to resolve.
    function dumpComputedStyle(el: Element): string {
      const cs = window.getComputedStyle(el);
      const parts: string[] = [];
      for (let i = 0; i < cs.length; i += 1) {
        const prop = cs.item(i);
        const val = cs.getPropertyValue(prop);
        if (val === "") {
          continue;
        }
        // CSS variables are dumped verbatim — they survive into the
        // standalone snippet so anything that resolves them via the
        // computed cascade still works.
        parts.push(`${prop}:${val}`);
      }
      return parts.join(";");
    }

    function escapeAttr(value: string): string {
      return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
    }

    function escapeText(value: string): string {
      return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    // The match must be unique — picking the "first" silently is the
    // kind of sloppy default this codebase fails fast on.
    const matches = document.querySelectorAll(sel);
    if (matches.length === 0) {
      throw new Error(`extractElement: selector "${sel}" matched no elements`);
    }
    if (matches.length > 1) {
      throw new Error(
        `extractElement: selector "${sel}" matched ${matches.length} elements; use a more specific selector`,
      );
    }
    const root = matches[0]!;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width === 0 || rootRect.height === 0) {
      // Inline elements wrapping a multi-line run still report 0×0;
      // honour `getClientRects()` like the IR walker does. If even
      // that's empty the element genuinely paints nothing — refuse.
      const rects = Array.from(root.getClientRects());
      const anyRect = rects.find((r) => r.width !== 0 && r.height !== 0);
      if (anyRect === undefined) {
        throw new Error(
          `extractElement: selector "${sel}" matched an element with no rendered size`,
        );
      }
    }

    const imageUrlsSet = new Set<string>();

    /**
     * Capture every `url(...)` token inside a CSS value string. CSS
     * spec quirks handled:
     *   - quoted (single / double) and unquoted forms
     *   - data: URLs that happen to contain `)` inside the body
     *
     * Returns the URLs in document order.
     */
    function extractUrlTokens(value: string): string[] {
      const out: string[] = [];
      const length = value.length;
      // eslint-disable-next-line no-restricted-syntax -- character cursor is intrinsically mutable
      let i = 0;
      while (i < length) {
        const start = value.indexOf("url(", i);
        if (start < 0) {
          break;
        }
        // eslint-disable-next-line no-restricted-syntax -- cursor advances past the literal
        let cur = start + 4;
        while (cur < length && (value[cur] === " " || value[cur] === "\t")) {
          cur += 1;
        }
        if (cur >= length) {
          break;
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
          const close = value.indexOf(")", cur);
          i = close < 0 ? length : close + 1;
          continue;
        }
        const close = value.indexOf(")", cur);
        if (close < 0) {
          break;
        }
        const body = value.slice(cur, close).trim();
        if (body.length > 0) {
          out.push(body);
        }
        i = close + 1;
      }
      return out;
    }

    function recordImageUrls(value: string): void {
      for (const u of extractUrlTokens(value)) {
        if (u.startsWith("data:") || u.startsWith("blob:")) {
          continue;
        }
        // Resolve relative to the document so the host-side cache
        // lookup keys match the absolute URL Playwright observed.
        try {
          imageUrlsSet.add(new URL(u, document.baseURI).href);
        } catch (_err: unknown) {
          // Malformed URLs are dropped; the placeholder stays in the
          // CSS and the standalone snippet simply won't paint that
          // particular layer (matches what the browser does for the
          // same broken value). The error is intentionally
          // unobservable — the URL is the only failing input and
          // surfacing it would force every malformed url() in a
          // captured page to abort the whole extraction.
          void _err;
        }
      }
    }

    /**
     * Serialise an element subtree to HTML with computed styles
     * inlined. Form-control state (`<input value>`) is captured via
     * the live `value` property because the DOM tree carries no text
     * node for it.
     */
    function serialise(el: Element): string {
      const tag = el.tagName.toLowerCase();
      // <script> / <noscript> / <link> never paint visually — drop
      // them to keep the snippet free of behavioural side effects.
      if (tag === "script" || tag === "noscript" || tag === "link" || tag === "meta") {
        return "";
      }
      const style = dumpComputedStyle(el);
      // Track every URL we'll need to inline host-side.
      const cs = window.getComputedStyle(el);
      const bgImage = cs.getPropertyValue("background-image");
      if (bgImage && bgImage !== "none") {
        recordImageUrls(bgImage);
      }
      const maskImage = cs.getPropertyValue("mask-image") || cs.getPropertyValue("-webkit-mask-image");
      if (maskImage && maskImage !== "none") {
        recordImageUrls(maskImage);
      }

      // Surface attributes that affect layout / accessibility / form
      // state. We deliberately don't keep `class` or `id` (the
      // standalone snippet shouldn't depend on stylesheet hooks the
      // host page no longer provides).
      const attrs: string[] = [];
      attrs.push(`style="${escapeAttr(style)}"`);
      const role = el.getAttribute("role");
      if (role) {
        attrs.push(`role="${escapeAttr(role)}"`);
      }
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) {
        attrs.push(`aria-label="${escapeAttr(ariaLabel)}"`);
      }

      if (tag === "img") {
        const img = el as HTMLImageElement;
        const src = img.currentSrc || img.src;
        if (src) {
          try {
            const abs = new URL(src, document.baseURI).href;
            imageUrlsSet.add(abs);
            attrs.push(`src="${escapeAttr(abs)}"`);
          } catch (_err: unknown) {
            // Drop the bad src; the standalone snippet paints alt
            // text only. Surfacing the error would force every
            // page with a single broken `<img>` to abort.
            void _err;
          }
        }
        const alt = img.getAttribute("alt");
        if (alt !== null) {
          attrs.push(`alt="${escapeAttr(alt)}"`);
        }
        const width = img.getAttribute("width");
        if (width) {
          attrs.push(`width="${escapeAttr(width)}"`);
        }
        const height = img.getAttribute("height");
        if (height) {
          attrs.push(`height="${escapeAttr(height)}"`);
        }
        return `<img ${attrs.join(" ")}>`;
      }

      if (tag === "input") {
        const input = el as HTMLInputElement;
        const type = input.getAttribute("type");
        if (type) {
          attrs.push(`type="${escapeAttr(type)}"`);
        }
        const value = input.value;
        if (value) {
          attrs.push(`value="${escapeAttr(value)}"`);
        }
        const placeholder = input.getAttribute("placeholder");
        if (placeholder) {
          attrs.push(`placeholder="${escapeAttr(placeholder)}"`);
        }
        return `<input ${attrs.join(" ")}>`;
      }

      // SVG: emit verbatim so vector geometry survives intact. CSS
      // styling is still captured via the inline `style` we already
      // computed; nested `<use href="#id">` references are resolved
      // by stamping out the referent's outerHTML in place (icon
      // sprites otherwise dangle when the host's `<symbol>` defs
      // stay behind).
      if (tag === "svg") {
        // Resolve <use href="#id"> by inlining the referenced node.
        const cloned = el.cloneNode(true) as Element;
        const uses = Array.from(cloned.querySelectorAll("use"));
        for (const useEl of uses) {
          const href = useEl.getAttribute("href") ?? useEl.getAttribute("xlink:href");
          if (!href || !href.startsWith("#")) {
            continue;
          }
          const target = document.getElementById(href.slice(1));
          if (target) {
            const replacement = target.cloneNode(true) as Element;
            // Strip the id so the inlined copy doesn't collide with the
            // original (some sprites are `<symbol id>`s — the rendered
            // form needs to be a plain `<g>`/`<path>`).
            replacement.removeAttribute("id");
            try {
              useEl.replaceWith(replacement);
            } catch (_err: unknown) {
              // Some browsers throw when `replaceWith` is called on a
              // node already detached from the cloned tree; the use
              // element is left in place and the snippet renders as
              // the live page does for the same condition.
              void _err;
            }
          }
        }
        // Inline every nested element's computed style too — SVG
        // children inherit from the host's CSS otherwise.
        const liveDescendants = el.querySelectorAll("*");
        const clonedDescendants = cloned.querySelectorAll("*");
        // The two NodeLists are walked in the same DOM order because
        // `cloneNode(true)` preserves it.
        for (let i = 0; i < liveDescendants.length && i < clonedDescendants.length; i += 1) {
          const live = liveDescendants[i]!;
          const clone = clonedDescendants[i]!;
          const dStyle = dumpComputedStyle(live);
          if (dStyle.length > 0) {
            const existing = clone.getAttribute("style") ?? "";
            clone.setAttribute("style", existing.length > 0 ? `${existing};${dStyle}` : dStyle);
          }
        }
        // The host element's own style is already in the clone via the
        // root attrs path; outerHTML serialises everything in one go.
        const rootStyle = dumpComputedStyle(el);
        if (rootStyle.length > 0) {
          const existing = cloned.getAttribute("style") ?? "";
          cloned.setAttribute("style", existing.length > 0 ? `${existing};${rootStyle}` : rootStyle);
        }
        return cloned.outerHTML;
      }

      // Generic element: open tag + children + close tag.
      const childChunks: string[] = [];
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          childChunks.push(escapeText(node.textContent ?? ""));
          continue;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          childChunks.push(serialise(node as Element));
          continue;
        }
        // Comments and other node types are dropped — they don't paint.
      }
      // Void elements per HTML spec; emitting "<br></br>" is malformed.
      const voidTags = new Set([
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
      ]);
      if (voidTags.has(tag)) {
        return `<${tag} ${attrs.join(" ")}>`;
      }
      return `<${tag} ${attrs.join(" ")}>${childChunks.join("")}</${tag}>`;
    }

    // ---- @font-face harvesting ----
    // CSSOM exposes every loaded `@font-face` via `document.styleSheets`.
    // We collect their cssText and the URL tokens so the host can
    // re-emit them with `data:` URLs once the bytes arrive.
    function readSheetRules(sheet: CSSStyleSheet): CSSRuleList | null {
      // Cross-origin stylesheets refuse `cssRules` access — the
      // computed style on the matched subtree still resolves
      // correctly because the browser already applied them, but we
      // can't re-emit those @font-face rules into the standalone
      // snippet. Fallback rendering uses whatever local fonts the
      // spec runner has.
      try {
        return sheet.cssRules;
      } catch (_err: unknown) {
        void _err;
        return null;
      }
    }
    function tryAbsoluteUrl(raw: string): string | undefined {
      try {
        return new URL(raw, document.baseURI).href;
      } catch (_err: unknown) {
        // Skip malformed url(...) — the @font-face rule still emits
        // with its other src() entries, falling back as the browser
        // would for the same input.
        void _err;
        return undefined;
      }
    }
    const fontFaces: { cssText: string; urls: string[] }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      const rules = readSheetRules(sheet);
      if (rules === null) {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (rule.constructor.name === "CSSFontFaceRule" || rule.cssText.startsWith("@font-face")) {
          const urls: string[] = [];
          for (const u of extractUrlTokens(rule.cssText)) {
            if (u.startsWith("data:") || u.startsWith("blob:")) {
              continue;
            }
            const abs = tryAbsoluteUrl(u);
            if (abs !== undefined) {
              urls.push(abs);
            }
          }
          fontFaces.push({ cssText: rule.cssText, urls });
        }
      }
    }

    const snippetHtml = serialise(root);
    const bodyBg = window.getComputedStyle(document.body).backgroundColor || "rgb(255,255,255)";
    return {
      snippetHtml,
      hostUrl: window.location.href,
      background: bodyBg,
      imageUrls: Array.from(imageUrlsSet),
      fontFaces: fontFaces.map((f) => ({ cssText: f.cssText, urls: f.urls })),
      rect: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height },
    };
  }, selector);
}

/** Bytes + MIME for a single inlined resource. Mirrors `RawAsset`'s shape but is decoupled because the renderer's MIME enum is narrower than the set the extractor accepts. */
type InlinedAsset = {
  readonly mime: string;
  readonly bytes: Uint8Array;
};

type InlinedSnippet = {
  readonly snippetHtml: string;
  readonly hostUrl: string;
  readonly background: string;
  readonly fontFaceCss: string;
  readonly inlinedResources: number;
  readonly inlinedFontFaces: number;
};

/**
 * Walk the harvested snippet, swap every absolute resource URL for
 * the corresponding `data:` URL using bytes the page itself loaded.
 * URLs whose bytes are missing from the cache (cross-origin without
 * CORS, redirected before the listener attached, or skipped because
 * the response landed before navigation completed) are left as the
 * absolute URL — the standalone snippet then falls back to the live
 * fetch when opened in a browser, which still renders correctly so
 * long as the host origin remains reachable.
 */
function inlineResources(harvested: HarvestedSnippet, cache: ResponseCache): InlinedSnippet {
  // Build URL → asset map from the response cache. The cache yields
  // every (url, bytes, mime) triple regardless of whether it was
  // referenced — we filter to URLs the snippet actually mentions to
  // keep the standalone HTML small.
  const wanted = new Set<string>(harvested.imageUrls);
  for (const f of harvested.fontFaces) {
    for (const u of f.urls) {
      wanted.add(u);
    }
  }
  const assetsByUrl = new Map<string, InlinedAsset>();
  for (const entry of cache.entries()) {
    if (!wanted.has(entry.url)) {
      continue;
    }
    assetsByUrl.set(entry.url, { mime: entry.mime, bytes: entry.bytes });
  }

  function dataUrlFor(url: string): string | undefined {
    const asset = assetsByUrl.get(url);
    if (asset === undefined) {
      return undefined;
    }
    const mime = asset.mime || "application/octet-stream";
    const base64 = Buffer.from(asset.bytes.buffer, asset.bytes.byteOffset, asset.bytes.byteLength).toString("base64");
    return `data:${mime};base64,${base64}`;
  }

  // Replace every absolute URL we have bytes for. Substring replace
  // is acceptable here because the absolute URLs already include the
  // origin — they don't collide with HTML keywords or other CSS
  // tokens.
  const replaced = Array.from(assetsByUrl.keys()).reduce<{ html: string; count: number }>(
    (acc, url) => {
      const dataUrl = dataUrlFor(url);
      if (dataUrl === undefined) {
        return acc;
      }
      if (!acc.html.includes(url)) {
        return acc;
      }
      return { html: splitJoin(acc.html, url, dataUrl), count: acc.count + 1 };
    },
    { html: harvested.snippetHtml, count: 0 },
  );

  // Re-emit @font-face rules with data URLs. We rewrite each rule's
  // captured URLs and join the result into a single CSS string for
  // the document `<head>`.
  const rewrittenFontFaces = harvested.fontFaces.map((ff) => rewriteFontFaceRule(ff, dataUrlFor));
  const inlinedFontFaces = rewrittenFontFaces.reduce<number>((n, r) => n + (r.anyInlined ? 1 : 0), 0);

  return {
    snippetHtml: replaced.html,
    hostUrl: harvested.hostUrl,
    background: harvested.background,
    fontFaceCss: rewrittenFontFaces.map((r) => r.cssText).join("\n"),
    inlinedResources: replaced.count,
    inlinedFontFaces,
  };
}

function rewriteFontFaceRule(
  ff: { readonly cssText: string; readonly urls: readonly string[] },
  dataUrlFor: (url: string) => string | undefined,
): { cssText: string; anyInlined: boolean } {
  return ff.urls.reduce<{ cssText: string; anyInlined: boolean }>(
    (acc, url) => {
      const dataUrl = dataUrlFor(url);
      if (dataUrl === undefined) {
        return acc;
      }
      return { cssText: splitJoin(acc.cssText, url, dataUrl), anyInlined: true };
    },
    { cssText: ff.cssText, anyInlined: false },
  );
}

/** `String#replaceAll` without regex semantics — safe for URLs that contain `$` etc. */
function splitJoin(haystack: string, needle: string, replacement: string): string {
  return haystack.split(needle).join(replacement);
}

function assembleDocument(inlined: InlinedSnippet, title: string | undefined, selector: string): string {
  const finalTitle = title ?? `Extracted from ${inlined.hostUrl}`;
  const escapedTitle = finalTitle
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // The spec runner reads `data-source-url` / `data-selector` /
  // `data-background` to reconstruct provenance metadata without
  // re-parsing the HTML.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapedTitle}</title>
<style>
html, body { margin: 0; padding: 0; }
body { background: ${inlined.background}; }
${inlined.fontFaceCss}
</style>
</head>
<body data-source-url="${inlined.hostUrl}" data-selector="${selector.replace(/"/g, "&quot;")}" data-background="${inlined.background.replace(/"/g, "&quot;")}">
${inlined.snippetHtml}
</body>
</html>
`;
}
