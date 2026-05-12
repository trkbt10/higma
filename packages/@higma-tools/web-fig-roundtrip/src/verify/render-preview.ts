/**
 * @file Drive Chromium against fig-to-web's standalone HTML output
 * and screenshot each viewport.
 *
 * The verifier hits one URL per breakpoint — `pages/<canvasSlug>/
 * <slug>/index.html` — at the breakpoint's authoring viewport, then
 * waits for the React render to settle before snapping the PNG. The
 * standalone HTML is emitted by fig-to-web specifically so this
 * pipeline can sample the React render without the dual-pane
 * preview shell wrapping it.
 *
 * Frame discovery is by name suffix: web-to-fig writes each top-level
 * frame as `<breakpoint> / <w>×<h>`, and fig-to-web's slug derives
 * from that name (e.g. `mobile-375x667`). We index every standalone
 * route by their breakpoint prefix and join against the captured
 * breakpoints.
 */
import type { CapturedBreakpoint } from "@higma-tools/web-to-fig/web-source";

export type RenderedPreviewFrame = {
  readonly breakpoint: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
};

export type RenderPreviewOptions = {
  readonly baseUrl: string;
  readonly captures: readonly CapturedBreakpoint[];
  readonly devicePixelRatio?: number;
  readonly waitForFontsMs?: number;
};

export async function renderPreview(options: RenderPreviewOptions): Promise<readonly RenderedPreviewFrame[]> {
  const playwright = await importPlaywright();
  const browser = await playwright.chromium.launch();
  const out: RenderedPreviewFrame[] = [];
  try {
    for (const cap of options.captures) {
      const route = await resolveRouteForBreakpoint(options.baseUrl, cap);
      if (route === undefined) {
        throw new Error(`renderPreview: no fig-to-web standalone route found for breakpoint "${cap.breakpoint.name}"`);
      }
      const frame = await renderOneBreakpoint(browser, route, cap, options);
      out.push(frame);
    }
  } finally {
    await browser.close();
  }
  return out;
}

type PlaywrightBrowser = Awaited<ReturnType<PlaywrightLike["chromium"]["launch"]>>;

async function renderOneBreakpoint(
  browser: PlaywrightBrowser,
  route: StandaloneRoute,
  cap: CapturedBreakpoint,
  options: RenderPreviewOptions,
): Promise<RenderedPreviewFrame> {
  const context = await browser.newContext({
    viewport: { width: cap.breakpoint.width, height: cap.breakpoint.height },
    deviceScaleFactor: cap.breakpoint.devicePixelRatio ?? options.devicePixelRatio ?? 1,
  });
  try {
    const page = await context.newPage();
    await page.goto(route.url, { waitUntil: "networkidle", timeout: 30000 });
    // Wait for React to mount and any fonts to settle. The React
    // boot is synchronous after `main.js` executes, so we just
    // make sure the document's fonts are ready before sampling.
    await page.evaluate(() => document.fonts.ready);
    if ((options.waitForFontsMs ?? 0) > 0) {
      await new Promise((r) => setTimeout(r, options.waitForFontsMs));
    }
    const buf = await page.screenshot({ type: "png", fullPage: false });
    return {
      breakpoint: cap.breakpoint.name,
      url: route.url,
      width: cap.breakpoint.width,
      height: cap.breakpoint.height,
      png: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    };
  } finally {
    await context.close();
  }
}

type StandaloneRoute = {
  readonly breakpoint: string;
  readonly url: string;
};

/**
 * Map a captured breakpoint name to a `pages/<canvasSlug>/<slug>/`
 * route on the preview server. The frame slug fig-to-web emits is
 * built from the source frame name (`mobile / 375×667` → `mobile-375x667`),
 * so the breakpoint label always appears as a leading token.
 *
 * We discover live by walking the preview server's `pages/<canvas>/`
 * directory listing — which we don't have HTTP-side. Instead we
 * encode the canvas (`Web Capture` → `web-capture`) and probe
 * candidate slugs. The captured frame name is the source of truth
 * for the slug shape.
 */
async function resolveRouteForBreakpoint(baseUrl: string, cap: CapturedBreakpoint): Promise<StandaloneRoute | undefined> {
  const canvas = "web-capture";
  const w = Math.round(cap.breakpoint.width);
  const h = Math.round(cap.breakpoint.height);
  const candidates = [
    `${cap.breakpoint.name}-${w}x${h}`,
    `${cap.breakpoint.name}-${w}-${h}`,
    cap.breakpoint.name,
  ];
  for (const slug of candidates) {
    const url = `${baseUrl}/pages/${canvas}/${slug}/`;
    const res = await fetch(`${url}index.html`);
    if (res.ok) {
      return { breakpoint: cap.breakpoint.name, url };
    }
  }
  return undefined;
}

type PlaywrightLike = {
  readonly chromium: {
    launch(): Promise<{
      newContext(opts: {
        readonly viewport: { readonly width: number; readonly height: number };
        readonly deviceScaleFactor: number;
      }): Promise<{
        newPage(): Promise<{
          goto(url: string, opts: { readonly waitUntil: string; readonly timeout: number }): Promise<unknown>;
          evaluate<T>(fn: () => T): Promise<T>;
          screenshot(opts: { readonly type: "png"; readonly fullPage: boolean }): Promise<Buffer>;
        }>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

async function importPlaywright(): Promise<PlaywrightLike> {
  // eslint-disable-next-line no-restricted-syntax -- playwright is an optional runtime dep.
  const mod: unknown = await import("playwright");
  if (typeof mod !== "object" || mod === null) {
    throw new Error("renderPreview: 'playwright' module loaded but is not an object");
  }
  const candidate = mod as { readonly chromium?: { readonly launch?: unknown } };
  if (typeof candidate.chromium?.launch !== "function") {
    throw new Error("renderPreview: 'playwright' module is missing chromium.launch");
  }
  return mod as PlaywrightLike;
}
