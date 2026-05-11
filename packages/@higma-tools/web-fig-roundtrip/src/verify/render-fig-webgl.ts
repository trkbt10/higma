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
    // Yahoo-class pages produce a fig with thousands of TEXT nodes
    // and image patterns. Each scene-graph build still completes in
    // a few seconds, but the default 30s `protocolTimeout` on
    // `Runtime.callFunctionOn` fires before we get a result. Bump
    // to 5 minutes so heavy pages don't bail at the boundary.
    protocolTimeout: 300_000,
  });
  const page = await browser.newPage();
  // Yahoo-class pages run heavy scene-graph builds that can exceed
  // puppeteer's default 30s timeout for `evaluate` / waitForFunction.
  // Bump both the page-level default and the explicit
  // `protocolTimeout` so these stay aligned with the 5-minute
  // launch-option budget set on `puppeteer.launch`.
  page.setDefaultTimeout(300_000);
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
 * A single top-level node selected for rasterisation. Surfaces the
 * (page, frame) coordinates plus the resolved FigDesignNode so
 * callers can compute fingerprints before paying the harness cost.
 */
export type FigFrameTarget = {
  readonly page: string;
  readonly frame: string;
  readonly type: string;
  readonly node: FigDesignNode;
  readonly width: number;
  readonly height: number;
};

/**
 * Output of one streaming rasterisation step. `png`/`width`/`height`
 * carry the rasterised bytes at the requested pixel ratio; the
 * `target` mirrors what `listFigFrameTargets` returned so the
 * consumer can correlate without reindexing.
 */
export type FigFrameRendered = {
  readonly target: FigFrameTarget;
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
};

// The canonical Figma schema has no COMPONENT or COMPONENT_SET
// NodeType; a "Variant Set" is a FRAME (already covered) and a
// "Component" is a SYMBOL (opt-in via `includeSymbols`). See
// `docs/refactor/component-type-cleanup.md`.
const DEFAULT_RASTERISABLE_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
]);

function selectableTypes(includeSymbols: boolean): ReadonlySet<string> {
  return includeSymbols ? new Set([...DEFAULT_RASTERISABLE_TYPES, "SYMBOL"]) : DEFAULT_RASTERISABLE_TYPES;
}

/**
 * Enumerate top-level FRAME / COMPONENT / COMPONENT_SET (and
 * optionally SYMBOL) targets matching the supplied filters. The
 * walk is read-only and harness-free, so callers can use it to
 * compute fingerprints, plan skips, or render a progress bar
 * before opening puppeteer.
 *
 * Why this is a separate entry: the previous one-shot
 * `renderFigFramesByName` API folded discovery + rasterisation
 * together, which forced the harness to start even when every
 * target's fingerprint already matched the on-disk PNG. Splitting
 * discovery out lets callers gate harness startup on whether any
 * actual rasterisation work remains.
 */
export async function listFigFrameTargets(
  figBytes: Uint8Array,
  options: {
    readonly frameNames?: readonly string[];
    readonly pageName?: string;
    readonly includeSymbols?: boolean;
  } = {},
): Promise<readonly FigFrameTarget[]> {
  const document = await createFigDesignDocument(figBytes);
  const wantedNames = options.frameNames ? new Set(options.frameNames) : undefined;
  const rasterisable = selectableTypes(options.includeSymbols === true);
  const out: FigFrameTarget[] = [];
  for (const page of document.pages) {
    if (options.pageName !== undefined && page.name !== options.pageName) {
      continue;
    }
    for (const child of page.children) {
      if (!rasterisable.has(child.type)) {
        continue;
      }
      const name = child.name ?? "";
      if (wantedNames && !wantedNames.has(name)) {
        continue;
      }
      const sz = child.size;
      if (!sz) {
        throw new Error(`listFigFrameTargets: frame "${name}" missing size`);
      }
      out.push({
        page: page.name ?? "",
        frame: name,
        type: child.type,
        node: child,
        width: Math.round(sz.x),
        height: Math.round(sz.y),
      });
    }
  }
  return out;
}

/**
 * Streaming rasterisation: yields one rendered PNG per target in
 * the order they appear in `targets`. The harness is shared across
 * yields — callers own its lifecycle (`startWebglHarness` once,
 * iterate, `harness.stop()` when done), so a multi-frame render
 * pays the puppeteer / Chromium startup cost only once.
 *
 * Yields *after each* `captureWebgl` so an interactive consumer
 * (CLI progress bar, file writer with fingerprint short-circuit)
 * can react incrementally instead of waiting for the full batch.
 *
 * The font resolver is built lazily on first iteration over all
 * yielded targets at once — font collection itself is a
 * full-document walk, so paying for it per-frame would be
 * quadratic.
 */
export async function* streamFigFrames(
  harness: WebglHarness,
  figBytes: Uint8Array,
  targets: readonly FigFrameTarget[],
  options: {
    /**
     * Output pixel ratio. Default 1 (authored size). 2 produces a
     * physical canvas twice the authored size — the renderer
     * paints into the larger buffer and the harness returns a
     * super-sampled PNG.
     */
    readonly pixelRatio?: number;
    /**
     * Canvas background colour, RGBA in 0..1. Default opaque
     * white (matches the legacy fidelity harness). Pass
     * `{r:0, g:0, b:0, a:0}` to preserve transparent regions
     * (rounded card corners, drop-shadow halos) in the
     * exported PNG.
     */
    readonly backgroundColor?: RGBA;
  } = {},
): AsyncGenerator<FigFrameRendered, void, unknown> {
  if (targets.length === 0) {
    return;
  }
  const document = await createFigDesignDocument(figBytes);
  const fontResolver = await buildFontResolver(
    targets.map((t) => normalizeRootNode(t.node)),
    document.components,
  );
  const pixelRatio = options.pixelRatio ?? 1;
  for (const t of targets) {
    const sceneGraph = buildSceneGraph([normalizeRootNode(t.node)], {
      ...figDocumentResources(document),
      canvasSize: { width: t.width, height: t.height },
      viewport: { x: 0, y: 0, width: t.width, height: t.height },
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: fontResolver,
    });
    const png = await captureWebgl(harness.page, sceneGraph, pixelRatio, options.backgroundColor);
    yield {
      target: t,
      png,
      width: Math.round(t.width * pixelRatio),
      height: Math.round(t.height * pixelRatio),
    };
  }
}

/**
 * Backwards-compatible one-shot wrapper around `listFigFrameTargets`
 * + `streamFigFrames`. Kept so existing consumers
 * (fig-to-swiftui's visual round-trip loop) don't have to migrate
 * to the streaming surface. New code should call the two
 * underlying functions directly — that exposes the discovery /
 * fingerprint / harness-lifecycle split.
 *
 * The `frame` field on each result echoes the source name so the
 * caller can correlate by name. Duplicate names round-trip through
 * the result array unchanged.
 */
export async function renderFigFramesByName(
  harness: WebglHarness,
  figBytes: Uint8Array,
  options: {
    readonly frameNames?: readonly string[];
    readonly pageName?: string;
    readonly includeSymbols?: boolean;
    readonly pixelRatio?: number;
  } = {},
): Promise<readonly { readonly frame: string; readonly png: Uint8Array; readonly width: number; readonly height: number }[]> {
  const targets = await listFigFrameTargets(figBytes, {
    frameNames: options.frameNames,
    pageName: options.pageName,
    includeSymbols: options.includeSymbols,
  });
  const results: { frame: string; png: Uint8Array; width: number; height: number }[] = [];
  for await (const r of streamFigFrames(harness, figBytes, targets, { pixelRatio: options.pixelRatio })) {
    results.push({
      frame: r.target.frame,
      png: r.png,
      width: r.width,
      height: r.height,
    });
  }
  return results;
}

/**
 * Render an explicit list of fig nodes (each given as a node-key
 * tuple `${sessionID}:${localID}` plus authored width/height) and
 * return a PNG per node.
 *
 * Unlike `renderFigFramesByName` this entry doesn't filter by
 * `FRAME_LIKE_TYPES` — the caller selects which nodes to rasterise
 * via guid lookup. Used by the fig-to-swiftui complexity-threshold
 * rasteriser to burn down deeply-nested SwiftUI subtrees into
 * single bundle-resource Images.
 *
 * Nodes whose guid isn't present in the document are silently
 * dropped — the caller's plan reflected the live document, so a
 * missing guid means the harness's view of the file diverged
 * (e.g. the file was edited between scoring and rendering). The
 * caller decides whether to retry or accept the gap.
 */
export async function renderFigNodes(
  harness: WebglHarness,
  figBytes: Uint8Array,
  targets: readonly { readonly key: string; readonly width: number; readonly height: number }[],
): Promise<readonly { readonly key: string; readonly png: Uint8Array; readonly width: number; readonly height: number }[]> {
  if (targets.length === 0) {
    return [];
  }
  const document = await createFigDesignDocument(figBytes);
  // Index every node in the document by its FigNodeId
  // (`"sessionID:localID"` string brand). The id field is the SoT
  // identifier on `FigDesignNode` — derived from the raw fig GUID
  // at document construction via `guidToNodeId(node.guid)`. We
  // consume the resolved string directly so this lookup is
  // structurally identical to `document.components`'s key shape,
  // and we never construct the format ourselves.
  const byKey = new Map<string, FigDesignNode>();
  const indexNode = (node: FigDesignNode): void => {
    if (node.id) {
      byKey.set(node.id, node);
    }
    for (const child of node.children ?? []) {
      indexNode(child);
    }
  };
  for (const page of document.pages) {
    for (const child of page.children) {
      indexNode(child);
    }
  }
  // Also index the resolved SYMBOL definitions — INSTANCE-targeted
  // rasterisation needs to find SYMBOLs by guid even though they
  // aren't in `pages.children`.
  for (const sym of document.components.values()) {
    indexNode(sym);
  }
  const resolved: { readonly key: string; readonly node: FigDesignNode; readonly width: number; readonly height: number }[] = [];
  for (const t of targets) {
    const node = byKey.get(t.key);
    if (!node) {
      continue;
    }
    resolved.push({ key: t.key, node, width: t.width, height: t.height });
  }
  if (resolved.length === 0) {
    return [];
  }
  const fontResolver = await buildFontResolver(
    resolved.map((r) => normalizeRootNode(r.node)),
    document.components,
  );
  const out: { key: string; png: Uint8Array; width: number; height: number }[] = [];
  for (const t of resolved) {
    const sceneGraph = buildSceneGraph([normalizeRootNode(t.node)], {
      ...figDocumentResources(document),
      canvasSize: { width: t.width, height: t.height },
      viewport: { x: 0, y: 0, width: t.width, height: t.height },
      showHiddenNodes: false,
      warnings: [],
      textFontResolver: fontResolver,
    });
    const png = await captureWebgl(harness.page, sceneGraph);
    out.push({ key: t.key, png, width: t.width, height: t.height });
  }
  return out;
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

  // The Node loader resolves CSS generic keywords (`system-ui`,
  // `sans-serif`) by walking GENERIC_FONT_STACKS and returning the
  // first family it finds — that's frequently `Roboto` for `system-ui`,
  // and the local `@fontsource/roboto` ships as ~80 unicode-range
  // subsets, only one of which carries the basic Latin block. The
  // loader's closest-weight match picks a subset at random, so a
  // Roboto-resolved query for Latin text often returns a face whose
  // 'E' is glyph 0 (.notdef → tofu). Validate every cached entry
  // against a Latin probe and replace failing entries with Helvetica
  // Neue (system-installed, full Latin block) before the resolver
  // hands them to the renderer.
  const latinProbe = "ABCabc";
  // Lookup table of Helvetica Neue weights/styles as they're
  // requested. When a Roboto subset fails the Latin probe we
  // replace it with the *same weight + style* Helvetica face, not
  // a fixed Regular substitute — otherwise an `<h1>` with
  // `font-weight: 700` would silently render at 400 weight, which
  // is the regression that surfaced via the leaf-up harness on
  // example.com (Source bold heading vs rendered regular).
  const helveticaCache = new Map<string, LoadedFont | undefined>();
  async function helveticaFor(query: FontQuery): Promise<LoadedFont | undefined> {
    const key = `${query.weight}-${query.style}`;
    if (helveticaCache.has(key)) {
      return helveticaCache.get(key);
    }
    const loaded = await loader.loadFont({ family: "Helvetica Neue", weight: query.weight, style: query.style });
    helveticaCache.set(key, loaded);
    return loaded;
  }
  // Pre-load 400/regular for the lazy fallback below.
  const helveticaLatin = await loader.loadFont({ family: "Helvetica Neue", weight: 400, style: "normal" });
  const validatedCache = new Map<string, LoadedFont>();
  for (const query of queries) {
    const key = fontQueryKey(query);
    const loaded = result.cache.get(key);
    if (loaded === undefined) {
      continue;
    }
    if (faceCoversLatin(loaded.font, latinProbe)) {
      validatedCache.set(key, loaded);
      continue;
    }
    const replacement = await helveticaFor(query);
    if (replacement !== undefined) {
      validatedCache.set(key, replacement);
    } else if (helveticaLatin !== undefined) {
      validatedCache.set(key, helveticaLatin);
    }
  }

  // Resolve the fallback once for lazy queries (fonts referenced from
  // run-level overrides inside SYMBOLs we didn't pre-walk). The
  // preload result already loaded these — pull whichever is present.
  const lazyFallback = helveticaLatin
    ?? await loader.loadFont(FALLBACK_CJK)
    ?? await loader.loadFont(FALLBACK_LATIN);
  if (lazyFallback === undefined) {
    throw new Error(`renderFigViewports: no usable fallback font (Helvetica Neue / Noto Sans JP / Roboto) — verify @fontsource packages are installed and macOS system fonts are accessible`);
  }

  const cache: ReadonlyMap<string, LoadedFont> = validatedCache;
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
/**
 * Quick predicate that the loaded face covers basic Latin glyphs.
 * `charToGlyph` returns glyph index 0 (the `.notdef` slot) when the
 * face has no entry for the requested codepoint — `notdef` paints
 * as a tofu rectangle. Walking a short representative probe lets us
 * detect a Roboto subset that lacks the basic Latin block before
 * the renderer hands it to a TEXT node.
 */
function faceCoversLatin(font: LoadedFont["font"], probe: string): boolean {
  for (let i = 0; i < probe.length; i += 1) {
    if (font.charToGlyph(probe[i]!).index === 0) {
      return false;
    }
  }
  return true;
}

async function loadCjkFace(loader: ReturnType<typeof createCachingFontLoader>): Promise<LoadedFont | undefined> {
  const CJK_CANDIDATES: readonly FontQuery[] = [
    // macOS Japanese system fallback. Order matters: Hiragino Sans
    // (W3) is the literal `system-ui` Japanese fallback Chromium
    // uses on macOS for `font-family: sans-serif` Japanese pages.
    // Hiragino Sans GB W3 is the *Simplified Chinese* sibling —
    // valid CJK coverage but glyph shapes diverge for kanji that
    // exist in both. Putting GB last avoids the JP-vs-SC pixel
    // mismatch that surfaced in the leaf-up harness on
    // ja.wikipedia.
    { family: "Hiragino Sans W3", weight: 400, style: "normal" },
    { family: "Hiragino Sans W6", weight: 700, style: "normal" },
    { family: "Hiragino Kaku Gothic ProN W3", weight: 400, style: "normal" },
    { family: "Hiragino Kaku Gothic ProN", weight: 400, style: "normal" },
    { family: "Hiragino Sans GB W3", weight: 400, style: "normal" },
    { family: "Hiragino Sans GB W6", weight: 700, style: "normal" },
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

type RGBA = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

async function captureWebgl(
  page: Page,
  sceneGraph: unknown,
  pixelRatio: number = 1,
  backgroundColor?: RGBA,
): Promise<Uint8Array> {
  const json = JSON.stringify(sceneGraph, uint8ArrayReplacer);
  // Heavy scene-graphs (yahoo / zozo top pages run hundreds of
  // image patterns and thousands of TEXT nodes) need more than the
  // default 30s puppeteer evaluate timeout — bumping the
  // CDP `Runtime.callFunctionOn` timeout via the
  // `Connection.setTransport`-level `protocolTimeout` doesn't
  // propagate cleanly across all puppeteer minor versions, so we
  // also explicitly drive the rendering call via
  // `page.exposeFunction` + `page.waitForFunction` to bypass the
  // `Runtime.callFunctionOn` timeout entirely. The browser-side
  // `renderSceneGraph` now writes its result into a global slot,
  // and the host polls until it lands.
  const slot = `__renderResult_${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    (args: {
      json: string;
      slot: string;
      pixelRatio: number;
      backgroundColor?: RGBA;
    }) => {
      const w = window as unknown as {
        renderSceneGraph: (json: string, pixelRatio?: number, backgroundColor?: RGBA) => Promise<string>;
        [key: string]: unknown;
      };
      w[args.slot] = "pending";
      w.renderSceneGraph(args.json, args.pixelRatio, args.backgroundColor).then((dataUrl) => {
        w[args.slot] = dataUrl;
      }).catch((err: unknown) => {
        w[args.slot] = `__error__:${err instanceof Error ? err.message : String(err)}`;
      });
    },
    { json, slot, pixelRatio, backgroundColor },
  );
  // Wait for the slot to flip from `pending` to a data URL or an
  // `__error__:` payload. `waitForFunction`'s polling timeout uses
  // `setDefaultTimeout` (set to 5 minutes upstream) which is
  // independent of `Runtime.callFunctionOn`'s built-in budget.
  await page.waitForFunction(
    (slotName: string) => {
      const v = (window as unknown as Record<string, unknown>)[slotName];
      return typeof v === "string" && v !== "pending";
    },
    { timeout: 300_000, polling: 250 },
    slot,
  );
  const dataUrl = await page.evaluate((slotName: string) => {
    return (window as unknown as Record<string, unknown>)[slotName] as string;
  }, slot);
  if (dataUrl.startsWith("__error__:")) {
    throw new Error(`captureWebgl: ${dataUrl.slice("__error__:".length)}`);
  }
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Uint8Array.from(Buffer.from(base64, "base64"));
}
