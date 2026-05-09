/**
 * @file Capture example.com at three breakpoints, write a multi-viewport
 * .fig, render that .fig back to PNG via the document-renderers
 * pipeline, and pixel-diff each PNG against the original Playwright
 * screenshot.
 *
 * Output is written to `.tmp-output/example-com-fidelity/<breakpoint>/`:
 *   - `screenshot.png`   — Playwright capture (the truth source)
 *   - `rendered.svg`     — emitted .fig rendered through renderFigToSvg
 *   - `rendered.png`     — the SVG rasterised via resvg
 *   - `diff.png`         — pixel-diff visualisation
 * Plus the bundle `.fig` at `.tmp-output/example-com-fidelity/example.fig`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_BREAKPOINTS,
  buildMultiFigFileBytes,
  captureMultiViewport,
  normalizeViewport,
  verifyFidelity,
} from "../src";

const OUT_ROOT = "<REPO>/.tmp-output/example-com-fidelity";

async function main(): Promise<void> {
  process.stdout.write("Capturing example.com at mobile / tablet / desktop ...\n");
  const captures = await captureMultiViewport({
    url: "https://example.com/",
    breakpoints: DEFAULT_BREAKPOINTS,
    waitUntil: "networkidle",
    captureScreenshot: true,
  });
  for (const cap of captures) {
    process.stdout.write(`  ${cap.breakpoint.name}: ${cap.breakpoint.width}×${cap.breakpoint.height}, screenshot=${cap.result.screenshotBytes?.byteLength ?? 0}B\n`);
  }

  const viewports = captures.map((cap) =>
    normalizeViewport(cap.result.snapshot, { breakpoint: cap.breakpoint.name }),
  );
  const built = await buildMultiFigFileBytes({ source: "https://example.com/", viewports });
  process.stdout.write(`Wrote ${built.bytes.byteLength} bytes (.fig)\n`);

  await mkdir(OUT_ROOT, { recursive: true });
  await writeFile(join(OUT_ROOT, "example.fig"), built.bytes);

  process.stdout.write("Rendering .fig back through document-renderers and pixel-diffing ...\n");
  const report = await verifyFidelity("https://example.com/", built.bytes, captures, {
    threshold: 0.1,
  });

  for (const r of report.results) {
    const breakpointDir = join(OUT_ROOT, r.breakpoint);
    await mkdir(breakpointDir, { recursive: true });
    await writeFile(join(breakpointDir, "screenshot.png"), r.actualScreenshot);
    await writeFile(join(breakpointDir, "rendered.svg"), r.frame.svg);
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

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
