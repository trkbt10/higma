#!/usr/bin/env bun
/**
 * @file Regenerate WebGL reference PNGs for one or more fig-to-godot
 * fixtures, bypassing the fig-to-swiftui round-trip path.
 *
 * Usage:
 *
 *   bun run packages/@higma-tools/fig-to-godot/scripts/regen-refs.ts <case-name> [<case-name>...]
 *
 * The canonical path for reference regeneration is
 * `fig-to-swiftui/scripts/render-case.ts`, which runs the WebGL
 * harness AND the SwiftUI Swift toolchain to produce SwiftUI's
 * `actual.png` alongside the WebGL `reference.png`. That entry needs
 * `swift` on PATH and won't run if fig-to-swiftui's emit hits a
 * separate crash (e.g. the `NaN` serialisation bug on the autolayout
 * fixture as of this writing).
 *
 * This script only needs the WebGL half — load the `.fig`, render
 * every top-level frame via `renderFigFramesByName`, and write each
 * PNG under `cases/<case>/<frame>/reference.png`. The `cases/`
 * layout matches what `sync-references.ts` produces from the
 * fig-to-swiftui side, so downstream specs read the new bytes
 * without further wiring.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderFigFramesByName,
  startWebglHarness,
} from "@higma-tools/web-fig-roundtrip/verify";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const FIXTURES_ROOT = resolve(REPO_ROOT, "packages/@higma-document-renderers/fig/fixtures");
const CASES_ROOT = resolve(REPO_ROOT, "packages/@higma-tools/fig-to-godot/cases");

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write(
      "usage: bun run scripts/regen-refs.ts <case-name> [<case-name>...]\n",
    );
    process.exit(2);
  }
  const harness = await startWebglHarness();
  try {
    for (const caseName of argv) {
      const figPath = resolve(FIXTURES_ROOT, caseName, `${caseName}.fig`);
      const figBytes = new Uint8Array(await readFile(figPath));
      process.stdout.write(`=== ${caseName} ===\n`);
      const renders = await renderFigFramesByName(harness, figBytes, {});
      for (const r of renders) {
        const dir = resolve(CASES_ROOT, caseName, r.frame);
        await mkdir(dir, { recursive: true });
        await writeFile(resolve(dir, "reference.png"), r.png);
        process.stdout.write(`  ${r.frame} (${r.width}x${r.height})\n`);
      }
    }
  } finally {
    await harness.stop();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
