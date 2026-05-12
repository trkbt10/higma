/**
 * @file End-to-end fidelity script for ja.wikipedia.org.
 *
 * Same pipeline as `youtube-fidelity` but pointed at a Japanese
 * Wikipedia article — a content-heavy CJK page that exercises
 * paragraph wrapping, infobox tables, references, and inline anchor
 * decorations. The article slug is overridable via
 * `WIKIPEDIA_ARTICLE` (default: 「メインページ」).
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
import { verifyFidelity } from "@higma-tools/web-fig-roundtrip/verify";

const ARTICLE = process.env.WIKIPEDIA_ARTICLE ?? "メインページ";
const TARGET_URL = `https://ja.wikipedia.org/wiki/${encodeURIComponent(ARTICLE)}`;
// `encodeURIComponent` keeps the article identity round-trippable as a
// filesystem-safe string; stripping CJK would collapse distinct
// articles into a single `_` dir.
const SLUG = encodeURIComponent(ARTICLE);
const OUT_ROOT = `<REPO>/.tmp-output/wikipedia-ja-fidelity/${SLUG}`;

async function main(): Promise<void> {
  process.stdout.write(`Capturing ${TARGET_URL} at mobile / tablet / desktop ...\n`);
  const captures = await captureMultiViewport({
    url: TARGET_URL,
    breakpoints: DEFAULT_BREAKPOINTS,
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

  process.stdout.write("Rendering .fig through fig-to-web and pixel-diffing ...\n");
  const report = await verifyFidelity(TARGET_URL, built.bytes, captures, {
    threshold: 0.1,
  });

  for (const r of report.results) {
    const breakpointDir = join(OUT_ROOT, r.breakpoint);
    await mkdir(breakpointDir, { recursive: true });
    await writeFile(join(breakpointDir, "screenshot.png"), r.actualScreenshot);
    await writeFile(join(breakpointDir, "rendered.png"), r.frame.png);
    if (r.comparison.kind === "compared") {
      await writeFile(join(breakpointDir, "diff.png"), r.comparison.diffPng);
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
