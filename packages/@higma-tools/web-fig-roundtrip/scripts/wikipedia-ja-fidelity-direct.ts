/**
 * @file ja.wikipedia.org article fidelity (fig direct render).
 *
 * Captures a Japanese Wikipedia article at mobile/tablet/desktop, builds
 * the multi-viewport `.fig`, then renders the `.fig` directly to PNG via
 * `@higma-document-renderers/fig`'s SVG pipeline (no fig-to-web in the
 * loop) and pixel-diffs each viewport against the original Playwright
 * screenshot. The diff isolates `web-to-fig` correctness on a content-
 * heavy CJK page that exercises long-form paragraph runs, infobox tables,
 * lists, footnotes, and inline `<a>` decorations — code paths that
 * neither example.com nor the YouTube home page exercise.
 *
 * The article URL is configurable via `WIKIPEDIA_ARTICLE` in the env
 * (default: 「メインページ」 — the homepage carries the same paragraph /
 * list / table mix as a typical article and renders deterministically
 * across captures).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_BREAKPOINTS,
  buildMultiFigFileBytes,
  captureMultiViewport,
  createHostFontResolver,
  normalizeViewport,
} from "@higma-tools/web-to-fig";
import { verifyFigDirect } from "@higma-tools/web-fig-roundtrip/verify";

const ARTICLE = process.env.WIKIPEDIA_ARTICLE ?? "メインページ";
const TARGET_URL = `https://ja.wikipedia.org/wiki/${encodeURIComponent(ARTICLE)}`;
// `encodeURIComponent` produces a filesystem-safe representation that
// keeps the article identity round-trippable. Stripping CJK to `_`
// would collapse different articles into the same output dir.
const SLUG = encodeURIComponent(ARTICLE);
const OUT_ROOT = `<REPO>/.tmp-output/wikipedia-ja-fidelity-direct/${SLUG}`;

async function main(): Promise<void> {
  process.stdout.write(`Capturing ${TARGET_URL} at mobile / tablet / desktop ...\n`);
  const captures = await captureMultiViewport({
    url: TARGET_URL,
    breakpoints: DEFAULT_BREAKPOINTS,
    // Wikipedia's MediaWiki frontend reaches `load` cleanly. Use the
    // default `domcontentloaded` to stay consistent with the YouTube
    // script — the readiness barrier in `waitForReady` then takes over.
    waitUntil: "domcontentloaded",
    captureScreenshot: true,
    timeoutMs: 30000,
  });
  for (const cap of captures) {
    process.stdout.write(
      `  ${cap.breakpoint.name}: ${cap.breakpoint.width}×${cap.breakpoint.height}, `
      + `screenshot=${cap.result.screenshotBytes?.byteLength ?? 0}B\n`,
    );
  }

  const fontResolver = createHostFontResolver();
  const viewports = captures.map((cap) =>
    normalizeViewport(cap.result.snapshot, { breakpoint: cap.breakpoint.name, fontResolver }),
  );
  const built = await buildMultiFigFileBytes({ source: TARGET_URL, viewports });
  process.stdout.write(`Wrote ${built.bytes.byteLength} bytes (.fig)\n`);

  await mkdir(OUT_ROOT, { recursive: true });
  await writeFile(join(OUT_ROOT, "wikipedia.fig"), built.bytes);

  process.stdout.write("Rendering .fig direct (SVG renderer) and pixel-diffing ...\n");
  const report = await verifyFigDirect(TARGET_URL, built.bytes, captures, { threshold: 0.1 });

  for (const r of report.results) {
    const dir = join(OUT_ROOT, r.breakpoint);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "screenshot.png"), r.actualScreenshot);
    await writeFile(join(dir, "rendered.png"), r.frame.png);
    if (r.comparison.kind === "compared") {
      await writeFile(join(dir, "diff.png"), r.comparison.diffPng);
      process.stdout.write(
        `  ${r.breakpoint}: ${r.comparison.width}×${r.comparison.height} — `
        + `${r.comparison.diffPixels} px diff (${r.comparison.diffPercent.toFixed(2)}%)\n`,
      );
    } else {
      process.stdout.write(
        `  ${r.breakpoint}: dimension mismatch — `
        + `actual ${r.comparison.actual.width}×${r.comparison.actual.height} vs `
        + `expected ${r.comparison.expected.width}×${r.comparison.expected.height}\n`,
      );
    }
  }

  process.stdout.write(`Output: ${OUT_ROOT}\n`);
}

main().then(() => process.exit(0), (err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
