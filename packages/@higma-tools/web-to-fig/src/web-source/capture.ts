/**
 * @file Playwright-driven capture entry point.
 *
 * Loads the target URL in a headless Chromium, evaluates
 * `captureSnapshot` in the page context, then re-fetches every image
 * referenced by `imageRefs` so the resulting `RawViewportSnapshot`
 * carries the bytes inline. The host fetch — rather than reading them
 * out via `page.evaluate` — keeps the in-page payload free of binary
 * marshalling (which would force base64 round-tripping through V8).
 *
 * Playwright is loaded dynamically so consumers that only need the
 * snapshot type or the normaliser don't have to install the
 * browser binaries.
 */
import type { RawAsset, RawElement, RawViewportSnapshot } from "./snapshot";
import { captureSnapshot, type ElementJson, type RawSnapshotJson } from "./in-page";
import { waitForReady } from "./wait-for-ready";

export type CaptureOptions = {
  readonly url: string;
  /** CSS pixels. Defaults to a desktop viewport so layout matches typical Figma frames. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Device pixel ratio applied to the browser context. Defaults to 1. */
  readonly devicePixelRatio?: number;
  /**
   * Wait state passed to Playwright's `page.goto`. Defaults to
   * `domcontentloaded` because Playwright's own docs discourage
   * `networkidle` for SPAs (long-poll / analytics keep the network
   * busy indefinitely). After navigation we let `waitForReady` assert
   * on observable DOM state, which is the actual ready signal.
   */
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle";
  /** Optional timeout in ms applied to navigation. */
  readonly timeoutMs?: number;
  /**
   * Optional Playwright `viewport` screenshot of the rendered page.
   * Returned as PNG bytes via `screenshotBytes` when set to true.
   */
  readonly captureScreenshot?: boolean;
};

export type CaptureResult = {
  readonly snapshot: RawViewportSnapshot;
  /** PNG bytes of the rendered viewport. Present only when `captureScreenshot` was true. */
  readonly screenshotBytes?: Uint8Array;
};

/**
 * Capture a live viewport snapshot via Playwright. Throws if Playwright
 * is not installed — never silently downgrades to a static fetcher.
 *
 * Manages its own headless browser. Use `captureViewportInBrowser`
 * when you already have a Playwright browser handle — multi-viewport
 * captures should share one browser instead of paying the
 * launch-per-viewport cost (several seconds each).
 */
export async function captureViewport(options: CaptureOptions): Promise<CaptureResult> {
  const playwright = await importPlaywright();
  const browser = await playwright.chromium.launch();
  try {
    return await captureViewportInBrowser(browser, options);
  } finally {
    await browser.close();
  }
}

/** A Playwright browser handle. Exposed structurally so callers can use any compatible runtime. */
export type BrowserLike = Awaited<ReturnType<PlaywrightLike["chromium"]["launch"]>>;

/**
 * Capture a viewport using an externally-supplied browser. Lets a
 * caller orchestrate multiple captures against the same Chromium
 * process — a few hundred ms per viewport instead of seconds.
 */
export async function captureViewportInBrowser(
  browser: BrowserLike,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 800 },
    deviceScaleFactor: options.devicePixelRatio ?? 1,
  });
  try {
    const page = await context.newPage();
    // Subscribe to image responses *before* navigation so the
    // listener catches every byte the browser pays for. Playwright
    // hands us the response body the browser already loaded, so we
    // never re-issue a fetch for the same bytes — the page's own
    // request, with the page's own cookies / origin / cache state,
    // is the SoT for "what bytes ended up in the rendered DOM".
    const responseCache = startImageResponseCache(page);
    await page.goto(options.url, {
      waitUntil: options.waitUntil ?? "domcontentloaded",
      timeout: options.timeoutMs,
    });
    // Single generic readiness barrier. Asserts on observable DOM
    // state (fonts, image decode completion, custom-element SVG
    // injection) rather than guessing with sleeps or `networkidle`.
    // See wait-for-ready.ts for the full strategy.
    await waitForReady(page, { timeoutMs: options.timeoutMs });
    // Drain any still-pending response-body reads so the asset
    // cache reflects every byte the browser actually loaded.
    await responseCache.settle();
    const json = await page.evaluate(captureSnapshot);
    // Pull image bytes directly out of the browser's already-decoded
    // bitmap cache. Each rendered `<img>` has finished decoding by
    // the time the page is on-screen, so we can read it back through
    // a canvas without any second-round network fetch.
    const assets = await readAssetsFromBrowser(page, json.imageRefs, responseCache);
    const snapshot = jsonToSnapshot(json, assets);
    const screenshot = options.captureScreenshot ? await screenshotPage(page) : undefined;
    return { snapshot, screenshotBytes: screenshot };
  } finally {
    await context.close();
  }
}

/**
 * Cache of image response bytes the page itself loaded during
 * navigation. Keyed by absolute URL. The renderer's downstream
 * pipeline only knows PNG / JPEG headers, so non-(PNG|JPEG)
 * responses are rasterised inside the page (see
 * `rasterizeWithCanvas`) before being stored.
 *
 * Building this cache via `page.on('response')` is intentional:
 * Playwright is already brokering every network exchange the
 * browser made. Asking for bytes a second time — whether through
 * Node's `fetch`, Playwright's `request` API, or an in-page
 * `fetch` — is a parallel SoT for "what did this URL resolve to"
 * and would introduce drift on cookies, redirects, and cache
 * variance.
 */
type ResponseCache = {
  /** Wait for every still-pending body to settle, then return. */
  settle(): Promise<void>;
  bodyForUrl(url: string): Uint8Array | undefined;
};

function startImageResponseCache(page: PageLike): ResponseCache {
  const bodies = new Map<string, Uint8Array>();
  const inflight: Promise<void>[] = [];
  page.on("response", (response) => {
    // Each handler invocation kicks off a microtask chain that
    // ends in a `bodies.set`. We track the chain so `settle()`
    // can wait for it before the caller starts reading the cache.
    const work = (async () => {
      const headers = await response.allHeaders();
      const ct = (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!isImageMime(ct)) {
        return;
      }
      // `response.body()` may throw on a navigation-cancelled or
      // redirected response. We deliberately let that propagate as
      // `undefined` (caller falls back to the canvas read).
      const body = await safeResponseBody(response);
      if (body === undefined) {
        return;
      }
      bodies.set(response.url(), new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    })();
    inflight.push(work);
  });
  return {
    bodyForUrl: (url) => bodies.get(url),
    async settle() {
      // Drain any pending bodies so the snapshot reads a stable
      // cache. New responses can still land between draining and
      // the read (e.g. from a long-poll), but by `waitForReady`
      // every visible image is `complete`, so any straggler is by
      // definition not on the captured surface.
      while (inflight.length > 0) {
        const batch = inflight.splice(0, inflight.length);
        await Promise.all(batch);
      }
    },
  };
}

function isImageMime(mime: string): boolean {
  return mime === "image/png"
    || mime === "image/jpeg"
    || mime === "image/jpg"
    || mime === "image/gif"
    || mime === "image/webp"
    || mime === "image/svg+xml"
    || mime === "image/avif";
}

async function safeResponseBody(response: ResponseLike): Promise<Buffer | undefined> {
  try {
    return await response.body();
  } catch {
    return undefined;
  }
}

/** Launch a Chromium browser via Playwright. Returns the browser handle. */
export async function launchBrowser(): Promise<BrowserLike> {
  const playwright = await importPlaywright();
  return playwright.chromium.launch();
}

async function screenshotPage(page: { screenshot(opts: { readonly fullPage: boolean; readonly type: "png"; readonly clip?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }): Promise<Buffer> }): Promise<Uint8Array> {
  // Capture the visible viewport only — the verification step compares
  // against an SVG render at the same dimensions, so a `fullPage`
  // screenshot would include unrendered scroll content.
  const buf = await page.screenshot({ fullPage: false, type: "png" });
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

type ResponseLike = {
  url(): string;
  allHeaders(): Promise<Readonly<Record<string, string>>>;
  body(): Promise<Buffer>;
};

type PageLike = {
  goto(url: string, opts: { readonly waitUntil: string; readonly timeout: number | undefined }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  waitForFunction<T>(fn: () => T, arg?: unknown, opts?: { readonly timeout: number }): Promise<unknown>;
  waitForLoadState(state: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
  screenshot(opts: { readonly fullPage: boolean; readonly type: "png" }): Promise<Buffer>;
  on(event: "response", handler: (response: ResponseLike) => void | Promise<void>): void;
};

type PlaywrightLike = {
  readonly chromium: {
    launch(): Promise<{
      newContext(opts: {
        readonly viewport: { readonly width: number; readonly height: number };
        readonly deviceScaleFactor: number;
      }): Promise<{
        newPage(): Promise<PageLike>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

async function importPlaywright(): Promise<PlaywrightLike> {
  // Dynamic import keeps the module loadable in environments without
  // Playwright (the round-trip spec re-hydrates fixtures from disk).
  // We deliberately do not catch the import failure — a caller that
  // reaches `captureViewport` without Playwright installed gets a
  // clear module-not-found error rather than a silent stub.
  // eslint-disable-next-line no-restricted-syntax -- playwright is an optional runtime dep; static import would force it on every consumer.
  const mod: unknown = await import("playwright");
  if (!isPlaywrightLike(mod)) {
    throw new Error("captureViewport: 'playwright' module loaded but did not expose a chromium launcher");
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

/**
 * Pull each captured image's bytes from the browser's already-loaded
 * resource state. Two paths converge here, in this order:
 *
 *   1. The Playwright response cache — every image response the
 *      browser received during navigation is already in our hands
 *      (see `startImageResponseCache`). For PNG / JPEG bytes we
 *      hand them straight through to the IR; for non-(PNG|JPEG)
 *      formats (SVG, WebP, GIF, AVIF) we rasterise inside the
 *      page so the downstream renderer's
 *      `getImageDimensions` (PNG / JPEG only) can read the
 *      header. Either way the byte source is the original
 *      response — no second fetch.
 *
 *   2. For URLs the response cache did not see (cached
 *      `<img>` tags whose response landed before our listener
 *      attached, or `data:` URIs) the canvas read on the live
 *      `<img>` element provides the pixels. Cross-origin images
 *      without `crossorigin` taint the canvas — those are
 *      dropped, which is the same behaviour as before.
 *
 * Neither path issues a fetch from Node or via `window.fetch`.
 * Playwright is brokering all bytes; we only ever consume what
 * the page already loaded.
 */
async function readAssetsFromBrowser(
  page: PageLike,
  refs: RawSnapshotJson["imageRefs"],
  responseCache: ResponseCache,
): Promise<ReadonlyMap<string, RawAsset>> {
  const out = new Map<string, RawAsset>();
  for (const ref of refs) {
    if (ref.url.startsWith("data:")) {
      const decoded = decodeDataUrl(ref.url);
      if (decoded !== undefined) {
        out.set(ref.id, { id: ref.id, mime: decoded.mime, bytes: decoded.bytes });
      }
      continue;
    }
    if (ref.url.startsWith("blob:")) {
      continue;
    }
  }
  const remoteRefs = refs.filter((r) => !r.url.startsWith("data:") && !r.url.startsWith("blob:"));
  if (remoteRefs.length === 0) {
    return out;
  }
  // First pass: serve refs from the Playwright response cache.
  // PNG / JPEG (verified via magic bytes) flow straight through;
  // everything else (SVG, WebP, GIF, AVIF, …) gets rasterised
  // inside the page so the renderer's PNG/JPEG-only dimension
  // reader can decode it. We never trust `Content-Type` alone —
  // some Wikimedia thumbnails ship `image/png` headers for WebP
  // bodies after on-the-fly transcoding races.
  const needsRaster: { ref: typeof remoteRefs[number]; bytes: Uint8Array; mime: string }[] = [];
  for (const ref of remoteRefs) {
    const bytes = responseCache.bodyForUrl(ref.url);
    if (bytes === undefined) {
      continue;
    }
    const sniffed = sniffMimeFromBytes(bytes);
    if (sniffed !== undefined) {
      out.set(ref.id, { id: ref.id, mime: sniffed, bytes });
      continue;
    }
    // The blob ctor inside the rasteriser only needs *some* MIME
    // hint to dispatch the right `Image` decode path. Browsers
    // sniff the bytes themselves anyway, so the value here is
    // mostly informational — but `image/svg+xml` keeps SVG
    // dispatch deterministic across vendors.
    needsRaster.push({ ref, bytes, mime: bytesLookLikeSvg(bytes) ? "image/svg+xml" : "image/webp" });
  }
  if (needsRaster.length > 0) {
    const rasterised = await rasterizeImageBytesAsPng(
      page,
      needsRaster.map((n) => ({ bytes: n.bytes, mime: n.mime })),
    );
    for (let i = 0; i < needsRaster.length; i += 1) {
      const png = rasterised[i];
      if (png === null || png === undefined) {
        continue;
      }
      const ref = needsRaster[i]!.ref;
      out.set(ref.id, { id: ref.id, mime: "image/png", bytes: png });
    }
  }
  // Second pass: anything still missing falls back to the canvas
  // read on the live `<img>`. Same-origin images that loaded
  // *before* our `response` listener attached (Playwright sends
  // events on a microtask boundary that has no ordering guarantee
  // versus `goto`'s resolution on cached pages) come through here.
  const stillNeed = remoteRefs.filter((r) => !out.has(r.id));
  if (stillNeed.length === 0) {
    return out;
  }
  const dataUrls = await page.evaluate(
    (urls: readonly string[]) => {
      function readImage(url: string): string | null {
        // Only images that already finished decoding can be re-drawn
        // — `naturalWidth === 0` covers both "still loading" and
        // "errored", neither of which we want to wait on.
        const img = Array.from(document.images).find((candidate) => candidate.currentSrc === url || candidate.src === url);
        if (!img || !img.complete || img.naturalWidth === 0) {
          return null;
        }
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return null;
        }
        try {
          ctx.drawImage(img, 0, 0);
          // PNG keeps the original colour data lossless; JPEG would
          // re-encode every PNG capture and inflate the diff.
          return canvas.toDataURL("image/png");
        } catch {
          // Cross-origin images without CORS taint the canvas; the
          // toDataURL call throws SecurityError. We can't read those
          // back from the browser — skip silently.
          return null;
        }
      }
      return urls.map((url) => readImage(url));
    },
    stillNeed.map((r) => r.url),
  );
  for (let i = 0; i < stillNeed.length; i += 1) {
    const ref = stillNeed[i]!;
    const dataUrl = dataUrls[i];
    if (dataUrl === null || dataUrl === undefined) {
      continue;
    }
    const decoded = decodeDataUrl(dataUrl);
    if (decoded === undefined) {
      continue;
    }
    out.set(ref.id, { id: ref.id, mime: decoded.mime, bytes: decoded.bytes });
  }
  return out;
}

/**
 * Send each `(bytes, mime)` pair through `page.evaluate` and let the
 * page's `Image` decoder + canvas turn it into PNG bytes the
 * downstream renderer can read dimensions from. Order of results
 * matches order of input. The browser handles every format the
 * `<img>` element handles natively (SVG, WebP, GIF, AVIF, ...) — we
 * never decode the bytes ourselves, and never re-fetch them.
 */
async function rasterizeImageBytesAsPng(
  page: PageLike,
  inputs: readonly { bytes: Uint8Array; mime: string }[],
): Promise<readonly (Uint8Array | null)[]> {
  // Marshal binary across `page.evaluate` as base64. Playwright
  // serialises arguments via JSON; passing a `Uint8Array` directly
  // would lose the byte payload.
  const marshalled = inputs.map((i) => ({
    base64: bytesToBase64(i.bytes),
    mime: i.mime,
  }));
  const dataUrls = await page.evaluate(
    async (items: readonly { base64: string; mime: string }[]) => {
      function base64ToBytes(b64: string): Uint8Array {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) {
          out[i] = bin.charCodeAt(i);
        }
        return out;
      }
      async function rasterise(item: { base64: string; mime: string }): Promise<string | null> {
        const bytes = base64ToBytes(item.base64);
        // `Blob` accepts BufferSource members; pass the typed
        // array directly through a `BlobPart`-compatible cast.
        // The Uint8Array's underlying ArrayBuffer is narrowed to
        // SharedArrayBuffer | ArrayBuffer in TS lib.dom 5.x — but
        // every browser's Blob ctor accepts both at runtime.
        const blob = new Blob([bytes as unknown as BlobPart], { type: item.mime });
        const objectUrl = URL.createObjectURL(blob);
        try {
          const image = await new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = objectUrl;
          });
          if (!image || image.naturalWidth === 0) {
            return null;
          }
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            return null;
          }
          ctx.drawImage(image, 0, 0);
          return canvas.toDataURL("image/png");
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
      return await Promise.all(items.map((it) => rasterise(it)));
    },
    marshalled,
  );
  return dataUrls.map((dataUrl) => {
    if (dataUrl === null || dataUrl === undefined) {
      return null;
    }
    const decoded = decodeDataUrl(dataUrl);
    if (decoded === undefined) {
      return null;
    }
    return decoded.bytes;
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/**
 * Quick magic-byte sniff so a response without a `Content-Type`
 * (or a generic `application/octet-stream`) still routes to the
 * right downstream pass. Only PNG / JPEG short-circuit the
 * rasterisation pass; everything else (SVG, WebP, …) returns
 * `undefined` here and falls through to the in-page rasteriser.
 */
function sniffMimeFromBytes(bytes: Uint8Array): RawAsset["mime"] | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return undefined;
}

function bytesLookLikeSvg(bytes: Uint8Array): boolean {
  // Look at the first 256 bytes for an XML or SVG opening tag.
  // SVG files commonly start with `<?xml ...?>` then `<svg`; some
  // omit the XML declaration. Either form maps to the SVG decode
  // path inside the page.
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(256, bytes.length)));
  if (head.startsWith("<?xml")) {
    return head.includes("<svg");
  }
  return head.trimStart().startsWith("<svg");
}

function decodeDataUrl(url: string): { mime: RawAsset["mime"]; bytes: Uint8Array } | undefined {
  const head = url.indexOf(",");
  if (head < 0 || !url.startsWith("data:")) {
    return undefined;
  }
  const meta = url.slice(5, head);
  const payload = url.slice(head + 1);
  const isBase64 = /;base64$/.test(meta);
  const mimeRaw = meta.replace(/;base64$/, "") || "application/octet-stream";
  const mime: RawAsset["mime"] = (mimeRaw === "image/png" || mimeRaw === "image/jpeg"
    || mimeRaw === "image/gif" || mimeRaw === "image/webp" || mimeRaw === "image/svg+xml")
    ? mimeRaw
    : "image/png";
  const bytes = isBase64
    ? Uint8Array.from(Buffer.from(payload, "base64"))
    : Uint8Array.from(Buffer.from(decodeURIComponent(payload), "binary"));
  return { mime, bytes };
}

/**
 * Re-hydrate the in-page JSON payload into the `RawViewportSnapshot`
 * shape — a Map for assets and `RawElement` (vs `ElementJson`) for the
 * tree. Exposed so on-disk fixtures can be replayed without launching
 * Playwright.
 */
export function jsonToSnapshot(
  json: RawSnapshotJson,
  assets: ReadonlyMap<string, RawAsset>,
): RawViewportSnapshot {
  return {
    source: json.source,
    viewport: json.viewport,
    devicePixelRatio: json.devicePixelRatio,
    background: json.background,
    root: elementJsonToRaw(json.root),
    assets,
  };
}

function elementJsonToRaw(json: ElementJson): RawElement {
  return {
    id: json.id,
    tag: json.tag,
    rect: json.rect,
    contentRect: json.contentRect,
    visible: json.visible,
    computedStyle: json.computedStyle,
    imageId: json.imageId,
    svgContent: json.svgContent,
    text: json.text,
    pseudo: json.pseudo,
    children: json.children.map(elementJsonToRaw),
  };
}
