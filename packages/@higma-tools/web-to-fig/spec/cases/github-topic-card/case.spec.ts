/**
 * @file `github-topic-card` case spec.
 *
 * Drives a byte-pinned snapshot of github.com/topics/typescript's
 * first repo `<article>` card. The card exercises CSS shape
 * different from the existing wikipedia / youtube / yahoo cases:
 *
 *   - Primer CSS utility classes (small, dense rule churn)
 *   - SVG icon glyphs inline with `<a>` chrome (star / fork buttons)
 *   - Long body text mixed with short metadata pills, paragraph hosts
 *     spanning text + link + text again (typical README excerpt)
 *
 * Requires Playwright. Auto-skips when Playwright cannot launch.
 */
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();

describe.skipIf(!playwrightAvailable)("github-topic-card case", () => {
  it("captures, normalises, and emits a `.fig` from the article card", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 90_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://github.com/topics/typescript");
    expect(result.provenance.selector).toBe("article:first-of-type");

    expect(result.ir.source.startsWith("file://")).toBe(true);
    expect(result.ir.box.width).toBe(1280);
    expect(result.ir.root.kind).toBe("frame");
    if (result.ir.root.kind !== "frame") {
      throw new Error();
    }
    // The captured `<article>` must surface as at least one child of
    // the synthetic `<body>` root — a single empty frame would mean
    // the extractor lost the subtree or the normaliser dropped every
    // visible child.
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // `.fig` output sanity — non-empty bytes prove the emit pipeline
    // (now exercising the new emitVector path against Primer's
    // inline icons) consumed the IR without throwing.
    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 120_000);
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
