/**
 * @file Render a `.fig` directly via the in-house WebGL renderer.
 *
 * Uses the same harness pattern the renderer's WebGL parity tests use:
 *
 *   loadFigFile  → FigDesignDocument
 *                → buildSceneGraph (per wrapper FRAME)
 *                → vite-served harness page
 *                → puppeteer captureWebGL → PNG
 *
 * This isolates `web-to-fig` correctness from `fig-to-web` rendering —
 * the only path under test is the .fig structure itself, evaluated by
 * the production WebGL renderer that Figma-equivalent fidelity tests
 * already trust.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { createServer, type ViteDevServer } from "vite";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { buildNodeTree } from "@higma-document-models/fig/domain";
import { treeToDocument } from "@higma-document-io/fig/context";
import type { FigDesignDocument, FigDesignNode } from "@higma-document-models/fig/domain";
import { buildSceneGraph } from "@higma-document-renderers/fig/scene-graph";
import { createNodeFontLoaderWithFontsource } from "@higma-document-renderers/fig/font-drivers/node";
import {
  createCachingFontLoader,
  fontQueryKey,
  collectFontQueries,
  preloadFonts,
  type FontQuery,
  type LoadedFont,
} from "@higma-document-models/fig/font";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type WebglHarness = {
  readonly server: ViteDevServer;
  readonly browser: Browser;
  readonly page: Page;
  stop(): Promise<void>;
};

export type FigDirectRenderResult = {
  readonly breakpoint: string;
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
};

/** Path to the harness page that runs the WebGL renderer. */
const HARNESS_CONFIG_PATH = resolve(__dirname, "../webgl-harness/vite.config.ts");

/**
 * Spin up the WebGL harness — vite dev server + puppeteer, with the
 * harness page loaded and ready to accept `renderSceneGraph(json)`
 * calls. Caller owns the lifecycle via `stop()`.
 */
export async function startWebglHarness(): Promise<WebglHarness> {
  const server = await createServer({
    configFile: HARNESS_CONFIG_PATH,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const info = await server.listen();
  const address = info.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("startWebglHarness: failed to obtain server address");
  }
  const url = `http://127.0.0.1:${(address as { port: number }).port}`;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warn") {
      process.stderr.write(`[harness ${msg.type()}] ${msg.text()}\n`);
    }
  });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.title === "ready", { timeout: 15000 });
  return {
    server,
    browser,
    page,
    async stop() {
      await browser.close();
      await server.close();
    },
  };
}

/**
 * Render every wrapper FRAME on the .fig's first canvas via the
 * harness page and return one PNG per breakpoint. The harness must
 * be running (start it with `startWebglHarness`).
 */
export async function renderFigViewports(
  harness: WebglHarness,
  figBytes: Uint8Array,
  options: { readonly breakpoints?: readonly string[] } = {},
): Promise<readonly FigDirectRenderResult[]> {
  const loaded = await loadFigFile(figBytes);
  const tree = buildNodeTree(loaded.nodeChanges);
  const document = treeToDocument(tree, loaded);
  const wantedBreakpoints = new Set(options.breakpoints ?? ["mobile", "tablet", "desktop"]);

  const wrappers: { breakpoint: string; node: FigDesignNode }[] = [];
  for (const page of document.pages) {
    for (const child of page.children) {
      const breakpoint = parseBreakpointSlug(child.name);
      if (!breakpoint) continue;
      if (!wantedBreakpoints.has(breakpoint)) continue;
      wrappers.push({ breakpoint, node: child });
    }
  }

  // Pre-load every TEXT font referenced anywhere in the wrapper
  // subtrees (and their resolved SYMBOL definitions). The renderer's
  // scene-graph builder asks the resolver synchronously per character
  // run, so all fonts must be in the cache by the time we call
  // `buildSceneGraph`.
  const fontResolver = await buildFontResolver(
    wrappers.map((w) => normalizeRootNode(w.node)),
    document.components,
  );

  const results: FigDirectRenderResult[] = [];
  for (const w of wrappers) {
    const sz = w.node.size;
    if (!sz) {
      throw new Error(`renderFigViewports: wrapper "${w.node.name}" missing size`);
    }
    const width = Math.round(sz.x);
    const height = Math.round(sz.y);
    const sceneGraph = buildSceneGraph([normalizeRootNode(w.node)], {
      blobs: document.blobs,
      images: document.images,
      canvasSize: { width, height },
      viewport: { x: 0, y: 0, width, height },
      symbolMap: document.components,
      styleRegistry: document.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: fontResolver,
    });
    const png = await captureWebgl(harness.page, sceneGraph);
    results.push({ breakpoint: w.breakpoint, png, width, height });
  }
  return results;
}

/**
 * Walk every TEXT (and TEXT inside resolved SYMBOLs) in `roots`,
 * collect the unique `FontQuery`s through the canonical SoT
 * (`collectFontQueries` + `preloadFonts`), and return a
 * `TextFontResolver` that the scene-graph builder can call
 * synchronously per character run.
 *
 * Fallback policy: web-fig-roundtrip is a *verification* harness, not
 * a production rendering path. We bundle `@fontsource/{roboto,
 * noto-sans-jp}` so verifying Japanese / Latin captures does not
 * depend on a particular OS having those installed. The fallback
 * chain (Noto Sans JP first, then Roboto) is declared up front and
 * the SoT preloader logs every substitution — no try/catch swallows.
 */
async function buildFontResolver(
  roots: readonly FigDesignNode[],
  symbolMap: ReadonlyMap<string, FigDesignNode>,
): Promise<TextFontResolver> {
  const { queries } = collectFontQueries({ roots, symbolMap });

  // Two-stage fallback chain:
  //   1. Noto Sans JP — picks up CJK and other Pan-Unicode glyphs
  //      Roboto doesn't carry. The renderer's "no per-character
  //      fallback" policy means a single missing glyph renders as
  //      `.notdef` (tofu); preferring a JP-aware base keeps Japanese
  //      captures legible.
  //   2. Roboto — the renderer's "Missing font" replacement Figma
  //      itself uses. Covers Latin / Cyrillic / Greek.
  const FALLBACK_CJK: FontQuery = { family: "Noto Sans JP", weight: 400, style: "normal" };
  const FALLBACK_LATIN: FontQuery = { family: "Roboto", weight: 400, style: "normal" };

  const loader = createCachingFontLoader(createNodeFontLoaderWithFontsource());
  const result = await preloadFonts({
    queries,
    loader,
    fallbacks: [FALLBACK_CJK, FALLBACK_LATIN],
    // Verifier-side: families bundled via @fontsource that the
    // collector enumerated may not exist (e.g. Roboto for a CJK-only
    // page) and that's tolerable — the fallback chain covers the
    // rendering. Production rendering (figma-svg.ts) does NOT
    // tolerate missing fonts.
    tolerateMissing: false,
  });

  // Resolve the fallback once for lazy queries (fonts referenced from
  // run-level overrides inside SYMBOLs we didn't pre-walk). The
  // preload result already loaded these — pull whichever is present.
  const lazyFallback = await loader.loadFont(FALLBACK_CJK)
    ?? await loader.loadFont(FALLBACK_LATIN);
  if (lazyFallback === undefined) {
    throw new Error(`renderFigViewports: both fallback fonts (Noto Sans JP, Roboto) failed to load — verify @fontsource packages are installed`);
  }

  const cache: ReadonlyMap<string, LoadedFont> = result.cache;
  return (q: FontQuery) => {
    const loaded = cache.get(fontQueryKey(q));
    if (loaded !== undefined) {
      return loaded.font;
    }
    return lazyFallback.font;
  };
}

/**
 * Translate a wrapper FRAME so its top-left lands at (0, 0) — the
 * harness assumes the SceneGraph origin matches the canvas origin.
 */
function normalizeRootNode(node: FigDesignNode): FigDesignNode {
  if (!node.transform) {
    return node;
  }
  return {
    ...node,
    transform: { ...node.transform, m02: 0, m12: 0 },
  };
}

function parseBreakpointSlug(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const head = name.split("/")[0]?.trim();
  return head && head.length > 0 ? head : undefined;
}

/**
 * JSON replacer mirrored from the renderer harness — the SceneGraph
 * embeds binary blobs and image bytes that don't survive a vanilla
 * `JSON.stringify`, so we encode them as `{ __base64: "..." }` and
 * the harness's `restoreUint8Arrays` flips them back.
 */
function uint8ArrayReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __base64: Buffer.from(value).toString("base64") };
  }
  return value;
}

async function captureWebgl(page: Page, sceneGraph: unknown): Promise<Uint8Array> {
  const json = JSON.stringify(sceneGraph, uint8ArrayReplacer);
  const dataUrl = await page.evaluate(async (sgJson: string) => {
    const w = window as unknown as { renderSceneGraph: (json: string) => Promise<string> };
    return await w.renderSceneGraph(sgJson);
  }, json);
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Uint8Array.from(Buffer.from(base64, "base64"));
}
