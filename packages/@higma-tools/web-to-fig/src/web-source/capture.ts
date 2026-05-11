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
import {
  type BrowserLike as SharedBrowserLike,
  type FrameLike,
  type PageLike,
  type ResponseCache,
  importPlaywright,
  isImageMime,
  launchBrowser as launchBrowserShared,
  startResponseCache,
} from "./playwright-shared";
import {
  type FramesetEntry,
  type FramesetProbe,
  assembleFramesetSnapshot,
  captureFrameContent,
  matchFrame,
  probeFrameset,
} from "./frameset";

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
  /**
   * When taking the screenshot, capture the full scrollable
   * document instead of the visible viewport only. Defaults to
   * `false` (viewport-sized PNG) so existing callers keep their
   * behaviour. Set to `true` for cases-fullpage diff loops where
   * the renderer also produces a full-document `.fig` and the
   * comparison must include everything below the fold.
   */
  readonly fullPageScreenshot?: boolean;
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

/**
 * Capture a viewport using an externally-supplied browser. Lets a
 * caller orchestrate multiple captures against the same Chromium
 * process — a few hundred ms per viewport instead of seconds.
 */
export async function captureViewportInBrowser(
  browser: SharedBrowserLike,
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
    const responseCache = startResponseCache(page, isImageMime);
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
    // HTML4 `<frameset>` documents have no `<body>` — the
    // `captureSnapshot()` walk over `document.documentElement` would
    // emit just the `<frame>` shells (because frame DOM is in a
    // separate browsing context). Detect this layout and route to
    // the per-frame capture path which evaluates inside each loaded
    // sub-document.
    const probe = await page.evaluate(probeFrameset);
    if (probe.isFrameset) {
      const snapshot = await captureFramesetInBrowser(page, probe, responseCache);
      const screenshot = options.captureScreenshot
        ? await screenshotPage(page, options.fullPageScreenshot ?? false)
        : undefined;
      return { snapshot, screenshotBytes: screenshot };
    }
    const json = await page.evaluate(captureSnapshot);
    // Pull image bytes directly out of the browser's already-decoded
    // bitmap cache. Each rendered `<img>` has finished decoding by
    // the time the page is on-screen, so we can read it back through
    // a canvas without any second-round network fetch.
    const assets = await readAssetsFromBrowser(page, json.imageRefs, responseCache);
    // Decorate each element carrying a `maskImageId` with the SVG
    // path geometry parsed from the response bytes. The
    // `mask-image` URL routes through the same imageRefs registry
    // as `<img src>` and `background-image`, so the bytes are
    // already available — we just choose the SVG-vector path
    // instead of "image fill" because the browser uses the asset
    // as an alpha mask, not a paint.
    const idToUrl = new Map<string, string>();
    for (const ref of json.imageRefs) {
      idToUrl.set(ref.id, ref.url);
    }
    // Single fused walk: parses SVG mask content, sniffs image
    // natural size, sniffs mask natural size — what used to be three
    // independent full-tree rewrites in sequence.
    const decoratedRoot = decorateAll(json.root, idToUrl, responseCache, assets);
    const snapshot = jsonToSnapshot({ ...json, root: decoratedRoot }, assets);
    const screenshot = options.captureScreenshot
      ? await screenshotPage(page, options.fullPageScreenshot ?? false)
      : undefined;
    return { snapshot, screenshotBytes: screenshot };
  } finally {
    await context.close();
  }
}

/**
 * Frameset capture path. Probes each `<frame>` element on the host
 * page, finds its corresponding Playwright `Frame` via URL match,
 * runs `captureSnapshot()` inside each frame's document context, and
 * stitches the results into a single host-coordinate snapshot.
 *
 * Image asset harvesting is performed *after* assembly, against the
 * union of every per-frame `imageRefs` array. The response cache is
 * page-wide (Playwright fires `response` events for sub-frame URLs
 * the same way it fires for the main page), so cached bytes are
 * already available for both same-origin and cross-origin frames
 * the page successfully loaded.
 */
async function captureFramesetInBrowser(
  page: PageLike,
  probe: FramesetProbe,
  responseCache: ResponseCache,
): Promise<RawViewportSnapshot> {
  const allFrames = page.frames();
  const usedFrames = new Set<FrameLike>();
  // Capture each frame's snapshot, rejecting frames whose URL we
  // can't match — a frame element with `src=""` or one whose load
  // failed will not have a corresponding Playwright Frame.
  const perFrame: { entry: FramesetEntry; snapshot: RawSnapshotJson }[] = [];
  for (const entry of probe.frames) {
    if (entry.src === "" || entry.src === "about:blank") {
      continue;
    }
    const frame = matchFrame(entry, allFrames, usedFrames);
    if (frame === undefined) {
      // No Playwright frame matches this `<frame>` `src`. The site
      // must have failed to load that frame; we skip rather than
      // synthesise an empty placeholder, so downstream rendering
      // shows the gap honestly. A future enhancement could surface
      // the gap as an annotated "load failed" rectangle, but that
      // belongs in a separate IR concept, not here.
      continue;
    }
    const snapshot = await captureFrameContent(frame, entry.id);
    perFrame.push({ entry, snapshot });
  }
  // Build the union of imageRefs from every frame's snapshot. Each
  // ref already carries a frame-prefixed id (see `captureFrameContent`).
  const allRefs: { id: string; url: string }[] = [];
  for (const f of perFrame) {
    for (const ref of f.snapshot.imageRefs) {
      allRefs.push({ id: ref.id, url: ref.url });
    }
  }
  const assets = await readAssetsFromBrowser(page, allRefs, responseCache);
  // Decorate each frame's root with mask SVG / natural size, then
  // re-translate per `assembleFramesetSnapshot`. The decorate passes
  // are ElementJson-shaped, so we keep them in JSON space.
  const idToUrl = new Map<string, string>();
  for (const ref of allRefs) {
    idToUrl.set(ref.id, ref.url);
  }
  const decoratedFrames = perFrame.map(({ entry, snapshot }) => {
    const decorated = decorateAll(snapshot.root, idToUrl, responseCache, assets);
    return { entry, snapshot: { ...snapshot, root: decorated } };
  });
  return assembleFramesetSnapshot(probe, decoratedFrames, assets);
}

async function screenshotPage(
  page: { screenshot(opts: { readonly fullPage: boolean; readonly type: "png"; readonly clip?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }): Promise<Buffer> },
  fullPage: boolean,
): Promise<Uint8Array> {
  // The visual-fidelity verifier runs in two flavours:
  //   - viewport-only diff (single-viewport breakpoint cases) where
  //     the renderer's output and the screenshot must agree on the
  //     viewport rect; full-page would include unrendered scroll
  //     content.
  //   - full-page diff (cases-fullpage) where the rendered `.fig`
  //     is the entire document and the screenshot must match.
  // Caller passes the right flag for the case at hand.
  const buf = await page.screenshot({ fullPage, type: "png" });
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Launch a Chromium browser via Playwright. Re-exported so existing
 * callers (multi-capture, the leaf-up harness) keep their import path.
 * Implementation lives in `playwright-shared.ts`. */
export const launchBrowser: typeof launchBrowserShared = launchBrowserShared;

/**
 * Pull each captured image's bytes from the browser's already-loaded
 * resource state. Two paths converge here, in this order:
 *
 *   1. The Playwright response cache — every image response the
 *      browser received during navigation is already in our hands
 *      (see `startResponseCache` in playwright-shared.ts). For PNG / JPEG bytes we
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
  // Collect data: SVG references that need in-page rasterisation —
  // the renderer's `getImageDimensions` only reads PNG / JPEG
  // headers, so an SVG asset would trip "requires decodable image
  // dimensions" at render time.
  const dataSvgToRaster: { ref: typeof refs[number]; bytes: Uint8Array }[] = [];
  for (const ref of refs) {
    if (ref.url.startsWith("data:")) {
      const decoded = decodeDataUrl(ref.url);
      if (decoded !== undefined) {
        if (decoded.mime === "image/png" || decoded.mime === "image/jpeg") {
          out.set(ref.id, { id: ref.id, mime: decoded.mime, bytes: decoded.bytes });
        } else {
          dataSvgToRaster.push({ ref, bytes: decoded.bytes });
        }
      }
      continue;
    }
    if (ref.url.startsWith("blob:")) {
      continue;
    }
  }
  if (dataSvgToRaster.length > 0) {
    const rasterised = await rasterizeImageBytesAsPng(
      page,
      dataSvgToRaster.map((d) => ({
        bytes: d.bytes,
        mime: bytesLookLikeSvg(d.bytes) ? "image/svg+xml" : "image/webp",
      })),
    );
    for (let i = 0; i < dataSvgToRaster.length; i += 1) {
      const png = rasterised[i];
      if (png === null || png === undefined) {
        continue;
      }
      const ref = dataSvgToRaster[i]!.ref;
      out.set(ref.id, { id: ref.id, mime: "image/png", bytes: png });
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
  // The MIME field of a data URL is `<type>/<subtype>` followed by
  // optional `;parameter=value` segments (e.g. `;charset=utf-8`).
  // Trim every `;…` segment off before comparing to the
  // bridge-supported set, otherwise a legitimate
  // `image/svg+xml;charset=utf-8` falls into the dead-end "unknown
  // mime" branch and the SVG body would be mis-stored as
  // `image/png`.
  const stripped = meta.replace(/;[^;]+/g, "");
  const mimeRaw = stripped || "application/octet-stream";
  if (mimeRaw !== "image/png" && mimeRaw !== "image/jpeg"
    && mimeRaw !== "image/gif" && mimeRaw !== "image/webp"
    && mimeRaw !== "image/svg+xml") {
    throw new Error(
      `decodeDataUrl: unsupported MIME "${mimeRaw}" in data URL — the bridge only `
      + `accepts PNG / JPEG / GIF / WebP / SVG. Falling back to a different mime would `
      + `produce an asset whose bytes don't match the declared format.`,
    );
  }
  const mime: RawAsset["mime"] = mimeRaw;
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
    imageIds: json.imageIds,
    imageNaturalWidth: json.imageNaturalWidth,
    imageNaturalHeight: json.imageNaturalHeight,
    maskImageId: json.maskImageId,
    maskSvgContent: json.maskSvgContent
      ? maskSvgContentJsonToRaw(json.maskSvgContent)
      : undefined,
    maskNaturalWidth: json.maskNaturalWidth,
    maskNaturalHeight: json.maskNaturalHeight,
    svgContent: json.svgContent,
    text: json.text,
    textFragments: json.textFragments,
    textLineRects: json.textLineRects,
    pseudo: json.pseudo,
    children: json.children.map(elementJsonToRaw),
  };
}

function maskSvgContentJsonToRaw(json: NonNullable<ElementJson["maskSvgContent"]>): NonNullable<RawElement["maskSvgContent"]> {
  return {
    viewBox: json.viewBox,
    paths: json.paths.map((p) => ({
      d: p.d,
      fill: p.fill,
      stroke: p.stroke,
      strokeWidth: p.strokeWidth,
      fillRule: p.fillRule,
      transform: p.transform,
    })),
  };
}

/**
 * Single-pass decorate that fuses what used to be three separate
 * full-tree walks (mask SVG parse, image natural size, mask natural
 * size) into one. The earlier three-pass design rebuilt the entire
 * tree three times via `children.map(...)`, so a Yahoo-class capture
 * with ~10k elements paid 3× the per-node allocation cost and held
 * up to 3 transient tree copies in memory at once.
 *
 * Why fuseable: the three passes are independent — each reads only
 * its own element fields (`maskImageId`, `imageId`, `maskImageId`
 * again) and produces a disjoint output (`maskSvgContent`,
 * `imageNaturalWidth/Height`, `maskNaturalWidth/Height`). They never
 * inspect each other's outputs, so we can decide every annotation
 * at the same node visit and emit the new element once.
 *
 * Per-element allocation: at most one new object per node (only when
 * any of the three annotations actually applies, or when a child
 * was rewritten). Untouched subtrees return verbatim, keeping
 * structural sharing maximal — most nodes on a real capture have
 * neither mask nor image, and they round-trip through the walk
 * without an allocation.
 */
export function decorateAll(
  el: ElementJson,
  idToUrl: ReadonlyMap<string, string>,
  responseCache: ResponseCache,
  assets: ReadonlyMap<string, RawAsset>,
): ElementJson {
  // Walk children first; reuse the input array when nothing changed
  // to keep structural sharing. A naive `children.map(...)` always
  // allocates, even when every child returned identically.
  const newChildren = mapPreserve(el.children, (c) => decorateAll(c, idToUrl, responseCache, assets));
  // Compute the three annotations independently.
  const mask = el.maskImageId !== undefined
    ? resolveMaskSvgContent(el.maskImageId, idToUrl, responseCache)
    : undefined;
  const imageDim = el.imageId !== undefined
    ? sniffNaturalSize(el.imageId, idToUrl, responseCache, assets)
    : undefined;
  const maskDim = el.maskImageId !== undefined
    ? sniffNaturalSize(el.maskImageId, idToUrl, responseCache, assets)
    : undefined;
  // Skip the spread when nothing changed — avoids a per-node
  // allocation for the (very common) case of a non-image leaf.
  const childrenChanged = newChildren !== el.children;
  const hasMaskSvg = mask !== undefined;
  const hasImageDim = imageDim !== undefined;
  const hasMaskDim = maskDim !== undefined;
  if (!childrenChanged && !hasMaskSvg && !hasImageDim && !hasMaskDim) {
    return el;
  }
  return {
    ...el,
    children: newChildren,
    maskSvgContent: hasMaskSvg ? mask : el.maskSvgContent,
    imageNaturalWidth: hasImageDim ? imageDim.width : el.imageNaturalWidth,
    imageNaturalHeight: hasImageDim ? imageDim.height : el.imageNaturalHeight,
    maskNaturalWidth: hasMaskDim ? maskDim.width : el.maskNaturalWidth,
    maskNaturalHeight: hasMaskDim ? maskDim.height : el.maskNaturalHeight,
  };
}

/**
 * Map a readonly array, returning the input verbatim when every
 * mapped element is referentially equal to its source. Functions as
 * a structural-sharing helper that lets the decorate walker skip
 * allocating a new array and a new parent element when no descendant
 * actually changed.
 */
function mapPreserve<T>(input: readonly T[], fn: (item: T) => T): readonly T[] {
  const out: T[] = [];
  // eslint-disable-next-line no-restricted-syntax -- structural-sharing flag is intrinsically mutable
  let changed = false;
  for (const item of input) {
    const mapped = fn(item);
    if (mapped !== item) {
      changed = true;
    }
    out.push(mapped);
  }
  return changed ? out : input;
}

/**
 * Resolve a mask URL to parsed SVG content via the response cache or
 * data URL decode. Returns `undefined` when the URL is unknown or
 * the bytes don't parse as SVG — callers leave the element unchanged
 * in that case.
 */
function resolveMaskSvgContent(
  maskImageId: string,
  idToUrl: ReadonlyMap<string, string>,
  responseCache: ResponseCache,
): NonNullable<ElementJson["maskSvgContent"]> | undefined {
  const url = idToUrl.get(maskImageId);
  if (url === undefined) {
    return undefined;
  }
  const bytes = url.startsWith("data:")
    ? decodeMaskDataUrl(url)
    : responseCache.bodyForUrl(url);
  if (bytes === undefined) {
    return undefined;
  }
  return parseMaskSvg(bytes);
}

function decodeMaskDataUrl(url: string): Uint8Array | undefined {
  const head = url.indexOf(",");
  if (head < 0 || !url.startsWith("data:")) {
    return undefined;
  }
  const meta = url.slice(5, head);
  const payload = url.slice(head + 1);
  const isBase64 = /;base64$/.test(meta);
  if (isBase64) {
    return Uint8Array.from(Buffer.from(payload, "base64"));
  }
  // CSS data URIs commonly URL-encode the SVG body.
  return Uint8Array.from(Buffer.from(decodeURIComponent(payload), "binary"));
}

/**
 * Parse a mask SVG byte buffer into the IR-friendly path /
 * viewBox shape. Only the shapes the bridge already supports are
 * extracted; unsupported features (`<g transform>`, `<use>`,
 * gradient fills) are dropped so the mask renders as the union of
 * its plain `<path>` geometry filled with the host element's
 * colour. The bytes come from `mask-image` URLs the browser
 * already loaded via Playwright; we never re-fetch.
 */
function sniffNaturalSize(
  imageId: string,
  idToUrl: ReadonlyMap<string, string>,
  responseCache: ResponseCache,
  assets: ReadonlyMap<string, RawAsset>,
): { width: number; height: number } | undefined {
  const asset = assets.get(imageId);
  if (asset !== undefined) {
    const dim = sniffBytesNaturalSize(asset.bytes);
    if (dim !== undefined) {
      return dim;
    }
  }
  const url = idToUrl.get(imageId);
  if (url !== undefined) {
    if (url.startsWith("data:")) {
      const decoded = decodeMaskDataUrl(url);
      if (decoded !== undefined) {
        const dim = sniffBytesNaturalSize(decoded);
        if (dim !== undefined) {
          return dim;
        }
      }
    } else {
      const bytes = responseCache.bodyForUrl(url);
      if (bytes !== undefined) {
        const dim = sniffBytesNaturalSize(bytes);
        if (dim !== undefined) {
          return dim;
        }
      }
    }
  }
  return undefined;
}

function sniffBytesNaturalSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    for (let i = 0; i < bytes.length - 9; i += 1) {
      if (bytes[i] === 0xff && (bytes[i + 1] === 0xc0 || bytes[i + 1] === 0xc2)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + i + 5, 4);
        const height = view.getUint16(0);
        const width = view.getUint16(2);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    }
  }
  // SVG: width/height attrs or viewBox.
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(1024, bytes.length)));
  if (head.includes("<svg")) {
    const widthMatch = head.match(/<svg[^>]*\swidth\s*=\s*"([^"]+)"/);
    const heightMatch = head.match(/<svg[^>]*\sheight\s*=\s*"([^"]+)"/);
    if (widthMatch && heightMatch) {
      const w = parseFloat(widthMatch[1]!);
      const h = parseFloat(heightMatch[1]!);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return { width: w, height: h };
      }
    }
    const viewBox = head.match(/viewBox\s*=\s*"([^"]+)"/);
    if (viewBox) {
      const parts = viewBox[1]!.trim().split(/[\s,]+/).map((s) => parseFloat(s));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2]! > 0 && parts[3]! > 0) {
        return { width: parts[2]!, height: parts[3]! };
      }
    }
  }
  return undefined;
}

function parseMaskSvg(bytes: Uint8Array): NonNullable<ElementJson["maskSvgContent"]> | undefined {
  const text = new TextDecoder("utf-8").decode(bytes);
  if (text.indexOf("<svg") < 0) {
    return undefined;
  }
  const viewBoxMatch = text.match(/viewBox\s*=\s*"([^"]+)"/);
  let viewBox: { minX: number; minY: number; width: number; height: number } | undefined;
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1]!.trim().split(/[\s,]+/).map((s) => parseFloat(s));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      viewBox = { minX: parts[0]!, minY: parts[1]!, width: parts[2]!, height: parts[3]! };
    }
  }
  // Mutable accumulator; the function returns its readonly view via
  // the structural type widening at the `return` site.
  const paths: { d: string; fill?: string; fillRule?: "evenodd" }[] = [];
  // `<path d="..." [fill="..."] [fill-rule="..."]>` — capture each
  // self-closing or open path element. The IR carries the literal
  // `d`; further normalisation happens at the renderer.
  const pathRe = /<path\b([^>]*?)\/?>/g;
  // eslint-disable-next-line no-restricted-syntax -- regex match cursor is intrinsically mutable
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(text)) !== null) {
    const attrs = m[1]!;
    const dMatch = attrs.match(/\sd\s*=\s*"([^"]*)"/);
    if (!dMatch) {
      continue;
    }
    const d = dMatch[1]!;
    if (d.length === 0) {
      continue;
    }
    const fillMatch = attrs.match(/\sfill\s*=\s*"([^"]*)"/);
    const fillRuleMatch = attrs.match(/\sfill-rule\s*=\s*"([^"]*)"/);
    paths.push({
      d,
      fill: fillMatch?.[1] ?? undefined,
      fillRule: fillRuleMatch?.[1] === "evenodd" ? "evenodd" : undefined,
    });
  }
  if (paths.length === 0) {
    return undefined;
  }
  return { viewBox, paths };
}
