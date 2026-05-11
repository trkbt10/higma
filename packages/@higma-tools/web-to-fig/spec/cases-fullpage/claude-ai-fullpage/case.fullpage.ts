/**
 * @file `claude-ai-fullpage` case spec.
 *
 * Drives a full-page snapshot of claude.ai through the web-to-fig
 * pipeline. claude.ai is a Next.js SPA whose un-authenticated entry
 * is mostly a server-rendered shell that hydrates into the chat
 * surface — the captured body is small but stresses:
 *
 *   - Tailwind utility-class soup with custom-property colour tokens
 *   - SPA hydration boundaries (the inferer must keep the layout
 *     stable even though the rendered DOM is sparse compared to a
 *     content site)
 *   - Inline `<svg>` for the Anthropic mark and any glyphs the
 *     login chrome ships
 *
 * Auto-skips when the fixture hasn't been extracted locally — see the
 * co-located `extract.sh`. The full-page fixture is gitignored.
 */
import { runHtmlCase } from "../../cases/run-html-case";
import { fixtureExists } from "../run-fullpage-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();
const fixtureReady = fixtureExists(FIXTURE_URL);

describe.skipIf(!(playwrightAvailable && fixtureReady))("claude-ai-fullpage case", () => {
  it("captures, normalises, and emits a `.fig` from the whole body", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 60_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://claude.ai/");
    expect(result.provenance.selector).toBe("body");

    expect(result.ir.box.width).toBe(1280);
    if (result.ir.root.kind !== "frame") {
      throw new Error("expected root frame");
    }
    // The SPA shell is sparse but must surface at least something —
    // the Next.js root container under `<body>`. A zero-children
    // result would mean either the extractor stripped the
    // hydration shell or the normaliser dropped every visible
    // node from a SPA tree.
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 90_000);
});

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
