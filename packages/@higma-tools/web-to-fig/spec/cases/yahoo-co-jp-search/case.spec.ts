/**
 * @file `yahoo-co-jp-search` case spec.
 *
 * Drives a byte-pinned snapshot of yahoo.co.jp's top-page search form
 * end-to-end through the web-to-fig pipeline. The form exercises a
 * different mix of CSS than the existing wikipedia / youtube cases:
 *
 *   - inline-flex layout with mixed text + button (`<input type="text">`
 *     beside `<button>`)
 *   - inline `<svg>` icons (search glyph) — the Layer 1 fix for
 *     `emitVector` is exactly what this case regresses against
 *   - Japanese-locale font stack inheritance through nested elements
 *
 * Requires Playwright. Auto-skips when Playwright cannot launch.
 */
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();

describe.skipIf(!playwrightAvailable)("yahoo-co-jp-search case", () => {
  it("captures, normalises, and emits a `.fig` from the search form subtree", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 60_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://www.yahoo.co.jp/");
    expect(result.provenance.selector).toBe("form[action*='search']");

    expect(result.ir.source.startsWith("file://")).toBe(true);
    expect(result.ir.box.width).toBe(1280);
    expect(result.ir.root.kind).toBe("frame");
    if (result.ir.root.kind !== "frame") {
      throw new Error();
    }
    // The search form must surface as at least one child of the
    // synthetic `<body>` root — a single empty frame would mean the
    // extractor lost the subtree or the normaliser dropped every
    // visible child.
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // `.fig` output sanity — non-empty bytes prove the emit pipeline
    // (now exercising the new emitVector path against Yahoo's
    // inline search-glyph SVG) consumed the IR without throwing.
    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 90_000);
});

/**
 * Probe Playwright by attempting a dynamic import. Skips the spec
 * when the optional dependency is not installed (CI on environments
 * without Chromium). Never silently downgrades to a stub.
 */
async function canLaunchPlaywright(): Promise<boolean> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- playwright is an optional runtime dep; static import would force it on every consumer.
    await import("playwright");
    return true;
  } catch (_err: unknown) {
    void _err;
    return false;
  }
}
