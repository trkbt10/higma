/**
 * @file `claude-ai-landing` case spec.
 *
 * Drives a byte-pinned snapshot of claude.ai's landing page (the
 * unauthenticated entry that funnels into the login flow). claude.ai
 * is a Next.js SPA whose first paint is a server-rendered shell with
 * a Tailwind utility-class soup; capturing it covers a different mix
 * of CSS than the existing wikipedia / yahoo / github cases:
 *
 *   - Tailwind preflight resets layered against per-component
 *     overrides — many `display: flex` containers with no explicit
 *     direction (the inferer is the only signal turning them into
 *     auto-layout)
 *   - CSS custom properties for colour tokens (the `--token` →
 *     resolved-rgb path through `getComputedStyle`)
 *   - Font-face declarations served via Next/font with hashed URLs
 *
 * Requires Playwright. Auto-skips when Playwright cannot launch.
 */
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();

describe.skipIf(!playwrightAvailable)("claude-ai-landing case", () => {
  it("captures, normalises, and emits a `.fig` from the landing shell", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 60_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://claude.ai/");
    expect(result.provenance.selector).toBe("body");

    expect(result.ir.source.startsWith("file://")).toBe(true);
    expect(result.ir.box.width).toBe(1280);
    expect(result.ir.root.kind).toBe("frame");
    if (result.ir.root.kind !== "frame") {
      throw new Error();
    }
    // The landing shell must surface as at least one child of the
    // synthetic `<body>` root — a single empty frame would mean the
    // extractor lost the subtree or the normaliser dropped every
    // visible child.
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // `.fig` output sanity — non-empty bytes prove the emit pipeline
    // (now exercising emitVector against any inline SVG glyphs the
    // login shell ships) consumed the IR without throwing.
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
