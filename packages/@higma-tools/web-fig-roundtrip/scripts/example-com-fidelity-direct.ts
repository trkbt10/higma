/**
 * @file example.com fidelity (fig direct render).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_BREAKPOINTS,
  buildMultiFigFileBytes,
  captureMultiViewport,
  normalizeViewport,
} from "@higma-tools/web-to-fig";
import { verifyFigDirect } from "@higma-tools/web-fig-roundtrip/verify";

const TARGET_URL = "https://example.com/";
const OUT_ROOT = "<REPO>/.tmp-output/example-com-fidelity-direct";

async function main(): Promise<void> {
  process.stdout.write(`Capturing ${TARGET_URL} at mobile / tablet / desktop ...\n`);
  const captures = await captureMultiViewport({
    url: TARGET_URL,
    breakpoints: DEFAULT_BREAKPOINTS,
    captureScreenshot: true,
  });
  const viewports = captures.map((cap) => normalizeViewport(cap.result.snapshot, { breakpoint: cap.breakpoint.name }));
  const built = await buildMultiFigFileBytes({ source: TARGET_URL, viewports });
  await mkdir(OUT_ROOT, { recursive: true });
  await writeFile(join(OUT_ROOT, "example.fig"), built.bytes);
  process.stdout.write(`Wrote ${built.bytes.byteLength} bytes (.fig)\n`);

  process.stdout.write("Rendering .fig direct (SVG renderer) and pixel-diffing ...\n");
  const report = await verifyFigDirect(TARGET_URL, built.bytes, captures, { threshold: 0.1 });
  for (const r of report.results) {
    const dir = join(OUT_ROOT, r.breakpoint);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "screenshot.png"), r.actualScreenshot);
    await writeFile(join(dir, "rendered.png"), r.frame.png);
    if (r.comparison.kind === "compared") {
      await writeFile(join(dir, "diff.png"), r.comparison.diffPng);
      process.stdout.write(`  ${r.breakpoint}: ${r.comparison.diffPixels} px (${r.comparison.diffPercent.toFixed(2)}%)\n`);
    } else {
      process.stdout.write(`  ${r.breakpoint}: dim mismatch ${r.comparison.actual.width}x${r.comparison.actual.height} vs ${r.comparison.expected.width}x${r.comparison.expected.height}\n`);
    }
  }
  process.stdout.write(`Output: ${OUT_ROOT}\n`);
}

main().then(() => process.exit(0), (err) => { process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`); process.exit(1); });
