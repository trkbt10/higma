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
import { emitFig } from "../emit";
import type { CliOptions } from "./args";

/** End-to-end CLI runtime: capture → normalize → emit → write. */
export async function runCli(options: CliOptions): Promise<void> {
  const captured = await captureViewport({
    url: options.url,
    viewport: options.viewport,
    devicePixelRatio: options.devicePixelRatio,
    waitUntil: options.waitUntil,
    timeoutMs: options.timeoutMs,
  });
  const ir = normalizeViewport(captured.snapshot);
  const result = await emitFig(ir);
  await writeFile(options.outputPath, result.bytes);
  process.stdout.write(`Wrote ${result.bytes.length} bytes to ${options.outputPath}\n`);
}
