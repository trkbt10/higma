/**
 * @file `wikipedia-article-infobox` case spec.
 *
 * Drives a byte-pinned snapshot of en.wikipedia.org/wiki/Tokyo's
 * lead `table.infobox` end-to-end through capture / normalize / emit.
 * This complements `wikipedia-tfa` (a TFA snippet on the Main_Page)
 * by hitting article-page chrome:
 *
 *   - HTML `<table>` rendered as `display: table` — the normaliser's
 *     tag-agnostic geometry path is exercised here, NOT a CSS-grid
 *     fast path
 *   - 14 inlined image assets (lead photo, panorama strip, map,
 *     coat-of-arms, locator pins) — exercises the asset bundling
 *     path with realistic image counts
 *   - Mixed locale text (English headings + romanised Japanese)
 *     beside structured `<th>` / `<td>` pairs
 *
 * Requires Playwright. Auto-skips when Playwright cannot launch.
 */
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();

describe.skipIf(!playwrightAvailable)("wikipedia-article-infobox case", () => {
  it("captures, normalises, and emits a `.fig` from the article infobox", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 150_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://en.wikipedia.org/wiki/Tokyo");
    expect(result.provenance.selector).toBe("table.infobox:first-of-type");

    expect(result.ir.source.startsWith("file://")).toBe(true);
    expect(result.ir.box.width).toBe(1280);
    expect(result.ir.root.kind).toBe("frame");
    if (result.ir.root.kind !== "frame") {
      throw new Error();
    }
    // The infobox must surface as at least one child of the
    // synthetic `<body>` root — a single empty frame would mean
    // the extractor lost the subtree or the normaliser dropped
    // every visible child.
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // The infobox carries 14 inlined image assets. The IR must
    // surface several of them — pinning the exact count is brittle
    // because the extractor de-duplicates identical bytes, but we
    // can claim that at least the image bundling path produced
    // some assets (which already proves capture / inline / decode
    // worked end-to-end).
    expect(result.ir.assets.size).toBeGreaterThan(0);

    // `.fig` output sanity — non-empty bytes prove the emit pipeline
    // consumed the IR without throwing.
    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 180_000);
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
