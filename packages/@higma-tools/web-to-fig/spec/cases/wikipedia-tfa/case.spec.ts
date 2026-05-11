/**
 * @file `wikipedia-tfa` case spec.
 *
 * Drives the standalone `fixture.html` (extracted from
 * `https://en.wikipedia.org/wiki/Main_Page`'s `#mp-tfa` subtree) end-
 * to-end through the web-to-fig pipeline. The fixture is byte-pinned
 * inside the repo so the spec is deterministic across captures of the
 * actual Wikipedia page (which changes daily as the TFA rotates).
 *
 * Requires Playwright. The spec auto-skips when Playwright cannot
 * launch — the same coverage is exercised by the higher-level
 * roundtrip spec when running locally with browsers installed.
 */
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();

describe.skipIf(!playwrightAvailable)("wikipedia-tfa case", () => {
  it("captures, normalises, and emits a `.fig` from the standalone snippet", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://en.wikipedia.org/wiki/Main_Page");
    expect(result.provenance.selector).toBe("#mp-tfa");

    expect(result.ir.source.startsWith("file://")).toBe(true);
    expect(result.ir.box.width).toBe(1280);
    expect(result.ir.root.kind).toBe("frame");
    if (result.ir.root.kind !== "frame") {
      throw new Error();
    }
    // The root frame wraps `<body>` which contains the extracted
    // subtree. Both must be present — a fixture that flattened to a
    // single empty frame would mean either the extractor lost the
    // subtree or the normaliser dropped every visible child.
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // The extractor inlines the TFA's lead image as a data URL, so
    // the IR must carry at least one image asset for the snippet to
    // claim parity with the live page.
    expect(result.ir.assets.size).toBeGreaterThan(0);

    // `.fig` output sanity — non-empty bytes prove the emit pipeline
    // consumed the IR without throwing.
    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 60_000);
});

/**
 * Probe Playwright by attempting a dynamic import. Skips the spec
 * when the optional dependency is not installed (CI on environments
 * without Chromium). We never silently downgrade to a stub — either
 * the browser runs the case or the case is reported as skipped.
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
