/**
 * @file `wikipedia-fullpage` case spec.
 *
 * Drives a full-page snapshot of an English Wikipedia article through
 * the web-to-fig pipeline. A long-form article exercises:
 *
 *   - paragraph collapse on dozens of `<p>` blocks back-to-back, with
 *     rich inline runs (`<a>`, `<b>`, `<sup>`, `<cite>`)
 *   - list items (`<ul>` / `<ol>`) at multiple nesting levels
 *   - the lead `<table.infobox>` plus the article's body in the same
 *     normaliser pass — verifying that table layout doesn't bleed
 *     into the surrounding flow
 *   - the sidebar nav (Wikipedia's left rail) which is `position:
 *     sticky`, exercising a different lift path than `position: fixed`
 *
 * The article chosen is `Web_browser` — high lexical density, modest
 * image count, stable structure. Auto-skips when the fixture hasn't
 * been extracted locally (see `extract.sh`). Auto-skips when
 * Playwright cannot launch.
 */
import { runHtmlCase } from "../../cases/run-html-case";
import { fixtureExists } from "../run-fullpage-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();
const fixtureReady = fixtureExists(FIXTURE_URL);

describe.skipIf(!(playwrightAvailable && fixtureReady))("wikipedia-fullpage case", () => {
  it("captures, normalises, and emits a `.fig` from the whole article body", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 180_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://en.wikipedia.org/wiki/Web_browser");
    expect(result.provenance.selector).toBe("body");

    expect(result.ir.box.width).toBe(1280);
    if (result.ir.root.kind !== "frame") {
      throw new Error("expected root frame");
    }
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // A long-form article must surface dozens of TEXT nodes (lead
    // paragraph, sections, infobox rows, navbox links). Anything
    // less than 50 means paragraph collapse swallowed the body or
    // wrapper unwrapping flattened the article subtree away.
    const texts = collectTexts(result.ir.root);
    expect(texts.length).toBeGreaterThanOrEqual(50);

    // The article title must reach the IR verbatim — a strong
    // regression assertion against the lead-paragraph + infobox
    // collapse paths.
    expect(texts.some((t) => t.characters === "Web browser")).toBe(true);

    // The article body must reach the IR — pin one prefix from the
    // canonical first sentence so a regression in lead-paragraph
    // detection or `<p>` host promotion surfaces here.
    expect(
      texts.some((t) => /\bA web browser\b/.test(t.characters)),
    ).toBe(true);

    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 240_000);
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
