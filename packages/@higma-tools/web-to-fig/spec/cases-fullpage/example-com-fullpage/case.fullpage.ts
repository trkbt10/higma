/**
 * @file `example-com-fullpage` case spec.
 *
 * Drives a snapshot of example.com's *entire body* end-to-end through
 * the web-to-fig pipeline. Unlike the partial-selector cases under
 * `spec/cases/`, this one feeds the whole page to the normaliser,
 * exercising:
 *
 *   - `liftViewportLayer` against the real `<html>` / `<body>` shell
 *   - `inferAutoLayout` on a tree where the inner card is several
 *     wrapper levels deep below `<body>`
 *   - paragraph collapse on every `<p>` the page renders, not just
 *     the ones inside a hand-picked subtree
 *
 * Auto-skips when the fixture hasn't been extracted locally — see the
 * co-located `extract.sh` for the regeneration command. Auto-skips
 * when Playwright cannot launch.
 */
import { runHtmlCase } from "../../cases/run-html-case";
import { fixtureExists } from "../run-fullpage-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();
const fixtureReady = fixtureExists(FIXTURE_URL);

describe.skipIf(!(playwrightAvailable && fixtureReady))("example-com-fullpage case", () => {
  it("captures, normalises, and emits a `.fig` from the whole body", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://example.com/");
    expect(result.provenance.selector).toBe("body");

    expect(result.ir.box.width).toBe(1280);
    if (result.ir.root.kind !== "frame") {
      throw new Error("expected root frame");
    }
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // Walk the tree and pin the three TEXT nodes example.com renders:
    //   1. `<h1>Example Domain</h1>`
    //   2. `<p>This domain is for use in documentation examples …</p>`
    //   3. `<p><a>Learn more</a></p>` (short link-only paragraph)
    // Pinning all three by characters proves paragraph collapse, link
    // unwrapping, and headline extraction all survive the full-page
    // walk together — losing any one of them would point at a
    // specific regression.
    const texts = collectTexts(result.ir.root);
    expect(texts.some((t) => t.characters === "Example Domain")).toBe(true);
    expect(
      texts.some((t) => t.characters.startsWith("This domain is for use in documentation")),
    ).toBe(true);
    expect(texts.some((t) => t.characters === "Learn more")).toBe(true);

    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 90_000);
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
