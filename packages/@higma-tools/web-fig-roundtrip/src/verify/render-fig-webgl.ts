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
import { createFigDesignDocument, figDocumentResources } from "@higma-document-io/fig/context";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
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
  // SoT: `createFigDesignDocument` owns the
  // `loadFigFile → buildNodeTree → treeToDocument` orchestration. The
  // verifier consumes `document.components` (already-resolved SYMBOLs)
  // for INSTANCE references rather than building its own raw symbolMap.
  const document = await createFigDesignDocument(figBytes);
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
      ...figDocumentResources(document),
      canvasSize: { width, height },
      viewport: { x: 0, y: 0, width, height },
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
 *
 * CJK substitution: `@fontsource/noto-sans-jp` is shipped as ~1100
 * unicode-range subsets, each holding a few hundred glyphs. The Node
 * loader treats every subset as a separate face indexed under
 * "Noto Sans JP" and picks one by closest-weight match — but a
 * single subset only covers a tiny slice of CJK code points, so most
 * glyphs miss and render as `.notdef` (tofu). When the rendered
 * document carries any CJK character, we therefore prefer a system
 * CJK face (Hiragino Sans on macOS, Noto Sans CJK on Linux) which
 * carries the full glyph repertoire in one file. The override
 * happens at resolver level — every `FontQuery` (regardless of the
 * page-declared family) returns the CJK face, so a captured
 * `font-family: "sans-serif"` doesn't silently route through
 * `Helvetica Neue` (which the SANS_SERIF_STACK cascade picks first
 * but which lacks CJK glyphs).
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

  const cjkFace = documentHasCjk(roots, symbolMap)
    ? await loadCjkFace(loader)
    : undefined;
  if (cjkFace !== undefined) {
    return () => cjkFace.font;
  }

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
 * Try a small list of system CJK families in priority order and
 * return the first one whose loaded face actually paints the test
 * glyph 「日」 with a non-`.notdef` outline. Each candidate must be
 * wide enough that *every* CJK glyph the captured page carries
 * resolves to a real outline — the renderer has no per-character
 * fallback, so a partial-coverage face would still produce tofu.
 *
 * Why the glyph probe matters: the Node font loader's
 * `resolveVariants` cascades through the SANS_SERIF_STACK when a
 * family isn't directly indexed, so a query for "Hiragino Sans"
 * (which the macOS index does NOT carry under that exact name —
 * only "Hiragino Sans GB W3" / "W6") returns Helvetica Neue, whose
 * 「日」 glyph index is 0 (.notdef). Picking it as the CJK face
 * silently re-introduces tofu. The probe filters those out.
 */
async function loadCjkFace(loader: ReturnType<typeof createCachingFontLoader>): Promise<LoadedFont | undefined> {
  const CJK_CANDIDATES: readonly FontQuery[] = [
    // macOS — Hiragino is indexed by the loader as "Hiragino Sans GB
    // W3" / "W6" (the embedded family name carries the weight token).
    { family: "Hiragino Sans GB W3", weight: 400, style: "normal" },
    { family: "Hiragino Sans GB W6", weight: 700, style: "normal" },
    { family: "Hiragino Kaku Gothic ProN", weight: 400, style: "normal" },
    // Linux distributions that ship Noto CJK as a single TTC.
    { family: "Noto Sans CJK JP", weight: 400, style: "normal" },
    { family: "Noto Sans CJK", weight: 400, style: "normal" },
    // Windows.
    { family: "Yu Gothic", weight: 400, style: "normal" },
    { family: "Meiryo", weight: 400, style: "normal" },
    { family: "MS Gothic", weight: 400, style: "normal" },
  ];
  for (const candidate of CJK_CANDIDATES) {
    const loaded = await loader.loadFont(candidate);
    if (loaded === undefined) {
      continue;
    }
    if (loaded.font.charToGlyph("日").index !== 0) {
      return loaded;
    }
  }
  return undefined;
}

/**
 * Detect whether any TEXT character in `roots` (or in the SYMBOLs
 * `roots` reference) lies in a Unicode block CJK fonts traditionally
 * cover. Detection is conservative: we check the most common JP / CN
 * / KR / kana / Hangul ranges plus the CJK Symbols and Punctuation
 * block, which catches the half-width / full-width punctuation that
 * Latin fonts often miss too. A single hit anywhere in the document
 * flips the resolver into CJK-priority mode for the whole render.
 */
function documentHasCjk(
  roots: readonly FigDesignNode[],
  symbolMap: ReadonlyMap<string, FigDesignNode>,
): boolean {
  const visited = new Set<string>();
  function walk(node: FigDesignNode | undefined): boolean {
    if (!node) {
      return false;
    }
    const text = node.textData?.characters;
    if (text !== undefined && hasCjkChar(text)) {
      return true;
    }
    const symbolId = node.symbolId;
    if (symbolId !== undefined && !visited.has(symbolId)) {
      visited.add(symbolId);
      const target = symbolMap.get(symbolId);
      if (target !== undefined && walk(target)) {
        return true;
      }
    }
    for (const child of node.children ?? []) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  }
  for (const root of roots) {
    if (walk(root)) {
      return true;
    }
  }
  return false;
}

function hasCjkChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    // CJK Unified Ideographs.
    if (code >= 0x4e00 && code <= 0x9fff) {
      return true;
    }
    // Hiragana, Katakana, Katakana phonetic extensions.
    if (code >= 0x3040 && code <= 0x30ff) {
      return true;
    }
    if (code >= 0x31f0 && code <= 0x31ff) {
      return true;
    }
    // Hangul syllables.
    if (code >= 0xac00 && code <= 0xd7af) {
      return true;
    }
    // CJK Symbols and Punctuation.
    if (code >= 0x3000 && code <= 0x303f) {
      return true;
    }
    // Halfwidth and Fullwidth Forms (covers Japanese full-width Latin).
    if (code >= 0xff00 && code <= 0xffef) {
      return true;
    }
    // CJK Unified Ideographs Extension A.
    if (code >= 0x3400 && code <= 0x4dbf) {
      return true;
    }
  }
  return false;
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
