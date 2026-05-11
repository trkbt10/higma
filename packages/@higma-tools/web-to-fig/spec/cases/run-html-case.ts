/**
 * @file Generic HTML-fixture case runner.
 *
 * The web-to-fig pipeline used to be exercised end-to-end only against
 * live URLs (yahoo.co.jp / wikipedia / zozo / ...). Live capture
 * conflates "is the source page deterministic today?" with "does the
 * pipeline correctly translate this CSS shape?", and the CSS shape we
 * actually want to regress on is just the subtree under whichever
 * selector we've extracted. This runner inverts that: each case
 * directory ships a self-contained `fixture.html` (the output of
 * `bun web-to-fig-extract <url> <selector> fixture.html`), and the
 * runner walks that fixture through `captureViewport` →
 * `normalizeViewport` → `emitFig`, returning the IR + bytes for the
 * case's spec to assert on.
 *
 * The fixture is loaded via `file://` so Playwright still brokers all
 * the capture machinery (computed-style read, image / mask asset
 * decode, paragraph wrap detection, …) — we never hand-roll a parser
 * to read the HTML directly. Capture stays the SoT for "what does the
 * normaliser see"; the only difference vs a live URL is that the
 * fixture is byte-pinned and offline-deterministic.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  type CaptureResult,
  buildMultiFigFileBytes,
  captureViewportInBrowser,
  emitFig,
  normalizeViewport,
} from "@higma-tools/web-to-fig";
import type { ViewportIR } from "@higma-bridges/web-fig";
import type { FontResolver } from "@higma-tools/web-to-fig/normalize";
import { sharedBrowser } from "../playwright-pool";
import { staticFontResolver } from "../test-font-resolver";

export type RunHtmlCaseOptions = {
  /**
   * Path (or `file://` URL) to the case's `fixture.html`. Relative
   * paths resolve against `import.meta.url` of the spec — pass
   * `new URL("./fixture.html", import.meta.url)` from a co-located
   * spec for the most ergonomic call site.
   */
  readonly fixture: string | URL;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly devicePixelRatio?: number;
  /**
   * `domcontentloaded` is the right default for offline fixtures —
   * everything is inlined as data URLs so there are no in-flight
   * network responses to wait for past DCL.
   */
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle";
  readonly timeoutMs?: number;
  readonly captureScreenshot?: boolean;
  /**
   * Stable label to embed as the IR's breakpoint. Defaults to
   * `"default"` to match `normalizeViewport`'s own default.
   */
  readonly breakpoint?: string;
  /**
   * Optional path (or `file://` URL) to write the produced `.fig`
   * bytes to after a successful run. Co-locating it next to the
   * fixture (`new URL("./snapshot.fig", import.meta.url)`) lets a
   * developer open the `.fig` in Figma to visually inspect what the
   * pipeline produced for this fixture. Skip the option (default)
   * for a memory-only run.
   */
  readonly dumpFigTo?: string | URL;
  /**
   * FontResolver used when translating captured `font-family` values
   * into the IR. Defaults to `staticFontResolver()` (returns the
   * placeholder `"Test Sans"`) so HTML-fixture cases that don't
   * exercise font fidelity stay deterministic across OSes. A case
   * that needs a real OS-installed font (the cases-fullpage diff
   * loop, in particular) passes its own resolver — typically the
   * darwin or in-page one wired up at the runner boundary.
   */
  readonly fontResolver?: FontResolver;
};

export type RunHtmlCaseResult = {
  /** Raw Playwright capture (snapshot + optional screenshot bytes). */
  readonly capture: CaptureResult;
  /** ViewportIR produced from the captured snapshot. */
  readonly ir: ViewportIR;
  /** `.fig` bytes for the single-viewport multi-fig wrapper. */
  readonly figBytes: Uint8Array;
  /** Provenance metadata stamped onto the fixture by the extractor. */
  readonly provenance: FixtureProvenance;
};

/**
 * Provenance attributes the extractor stores on `<body>` so the case
 * runner (and downstream tooling) can correlate the fixture with the
 * URL / selector it came from. Optional because hand-built fixtures
 * may omit them — the runner refuses to make up values it cannot
 * read.
 */
export type FixtureProvenance = {
  readonly sourceUrl: string | undefined;
  readonly selector: string | undefined;
  readonly background: string | undefined;
};

/**
 * Run a single HTML-fixture case through capture → normalize → emit.
 *
 * Throws on missing files, capture failures, or normalisation errors —
 * the spec layer is expected to catch and assert on them. The runner
 * deliberately does not pixel-diff or render: that's the job of
 * `@higma-tools/web-fig-roundtrip`'s verifyFigDirect, which can layer
 * on top of this result by treating the returned `figBytes` as input.
 */
export async function runHtmlCase(options: RunHtmlCaseOptions): Promise<RunHtmlCaseResult> {
  const fixtureUrl = toFileUrl(options.fixture);
  const provenance = await readFixtureProvenance(fixtureUrl);
  // Reuse the suite's shared chromium instead of launching a fresh
  // browser per call. Every spec still gets its own browser context
  // (Playwright guarantees context isolation), but the
  // chromium.launch/close churn that used to make wikipedia-class
  // captures flaky in bun-test parallel scheduling goes away.
  const browser = await sharedBrowser();
  const capture = await captureViewportInBrowser(browser, {
    url: fixtureUrl.href,
    viewport: options.viewport,
    devicePixelRatio: options.devicePixelRatio,
    waitUntil: options.waitUntil ?? "domcontentloaded",
    timeoutMs: options.timeoutMs,
    captureScreenshot: options.captureScreenshot,
  });
  const ir = normalizeViewport(capture.snapshot, {
    breakpoint: options.breakpoint ?? "default",
    fontResolver: options.fontResolver ?? staticFontResolver(),
  });
  const figBytes = (await emitFig(ir)).bytes;
  if (options.dumpFigTo !== undefined) {
    const dumpPath = fileURLToPath(toFileUrl(options.dumpFigTo));
    await writeFile(dumpPath, figBytes);
  }
  return { capture, ir, figBytes, provenance };
}

/**
 * Build a multi-viewport `.fig` from several breakpoints' captures of
 * the same fixture. Wraps `runHtmlCase` per breakpoint and packages
 * the resulting IRs through `buildMultiFigFileBytes`. Use when the
 * case is testing responsive layout behaviour rather than a single
 * viewport's rendering.
 */
export async function runHtmlCaseMulti(
  options: { readonly fixture: string | URL } & {
    readonly breakpoints: readonly { readonly name: string; readonly width: number; readonly height: number; readonly devicePixelRatio?: number }[];
    readonly waitUntil?: RunHtmlCaseOptions["waitUntil"];
    readonly timeoutMs?: number;
    readonly captureScreenshot?: boolean;
    readonly fontResolver?: FontResolver;
  },
): Promise<{ readonly captures: readonly { readonly breakpoint: string; readonly capture: CaptureResult; readonly ir: ViewportIR }[]; readonly figBytes: Uint8Array; readonly provenance: FixtureProvenance }> {
  const fixtureUrl = toFileUrl(options.fixture);
  const provenance = await readFixtureProvenance(fixtureUrl);
  const browser = await sharedBrowser();
  const captures: { breakpoint: string; capture: CaptureResult; ir: ViewportIR }[] = [];
  const fontResolver = options.fontResolver ?? staticFontResolver();
  for (const bp of options.breakpoints) {
    const capture = await captureViewportInBrowser(browser, {
      url: fixtureUrl.href,
      viewport: { width: bp.width, height: bp.height },
      devicePixelRatio: bp.devicePixelRatio ?? 1,
      waitUntil: options.waitUntil ?? "domcontentloaded",
      timeoutMs: options.timeoutMs,
      captureScreenshot: options.captureScreenshot,
    });
    const ir = normalizeViewport(capture.snapshot, { breakpoint: bp.name, fontResolver });
    captures.push({ breakpoint: bp.name, capture, ir });
  }
  const built = await buildMultiFigFileBytes({
    source: fixtureUrl.href,
    viewports: captures.map((c) => c.ir),
  });
  return { captures, figBytes: built.bytes, provenance };
}

function toFileUrl(input: string | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (input.startsWith("file://")) {
    return new URL(input);
  }
  const absolute = isAbsolute(input) ? input : resolve(process.cwd(), input);
  return pathToFileURL(absolute);
}

/**
 * Pull `data-source-url`, `data-selector`, and `data-background` from
 * `<body ...>` of the fixture. The extractor stamps these so a fixture
 * inspected on its own carries the URL / selector that produced it.
 *
 * Hand-rolled `String#match` instead of a full HTML parser because
 * the attributes are stamped on the `<body>` tag with a fixed format
 * (extractor-controlled), and pulling in a parser dependency for
 * three attributes would be over-engineering for the goal.
 */
async function readFixtureProvenance(fixtureUrl: URL): Promise<FixtureProvenance> {
  const path = fileURLToPath(fixtureUrl);
  const html = await readFile(path, "utf8");
  return {
    sourceUrl: pickAttribute(html, "data-source-url"),
    selector: pickAttribute(html, "data-selector"),
    background: pickAttribute(html, "data-background"),
  };
}

function pickAttribute(html: string, attr: string): string | undefined {
  // Match the `<body ...>` open tag honouring quoted attribute values.
  // A naïve `<body[^>]*>` pattern bails out on the first `>` it sees,
  // which is wrong for fixtures whose `data-selector` legitimately
  // contains `>` (e.g. `data-selector="body > div:first-of-type"`).
  // Returning `undefined` (rather than throwing) when the attribute is
  // missing lets hand-rolled fixtures coexist with extractor-built ones.
  const bodyTag = sliceBodyOpenTag(html);
  if (bodyTag === undefined) {
    return undefined;
  }
  const attrMatch = bodyTag.match(new RegExp(`\\s${attr}="([^"]*)"`));
  if (attrMatch === null) {
    return undefined;
  }
  return decodeAttributeEntities(attrMatch[1]!);
}

/**
 * Slice the `<body ...>` open tag out of `html`, treating `'…'` and
 * `"…"` regions as opaque so quoted attribute values (which may
 * legitimately contain `>`) don't cause an early terminator.
 */
function sliceBodyOpenTag(html: string): string | undefined {
  const start = html.search(/<body\b/i);
  if (start === -1) {
    return undefined;
  }
  let i = start + 5;
  let quote: '"' | "'" | undefined;
  while (i < html.length) {
    const ch = html[i]!;
    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return html.slice(start, i + 1);
    }
    i += 1;
  }
  return undefined;
}

function decodeAttributeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

