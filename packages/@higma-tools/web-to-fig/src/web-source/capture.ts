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
    await page.goto(options.url, {
      waitUntil: options.waitUntil ?? "domcontentloaded",
      timeout: options.timeoutMs,
    });
    // Single generic readiness barrier. Asserts on observable DOM
    // state (fonts, image decode completion, custom-element SVG
    // injection) rather than guessing with sleeps or `networkidle`.
    // See wait-for-ready.ts for the full strategy.
    await waitForReady(page, { timeoutMs: options.timeoutMs });
    const json = await page.evaluate(captureSnapshot);
    // Pull image bytes directly out of the browser's already-decoded
    // bitmap cache. Each rendered `<img>` has finished decoding by
    // the time the page is on-screen, so we can read it back through
    // a canvas without any second-round network fetch.
    const assets = await readAssetsFromBrowser(page, json.imageRefs);
    const snapshot = jsonToSnapshot(json, assets);
    const screenshot = options.captureScreenshot ? await screenshotPage(page) : undefined;
    return { snapshot, screenshotBytes: screenshot };
  } finally {
    await context.close();
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

type PageLike = {
  goto(url: string, opts: { readonly waitUntil: string; readonly timeout: number | undefined }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  waitForFunction<T>(fn: () => T, arg?: unknown, opts?: { readonly timeout: number }): Promise<unknown>;
  waitForLoadState(state: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
  screenshot(opts: { readonly fullPage: boolean; readonly type: "png" }): Promise<Buffer>;
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
 * Pull each captured image's bytes directly out of the browser's
 * already-decoded bitmap cache. The page is on-screen at this point,
 * so every `<img>` whose `complete === true` has its decoded data
 * sitting in GPU/CPU memory — drawing it onto a canvas and reading
 * the result back through `toDataURL` gives us the bytes without
 * touching the network. URLs that never finished loading (lazy
 * thumbnails, errored fetches, blob URLs that died with the page
 * lifecycle) are silently dropped.
 *
 * Why not refetch from the host: a second-round HTTP fetch would
 * pay the full network cost again, and on cookie-jar-heavy sites
 * (YouTube, etc.) Playwright's APIRequest helper trips on
 * Set-Cookie headers and aborts the whole capture. The browser
 * itself already paid the bandwidth; we just borrow the result.
 */
async function readAssetsFromBrowser(
  page: PageLike,
  refs: RawSnapshotJson["imageRefs"],
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
    remoteRefs.map((r) => r.url),
  );
  for (let i = 0; i < remoteRefs.length; i += 1) {
    const ref = remoteRefs[i]!;
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
    children: json.children.map(elementJsonToRaw),
  };
}
