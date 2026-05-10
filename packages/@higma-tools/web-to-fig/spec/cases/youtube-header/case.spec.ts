/**
 * @file `youtube-header` case spec.
 *
 * Drives the standalone `fixture.html` (extracted from
 * `https://www.youtube.com/`'s `#masthead-container` subtree — the
 * top-of-page horizontal header containing the YouTube logo, search
 * bar, and account icons) end-to-end through the web-to-fig pipeline.
 *
 * The fixture is byte-pinned in the repo so the spec is deterministic
 * across captures of the live YouTube page (which mutates frequently
 * with rotating banners, A/B-tested controls, etc.).
 *
 * YouTube's masthead exercises a different mix of CSS than the
 * Wikipedia TFA case:
 *   - Polymer / `<ytd-*>` custom elements with shadow-DOM children
 *   - SVG icon assets (search, bell, account) injected via `<yt-icon>`
 *     hosts at runtime
 *   - Multi-column inline-flex layout instead of paragraph-heavy text
 *
 * Requires Playwright. The spec auto-skips when Playwright cannot
 * launch.
 */
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();

describe.runIf(playwrightAvailable)("youtube-header case", () => {
  it("captures, normalises, and emits a `.fig` from the masthead snippet", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
    });

    expect(result.provenance.sourceUrl).toBe("https://www.youtube.com/");
    expect(result.provenance.selector).toBe("#masthead-container");

    expect(result.ir.source.startsWith("file://")).toBe(true);
    expect(result.ir.box.width).toBe(1280);
    expect(result.ir.root.kind).toBe("frame");
    if (result.ir.root.kind !== "frame") {
      throw new Error();
    }

    // The captured masthead is `position: fixed`, so the
    // normaliser lifts the entire subtree out of the static tree
    // into `viewportLayer` (where viewport-anchored paint lives).
    // The static root keeps the `<html>`/`<body>` shell only — the
    // masthead's geometry surfaces through the lifted entry instead.
    expect(result.ir.viewportLayer.length).toBe(1);
    const lifted = result.ir.viewportLayer[0]!;
    expect(lifted.box.width).toBe(1280);
    expect(lifted.box.height).toBe(56);
    expect(lifted.kind).toBe("frame");
    if (lifted.kind !== "frame") {
      throw new Error();
    }
    // The masthead carries the YouTube logo, search bar, and
    // account icons — that's at least a handful of children deep
    // before any flattening. A single empty child would mean the
    // normaliser dropped the whole subtree.
    expect(lifted.children.length).toBeGreaterThan(0);

    // `.fig` output sanity — non-empty bytes prove the emit pipeline
    // consumed the IR without throwing on Polymer-flavoured DOM.
    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 60_000);
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
