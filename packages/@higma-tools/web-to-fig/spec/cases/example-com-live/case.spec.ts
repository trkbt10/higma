/**
 * @file `example-com-live` case spec.
 *
 * Drives a byte-pinned snapshot of example.com's `body > div` content
 * card end-to-end through capture / normalize / emit. The classic
 * existing roundtrip spec uses a hand-rolled `RawViewportSnapshot`
 * mirroring the same page; this case complements it by going through
 * the actual Playwright capture path so we exercise the in-page
 * walker, computed-style read, and asset cache against a real DOM.
 *
 * Requires Playwright. Auto-skips when Playwright cannot launch.
 */
import { runHtmlCase } from "../run-html-case";

const FIXTURE_URL = new URL("./fixture.html", import.meta.url);

const playwrightAvailable = await canLaunchPlaywright();

describe.skipIf(!playwrightAvailable)("example-com-live case", () => {
  it("captures, normalises, and emits a `.fig` from the example.com card", async () => {
    const result = await runHtmlCase({
      fixture: FIXTURE_URL,
      viewport: { width: 1280, height: 800 },
      breakpoint: "desktop",
      dumpFigTo: new URL("./snapshot.fig", import.meta.url),
    });

    expect(result.provenance.sourceUrl).toBe("https://example.com/");
    expect(result.provenance.selector).toBe("body > div");

    expect(result.ir.source.startsWith("file://")).toBe(true);
    expect(result.ir.box.width).toBe(1280);
    expect(result.ir.root.kind).toBe("frame");
    if (result.ir.root.kind !== "frame") {
      throw new Error();
    }
    // example.com renders a single content card with three direct
    // children: <h1>, <p>, <p>. The captured subtree must surface
    // both the wrapper card and its children — a single empty frame
    // would mean the extractor lost the inner content.
    expect(result.ir.root.children.length).toBe(1);
    // Walk down the wrapper chain until we find a frame whose
    // children are the captured TEXT nodes (the actual content
    // card). The extractor places the captured subtree inside a
    // synthetic `<body>`, which adds one or two layers of pure-
    // wrapper frames depending on how the source page nests its own
    // wrappers. We don't pin the depth here — the spec is about
    // round-trip correctness, not the wrapper count, which is a
    // fixture-mechanics detail.
    const card = findFirstTextHostFrame(result.ir.root.children[0]!);
    if (card === undefined) {
      throw new Error("expected to find a text-bearing card frame");
    }
    expect(card.children.length).toBeGreaterThanOrEqual(3);

    // The first child is the `<h1>` headline. example.com hardwires
    // it to "Example Domain" — pinning the literal text is the
    // strongest possible regression assertion against the text
    // collapse path (paragraph-host detection, inline runs, etc.).
    const headline = card.children[0]!;
    if (headline.kind !== "text") {
      throw new Error("expected headline text");
    }
    expect(headline.characters).toBe("Example Domain");

    // `.fig` output sanity — non-empty bytes prove the emit pipeline
    // consumed the IR without throwing.
    expect(result.figBytes.byteLength).toBeGreaterThan(0);
  }, 60_000);
});

/**
 * Walk descending from `node` and return the first FRAME whose
 * direct children are TEXT nodes (i.e. a content card, not a
 * wrapper). Returns `undefined` when the subtree has no such frame
 * — the spec then fails with a clear "expected a text host" message
 * instead of silently passing on an empty pipeline.
 */
function findFirstTextHostFrame(node: import("@higma-bridges/web-fig").NodeIR):
  | import("@higma-bridges/web-fig").FrameNodeIR
  | undefined {
  if (node.kind !== "frame") {
    return undefined;
  }
  if (node.children.some((c) => c.kind === "text")) {
    return node;
  }
  for (const child of node.children) {
    const found = findFirstTextHostFrame(child);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

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
