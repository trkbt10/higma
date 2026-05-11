/**
 * @file `yahoo-co-jp-fullpage` case spec.
 *
 * Drives a full-page snapshot of yahoo.co.jp through the web-to-fig
 * pipeline. Yahoo Japan's home page is dense:
 *
 *   - several hundred TEXT nodes (news headlines, ranking, weather,
 *     stock tickers) on one viewport
 *   - heavy CSS Grid / flex mix; the inferer must pick row vs column
 *     correctly across the full nesting depth
 *   - many inline `<svg>` icons (search, mail, weather, AI assistant)
 *     forcing emitVector through the entire tree
 *
 * Auto-skips when the fixture hasn't been extracted locally — see the
 * co-located `extract.sh`. The full-page fixture is gitignored
 * because Yahoo's home page rotates content daily and the captured
 * snapshot weighs ~20 MB.
 */
import { runHtmlCase } from "../../cases/run-html-case";
import { fixtureExists } from "../run-fullpage-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();
const fixtureReady = fixtureExists(FIXTURE_URL);

describe.skipIf(!(playwrightAvailable && fixtureReady))("yahoo-co-jp-fullpage case", () => {
  it("captures, normalises, and emits a `.fig` from the whole body", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      timeoutMs: 120_000,
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://www.yahoo.co.jp/");
    expect(result.provenance.selector).toBe("body");

    expect(result.ir.box.width).toBe(1280);
    if (result.ir.root.kind !== "frame") {
      throw new Error("expected root frame");
    }
    expect(result.ir.root.children.length).toBeGreaterThan(0);

    // Yahoo's home page surfaces dozens of TEXT nodes — news
    // headlines, ranking, top stories, weather. A full-page
    // pipeline that lost any of those would mean paragraph
    // collapse or descend-and-flatten regressed badly.
    const texts = collectTexts(result.ir.root);
    expect(texts.length).toBeGreaterThanOrEqual(20);

    // The page must include the Yahoo brand text in some form.
    // Yahoo's logo is an `<svg>` mark plus alt text "ヤフー" or
    // "Yahoo!" depending on the rendered locale-bundle. Any of the
    // common Japanese top-page words appearing somewhere is enough
    // to claim the locale-aware text path is intact.
    const concatenated = texts.map((t) => t.characters).join(" / ");
    expect(/ニュース|Yahoo|天気|路線|ヤフオク/.test(concatenated)).toBe(true);

    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 180_000);
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
