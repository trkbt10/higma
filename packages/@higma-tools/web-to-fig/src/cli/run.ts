/**
 * @file CLI runtime — orchestrates capture → normalize → emit.
 *
 * Lives outside the bin so it can be invoked programmatically from a
 * test harness (e.g. snapshotting against a known fixture page) or
 * from another tool that wants the same end-to-end behaviour.
 */
import { writeFile } from "node:fs/promises";
import { captureViewport } from "../web-source";
import { normalizeViewport } from "../normalize";
import type { FontResolver } from "../normalize";
import { emitFig } from "../emit";
import type { CliOptions } from "./args";

/**
 * End-to-end CLI runtime: capture → normalize → emit → write.
 *
 * `fontResolver` is required — the captured `font-family` values are
 * fallback stacks, and picking the first candidate verbatim
 * (`-apple-system`, `system-ui`, …) is what produces the per-glyph
 * yellow halo on the `example-com-fullpage` diff. The CLI's `bin.ts`
 * builds an OS-appropriate resolver and hands it over here.
 */
export async function runCli(options: CliOptions, fontResolver: FontResolver): Promise<void> {
  const captured = await captureViewport({
    url: options.url,
    viewport: options.viewport,
    devicePixelRatio: options.devicePixelRatio,
    waitUntil: options.waitUntil,
    timeoutMs: options.timeoutMs,
  });
  const ir = normalizeViewport(captured.snapshot, { fontResolver });
  const result = await emitFig(ir);
  await writeFile(options.outputPath, result.bytes);
  process.stdout.write(`Wrote ${result.bytes.length} bytes to ${options.outputPath}\n`);
}
