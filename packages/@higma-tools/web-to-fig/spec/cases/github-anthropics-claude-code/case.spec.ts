/**
 * @file `github-anthropics-claude-code` case spec.
 *
 * Drives a byte-pinned snapshot of github.com/anthropics/claude-code's
 * repository header (`#repository-container-header`) end-to-end
 * through the web-to-fig pipeline. The repo header is a denser CSS
 * shape than the existing `github-topic-card` case:
 *
 *   - Multi-row Primer header: owner avatar, repo title, action
 *     buttons (Watch / Fork / Star), then a sub-nav row with tabs
 *   - Inline SVGs for every action button glyph (octicons) — heavy
 *     pressure on the new `emitVector` path
 *   - Sticky offsets on the sub-nav (`position: sticky` + `top` —
 *     not `fixed`, so the static-flow normaliser keeps it inline)
 *
 * Requires Playwright. Auto-skips when Playwright cannot launch.
 */
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();

describe.skipIf(!playwrightAvailable)("github-anthropics-claude-code case", () => {
  it("captures, normalises, and emits a `.fig` from the repo header", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 90_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://github.com/anthropics/claude-code");
    expect(result.provenance.selector).toBe("#repository-container-header");

    expect(result.ir.source.startsWith("file://")).toBe(true);
    expect(result.ir.box.width).toBe(1280);
    expect(result.ir.root.kind).toBe("frame");
    if (result.ir.root.kind !== "frame") {
      throw new Error();
    }
    // The repo header must surface as at least one child of the
    // synthetic `<body>` root.
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // `.fig` output sanity — non-empty bytes prove the emit pipeline
    // consumed the IR (with all the octicon vectors) without
    // throwing.
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
