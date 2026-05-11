/**
 * @file Shared Playwright plumbing for the web-source layer.
 *
 * `capture.ts` (live `RawViewportSnapshot` capture) and `extract.ts`
 * (single-element HTML snippet extraction) both need the same browser
 * lifecycle primitives:
 *
 *   - dynamic-imported `playwright.chromium.launch`
 *   - a `page.on('response')` cache that retains the bytes the browser
 *     itself loaded for image / font / mask URLs (so neither caller
 *     re-fetches resources Playwright already brokered)
 *   - a uniform structural typing surface (`PageLike`, `BrowserLike`)
 *     so consumers can be unit-tested without the real Playwright
 *     types
 *
 * Keeping this in one file is the SoT-respecting alternative to
 * duplicating the launch / cache plumbing inside both callers.
 */
import type { Buffer } from "node:buffer";

/** Subset of `playwright.Response` actually used here. */
export type ResponseLike = {
  url(): string;
  allHeaders(): Promise<Readonly<Record<string, string>>>;
  body(): Promise<Buffer>;
};

/**
 * Subset of `playwright.Frame` we touch from the frameset capture
 * path. Playwright's `Page` is also a `Frame` (the main frame) plus
 * top-level navigation / event APIs, so each `Page` has an
 * accompanying `mainFrame()`. Sub-frames (HTML4 `<frameset>` /
 * `<frame>` and `<iframe>`) only expose the `Frame` surface — they
 * cannot navigate independently or attach response listeners. We
 * still need `evaluate` inside a frame's document context to run
 * `captureSnapshot` against each frame's own DOM, and `url()` so we
 * can identify which frame we're looking at.
 */
export type FrameLike = {
  url(): string;
  /** True for the page's top-level frame. */
  parentFrame(): FrameLike | null;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  waitForLoadState(state: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
};

/** Subset of `playwright.Page` shared across capture + extract. */
export type PageLike = {
  /** Current URL the page is on. Available without a `goto` — used by the CDP-connect path to surface the existing tab's URL. */
  url(): string;
  goto(url: string, opts: { readonly waitUntil: string; readonly timeout: number | undefined }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  /**
   * Two overloads mirror Playwright's own `waitForFunction` shape:
   *   - zero-arg predicate (used by `wait-for-ready.ts` for the
   *     composite "everything painted" check)
   *   - one-arg predicate with a marshalled argument (used by
   *     `extract.ts` to wait on a specific selector)
   */
  waitForFunction<T>(fn: () => T, arg?: undefined, opts?: { readonly timeout: number }): Promise<unknown>;
  waitForFunction<T, A>(fn: (arg: A) => T, arg: A, opts?: { readonly timeout: number }): Promise<unknown>;
  waitForLoadState(state: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
  screenshot(opts: { readonly fullPage: boolean; readonly type: "png" }): Promise<Buffer>;
  on(event: "response", handler: (response: ResponseLike) => void | Promise<void>): void;
  /**
   * All frames currently attached to the page — main frame plus every
   * `<frame>` / `<iframe>` Playwright tracks. The frameset capture
   * path matches each `<frame>`'s captured `src` against
   * `frame.url()` to locate its evaluation context.
   */
  frames(): readonly FrameLike[];
  /** The page's top-level frame; alias for `frames()[0]` in practice. */
  mainFrame(): FrameLike;
};

/** Subset of `playwright.Browser`. */
export type PlaywrightLike = {
  readonly chromium: {
    launch(): Promise<BrowserLike>;
    /**
     * Connect to an existing Chromium / Electron instance over the
     * Chrome DevTools Protocol. The endpoint is the WebSocket URL
     * returned by `http://<host>:<port>/json/version`'s
     * `webSocketDebuggerUrl` field — Playwright resolves it
     * automatically when given the bare port form
     * `http://localhost:9222`.
     *
     * Used by the extractor to reach into a running Electron app
     * (started with `--remote-debugging-port=9222`) without
     * navigating it to a URL — the existing tab's DOM and rendered
     * surface become the extraction source.
     */
    connectOverCDP(endpointUrl: string): Promise<BrowserLike>;
  };
};

export type BrowserLike = {
  newContext(opts: {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly deviceScaleFactor: number;
  }): Promise<BrowserContextLike>;
  /**
   * Existing browser contexts. Populated by `connectOverCDP` (the
   * remote browser already has at least one context with one or
   * more pages); empty for `launch` until `newContext` is called.
   */
  contexts(): readonly BrowserContextLike[];
  close(): Promise<void>;
};

export type BrowserContextLike = {
  newPage(): Promise<PageLike>;
  /** Existing pages within this context. */
  pages(): readonly PageLike[];
  close(): Promise<void>;
};

/**
 * Dynamic import the `playwright` package and validate it exposes the
 * chromium launcher. Throws a precise error when Playwright is not
 * installed in the consumer's environment — never silently downgrades
 * to a stub. Static import is intentionally avoided so consumers that
 * only need the snapshot type or the normaliser don't pull in the
 * browser binaries.
 */
export async function importPlaywright(): Promise<PlaywrightLike> {
  // eslint-disable-next-line no-restricted-syntax -- playwright is an optional runtime dep; static import would force it on every consumer.
  const mod: unknown = await import("playwright");
  if (!isPlaywrightLike(mod)) {
    throw new Error("importPlaywright: 'playwright' module loaded but did not expose a chromium launcher");
  }
  return mod;
}

function isPlaywrightLike(mod: unknown): mod is PlaywrightLike {
  if (typeof mod !== "object" || mod === null) {
    return false;
  }
  const candidate = mod as { readonly chromium?: { readonly launch?: unknown } };
  return typeof candidate.chromium?.launch === "function";
}

/** Launch a Chromium browser via Playwright. Returns the browser handle. */
export async function launchBrowser(): Promise<BrowserLike> {
  const playwright = await importPlaywright();
  return playwright.chromium.launch();
}

/**
 * Cache of resource bytes the page itself loaded during navigation,
 * keyed by absolute URL. Building this via `page.on('response')` is
 * intentional: Playwright is already brokering every network exchange
 * the browser made, and asking for the bytes a second time (via Node
 * `fetch`, Playwright's `request` API, or in-page `fetch`) is a
 * parallel SoT for "what did this URL resolve to" and would introduce
 * drift on cookies, redirects, and cache variance.
 */
export type ResponseCache = {
  /** Wait for every still-pending body to settle, then return. */
  settle(): Promise<void>;
  bodyForUrl(url: string): Uint8Array | undefined;
  /** Iterate every (url, bytes, mime) triple captured so far. */
  entries(): Iterable<{ readonly url: string; readonly bytes: Uint8Array; readonly mime: string }>;
};

/**
 * Start the response cache for a `Page`. The `mimeFilter` controls
 * which content-types are retained (capture wants images only, extract
 * wants images + fonts + svg masks). The filter receives the lower-
 * cased MIME with parameters stripped (`"image/png"`, not
 * `"image/png; charset=utf-8"`).
 *
 * The cache must be attached *before* navigation — a listener attached
 * after `page.goto` returns will miss responses that already landed.
 */
export function startResponseCache(
  page: PageLike,
  mimeFilter: (mime: string) => boolean,
): ResponseCache {
  const bodies = new Map<string, { bytes: Uint8Array; mime: string }>();
  const inflight: Promise<void>[] = [];
  page.on("response", (response) => {
    inflight.push(captureResponseBody(response, mimeFilter, bodies));
  });
  return {
    bodyForUrl: (url) => bodies.get(url)?.bytes,
    *entries() {
      for (const [url, entry] of bodies) {
        yield { url, bytes: entry.bytes, mime: entry.mime };
      }
    },
    async settle() {
      while (inflight.length > 0) {
        const batch = inflight.splice(0, inflight.length);
        await Promise.all(batch);
      }
    },
  };
}

async function captureResponseBody(
  response: ResponseLike,
  mimeFilter: (mime: string) => boolean,
  bodies: Map<string, { bytes: Uint8Array; mime: string }>,
): Promise<void> {
  const headers = await safeAllHeaders(response);
  if (headers === undefined) {
    return;
  }
  const mime = (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mimeFilter(mime)) {
    return;
  }
  const body = await safeResponseBody(response);
  if (body === undefined) {
    return;
  }
  bodies.set(response.url(), {
    bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    mime,
  });
}

async function safeAllHeaders(response: ResponseLike): Promise<Record<string, string> | undefined> {
  // `response.allHeaders()` may throw when the page / context has
  // already been closed (e.g. an in-flight response listener fires
  // after the Playwright caller resolved its result and tore down the
  // browser). The cache simply omits these entries — the dropped
  // bytes are responses that arrived too late to be useful anyway.
  try {
    return await response.allHeaders();
  } catch (_err: unknown) {
    void _err;
    return undefined;
  }
}

async function safeResponseBody(response: ResponseLike): Promise<Buffer | undefined> {
  // `response.body()` may throw on a navigation-cancelled or
  // redirected response; we let that propagate as `undefined` so the
  // cache simply omits the entry. Callers must already handle a
  // missing entry (the relevant URL may also resolve via a different
  // path — e.g. an in-page canvas read for capture, or a fallback to
  // the live URL for extract).
  try {
    return await response.body();
  } catch (_err: unknown) {
    void _err;
    return undefined;
  }
}

/** True when `mime` is one of the bridge-supported image content-types. */
export function isImageMime(mime: string): boolean {
  return mime === "image/png"
    || mime === "image/jpeg"
    || mime === "image/jpg"
    || mime === "image/gif"
    || mime === "image/webp"
    || mime === "image/svg+xml"
    || mime === "image/avif";
}

/** True when `mime` is one of the standard webfont content-types. */
export function isFontMime(mime: string): boolean {
  return mime === "font/woff2"
    || mime === "font/woff"
    || mime === "font/ttf"
    || mime === "font/otf"
    || mime === "application/font-woff2"
    || mime === "application/font-woff"
    || mime === "application/x-font-woff2"
    || mime === "application/x-font-woff"
    || mime === "application/x-font-ttf"
    || mime === "application/x-font-otf"
    || mime === "application/octet-stream";
}
