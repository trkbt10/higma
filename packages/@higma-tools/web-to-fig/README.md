# @higma-tools/web-to-fig

Capture a live web viewport and emit a `.fig` file. The package is split into three layers:

1. `web-source` — drive Playwright to capture a `RawViewportSnapshot`, or to extract a single-element subtree as a self-contained HTML snippet.
2. `normalize` — translate the snapshot into the shared `@higma-bridges/web-fig` IR.
3. `emit` — materialize the IR as Kiwi `nodeChanges` and export `.fig` bytes via `@higma-document-io/fig`.

The shared IR is the contract that pairs this tool with `@higma-tools/fig-to-web`: any IR `web-to-fig` produces is a valid input for the inverse direction.

## CLI

### `web-to-fig` — URL → `.fig`

End-to-end conversion. Captures the page in a headless Chromium, normalises the snapshot to IR, and writes the bytes to disk.

```sh
bun web-to-fig <url> <out.fig> \
  [--viewport WxH] \
  [--dpr N] \
  [--wait load|domcontentloaded|networkidle] \
  [--timeout MS]
```

Defaults: `--viewport 1280x800`, `--dpr 1`, `--wait networkidle`.

```sh
bun web-to-fig https://example.com/ out.fig --viewport 1280x800 --timeout 30000
```

### `web-to-fig-extract` — URL + selector → standalone HTML snippet

Open a URL in headless Chromium, locate a subtree by CSS selector, and serialise that subtree into a *self-contained* HTML file with every descendant's computed style inlined and every image / mask / `<svg><use>` / `@font-face` URL replaced with a `data:` URL using the bytes the page itself loaded. The result renders independently of the source origin — suitable as a deterministic fixture for the spec runner.

```sh
bun web-to-fig-extract <url> <selector> <out.html> \
  [--viewport WxH] \
  [--dpr N] \
  [--wait load|domcontentloaded|networkidle] \
  [--timeout MS] \
  [--title T] \
  [--wait-for-selector SEL] \
  [--wait-for-selector-timeout MS]
```

Defaults: `--viewport 1280x800`, `--dpr 1`, `--wait domcontentloaded`. By default `--wait-for-selector` is the extraction selector itself, so the most common "wait for the thing I'm extracting to mount" case needs no extra flag.

The selector must match exactly one element — multiple matches throw rather than silently picking the first.

```sh
# Static page — Wikipedia "From today's featured article"
bun web-to-fig-extract \
  "https://en.wikipedia.org/wiki/Main_Page" \
  "#mp-tfa" \
  fixture.html

# SPA — wait for the YouTube top-of-page header to mount
bun web-to-fig-extract \
  "https://www.youtube.com/" \
  "#masthead-container" \
  fixture.html \
  --timeout 60000 \
  --wait-for-selector-timeout 60000
```

The output document stamps the `<body>` with `data-source-url`, `data-selector`, and `data-background` attributes so the case runner (and any downstream tooling) can recover provenance without re-parsing the HTML.

## Programmatic API

### Capture and normalize

```ts
import {
  captureViewport,
  createHostFontResolver,
  normalizeViewport,
  emitFig,
} from "@higma-tools/web-to-fig";

const { snapshot } = await captureViewport({
  url: "https://example.com/",
  viewport: { width: 1280, height: 800 },
});
const ir = normalizeViewport(snapshot, {
  breakpoint: "desktop",
  fontResolver: createHostFontResolver(),
});
const { bytes } = await emitFig(ir);
await Bun.write("example.fig", bytes);
```

`fontResolver` is required — `getComputedStyle().fontFamily` returns a
fallback *stack* (e.g. `"-apple-system, system-ui, ..."`), and the IR
has to carry one concrete family name so the renderer doesn't pick
arbitrary fallbacks with drifting glyph metrics. `createHostFontResolver()`
selects a platform-appropriate implementation (currently macOS via
`system_profiler`); register additional platforms under
`src/font-resolver/`.

### Multi-viewport capture

```ts
import {
  DEFAULT_BREAKPOINTS,
  buildMultiFigFileBytes,
  captureMultiViewport,
  createHostFontResolver,
  normalizeViewport,
} from "@higma-tools/web-to-fig";

const captures = await captureMultiViewport({
  url: "https://example.com/",
  breakpoints: DEFAULT_BREAKPOINTS, // mobile / tablet / desktop
});
const fontResolver = createHostFontResolver();
const viewports = captures.map((cap) =>
  normalizeViewport(cap.result.snapshot, { breakpoint: cap.breakpoint.name, fontResolver }),
);
const built = await buildMultiFigFileBytes({
  source: "https://example.com/",
  viewports,
});
await Bun.write("example.fig", built.bytes);
```

### Extract a standalone HTML snippet

```ts
import { extractElement } from "@higma-tools/web-to-fig";

const result = await extractElement({
  url: "https://en.wikipedia.org/wiki/Main_Page",
  selector: "#mp-tfa",
  viewport: { width: 1280, height: 800 },
  // Optional — default is `selector` itself.
  waitForSelector: "#mp-tfa",
  waitForSelectorTimeoutMs: 30000,
});

await Bun.write("fixture.html", result.html);
console.log(`Inlined ${result.inlinedResources} resources, ${result.inlinedFontFaces} font-faces.`);
```

## Spec cases

The package ships a generic case runner so each test case is a self-contained `fixture.html` plus a co-located `case.spec.ts`. The runner loads the fixture via `file://`, captures it through the same Playwright pipeline a live URL would use, normalises to IR, and emits `.fig` bytes — so the only difference vs a live URL is that the fixture is byte-pinned and offline-deterministic.

Layout:

```
spec/cases/
  run-html-case.ts            # generic runner (runHtmlCase / runHtmlCaseMulti)
  wikipedia-tfa/
    fixture.html              # extracted with `web-to-fig-extract`
    case.spec.ts              # asserts on the IR / .fig output
  youtube-header/
    fixture.html
    case.spec.ts
```

Add a new case:

```sh
# 1. Extract the subtree.
bun web-to-fig-extract \
  "https://example.com/page" \
  ".target-element" \
  packages/@higma-tools/web-to-fig/spec/cases/<name>/fixture.html

# 2. Drop a `case.spec.ts` next to it that calls `runHtmlCase`:
```

```ts
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);
const playwrightAvailable = await canLaunchPlaywright();

describe.runIf(playwrightAvailable)("<name> case", () => {
  it("captures, normalises, and emits a `.fig`", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
    });
    expect(result.figBytes.byteLength).toBeGreaterThan(0);
    // ... case-specific structural assertions on `result.ir` ...
  }, 60_000);
});

async function canLaunchPlaywright(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}
```

The case auto-skips when Playwright isn't installed, so CI environments without Chromium don't break.

## Scratch directory

`./.tmp/` is gitignored and reserved for one-off probes (a pattern matching the AGENTS.md `.tmp` policy). Promote anything worth keeping into a proper case under `spec/cases/<name>/` instead of letting `.tmp.ts` files accumulate.

## Layering and SoT notes

- `web-source/playwright-shared.ts` owns the Playwright launch + response-cache plumbing. Both `capture.ts` and `extract.ts` consume it; never re-implement the response cache or the dynamic `playwright` import elsewhere.
- The capture walker (`web-source/in-page.ts`) and the extractor's serialiser (`web-source/extract.ts`) both run *inside* `page.evaluate`. Helpers used there must be inlined in the function body — Playwright serialises the function into the page context where outer-module bindings are unreachable.
- Visual-fidelity verification lives in `@higma-tools/web-fig-roundtrip` (a same-scope sibling), because it needs to import `@higma-tools/fig-to-web` and same-scope packages cannot import each other directly. `web-to-fig` stays focused on the capture-to-emit half of the pipeline.
