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

export type CaptureOptions = {
  readonly url: string;
  /** CSS pixels. Defaults to a desktop viewport so layout matches typical Figma frames. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Device pixel ratio applied to the browser context. Defaults to 1. */
  readonly devicePixelRatio?: number;
  /** Wait state passed to Playwright's `page.goto`. Defaults to `networkidle`. */
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
 * When `captureScreenshot` is set, also returns a PNG screenshot of
 * the rendered viewport — used by the visual-fidelity verifier to
 * pixel-diff against the SVG/PNG produced from the resulting `.fig`.
 */
export async function captureViewport(options: CaptureOptions): Promise<CaptureResult> {
  const playwright = await importPlaywright();
  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 800 },
      deviceScaleFactor: options.devicePixelRatio ?? 1,
    });
    const page = await context.newPage();
    await page.goto(options.url, {
      waitUntil: options.waitUntil ?? "networkidle",
      timeout: options.timeoutMs,
    });
    const json = await page.evaluate(captureSnapshot);
    const assets = await fetchAssets(page, json.imageRefs);
    const snapshot = jsonToSnapshot(json, assets);
    const screenshot = options.captureScreenshot ? await screenshotPage(page) : undefined;
    return { snapshot, screenshotBytes: screenshot };
  } finally {
    await browser.close();
  }
}

async function screenshotPage(page: { screenshot(opts: { readonly fullPage: boolean; readonly type: "png"; readonly clip?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }): Promise<Buffer> }): Promise<Uint8Array> {
  // Capture the visible viewport only — the verification step compares
  // against an SVG render at the same dimensions, so a `fullPage`
  // screenshot would include unrendered scroll content.
  const buf = await page.screenshot({ fullPage: false, type: "png" });
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

type PlaywrightLike = {
  readonly chromium: {
    launch(): Promise<{
      newContext(opts: {
        readonly viewport: { readonly width: number; readonly height: number };
        readonly deviceScaleFactor: number;
      }): Promise<{
        newPage(): Promise<{
          goto(url: string, opts: { readonly waitUntil: string; readonly timeout: number | undefined }): Promise<unknown>;
          evaluate<T>(fn: () => T): Promise<T>;
          context(): { request: { get(url: string): Promise<{ ok(): boolean; status(): number; body(): Promise<Buffer>; headers(): Record<string, string> }> } };
          screenshot(opts: { readonly fullPage: boolean; readonly type: "png" }): Promise<Buffer>;
        }>;
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

type PageWithRequest = Awaited<ReturnType<Awaited<ReturnType<PlaywrightLike["chromium"]["launch"]>>["newContext"]>>["newPage"] extends () => Promise<infer P>
  ? P
  : never;

async function fetchAssets(
  page: PageWithRequest,
  refs: RawSnapshotJson["imageRefs"],
): Promise<ReadonlyMap<string, RawAsset>> {
  const out = new Map<string, RawAsset>();
  for (const ref of refs) {
    const response = await page.context().request.get(ref.url);
    if (!response.ok()) {
      throw new Error(`captureViewport: failed to fetch ${ref.url} — status ${response.status()}`);
    }
    const buffer = await response.body();
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const mime = inferMime(ref.url, response.headers());
    out.set(ref.id, { id: ref.id, mime, bytes });
  }
  return out;
}

function inferMime(url: string, headers: Record<string, string>): RawAsset["mime"] {
  const headerMime = headers["content-type"]?.split(";")[0]?.trim();
  if (headerMime === "image/png" || headerMime === "image/jpeg" || headerMime === "image/gif"
    || headerMime === "image/webp" || headerMime === "image/svg+xml") {
    return headerMime;
  }
  if (url.endsWith(".png")) {
    return "image/png";
  }
  if (url.endsWith(".jpg") || url.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (url.endsWith(".gif")) {
    return "image/gif";
  }
  if (url.endsWith(".webp")) {
    return "image/webp";
  }
  if (url.endsWith(".svg")) {
    return "image/svg+xml";
  }
  throw new Error(
    `captureViewport: cannot infer MIME for ${url} — server returned content-type "${headerMime ?? "unknown"}"`,
  );
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
    text: json.text,
    children: json.children.map(elementJsonToRaw),
  };
}
