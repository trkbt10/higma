/**
 * @file `github-claude-code-fullpage` case spec.
 *
 * Drives a full-page snapshot of github.com/anthropics/claude-code
 * through the web-to-fig pipeline. The repository home is one of the
 * busiest layouts on github.com:
 *
 *   - GitHub's `<header.AppHeader>` with logo + nav + account chrome
 *   - The repo container header (Watch / Fork / Star, sub-nav tabs)
 *   - File browser + README pane in a CSS-grid two-column layout
 *   - Sidebar with About / Releases / Contributors widgets
 *   - Hundreds of inline `<svg>` octicons across all of the above
 *
 * Auto-skips when the fixture hasn't been extracted locally — see the
 * co-located `extract.sh`. The full-page fixture is gitignored
 * (~94 MB at the time of writing).
 */
import { runHtmlCase } from "../../cases/run-html-case";
import { fixtureExists } from "../run-fullpage-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();
const fixtureReady = fixtureExists(FIXTURE_URL);

describe.skipIf(!(playwrightAvailable && fixtureReady))("github-claude-code-fullpage case", () => {
  it("captures, normalises, and emits a `.fig` from the whole repo body", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 240_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://github.com/anthropics/claude-code");
    expect(result.provenance.selector).toBe("body");

    expect(result.ir.box.width).toBe(1280);
    if (result.ir.root.kind !== "frame") {
      throw new Error("expected root frame");
    }
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // The repo home surfaces a lot of TEXT — repo title, About
    // blurb, file names in the browser, README headings, sidebar
    // links. A full-page run that produced fewer than 30 TEXT
    // nodes would mean wrapper unwrapping or paragraph collapse
    // ate the page.
    const texts = collectTexts(result.ir.root);
    expect(texts.length).toBeGreaterThanOrEqual(30);

    // The repo slug + organisation must reach the IR. GitHub
    // renders these as separate `<a>` chips at the top of the
    // page; pinning both proves the chip + slug path made it
    // through unwrapping.
    const concatenated = texts.map((t) => t.characters).join(" / ");
    expect(/anthropics/.test(concatenated)).toBe(true);
    expect(/claude-code/.test(concatenated)).toBe(true);

    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 300_000);
});

function collectTexts(
  node: import("@higma-bridges/web-fig").NodeIR,
): import("@higma-bridges/web-fig").TextNodeIR[] {
  if (node.kind === "text") {
    return [node];
  }
  if (node.kind !== "frame") {
    return [];
  }
  const out: import("@higma-bridges/web-fig").TextNodeIR[] = [];
  for (const child of node.children) {
    out.push(...collectTexts(child));
  }
  return out;
}

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
