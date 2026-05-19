#!/usr/bin/env bun
/**
 * @file Executable entry point for the fig-to-swiftui CLI.
 *
 * Kept tiny — argv → options → runtime. All real logic lives in
 * `cli/run.ts` and the modules it composes.
 *
 * The rasteriser closure is wired here rather than inside `runCli`
 * to keep the library code (`src/cli/run.ts`) free of the heavy
 * `@higma-tools/web-fig-roundtrip` dependency. The closure is a
 * lazy entry: if the user's options ask for rasterisation, this
 * `bin.ts` is the only entry point that will dynamic-import the
 * harness, spin it up, render the requested nodes, tear it down.
 */
import { CliUsageError, parseArgs, runCli, type Rasterizer } from ".";

/**
 * Build a rasteriser backed by the WebGL harness — `startWebglHarness`
 * + `renderFigNodes`. Returns `undefined` when the user disabled
 * rasterisation (`--rasterize-threshold 0`) so the CLI can skip the
 * heavyweight import entirely.
 */
async function makeRasterizer(threshold: number): Promise<Rasterizer | undefined> {
  if (threshold <= 0) {
    return undefined;
  }
  // Dynamic import is intentional: the WebGL harness pulls in
  // puppeteer + vite + Chromium download (~250 MB) and takes
  // ~2 s to load even cached. Keeping it behind a runtime branch
  // means `--list` and `--rasterize-threshold 0` invocations stay
  // snappy and don't pay for what they don't use.
  // eslint-disable-next-line no-restricted-syntax -- intentional lazy import; harness loading is the heaviest dep
  const verify = await import("@higma-tools/web-fig-roundtrip/verify");
  return async (figBytes, targets) => {
    const harness = await verify.startWebglHarness();
    try {
      const rendered = await verify.renderFigNodes(
        harness,
        figBytes,
        targets.map((t) => ({ key: t.key, width: t.width, height: t.height })),
      );
      return rendered.map((r) => ({ key: r.key, png: r.png }));
    } finally {
      await harness.stop();
    }
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rasterizer = await makeRasterizer(options.rasterizeThreshold);
  await runCli(options, undefined, rasterizer);
}

main().catch((error: unknown) => {
  if (error instanceof CliUsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`fig-to-swiftui: unknown error\n`);
  process.exit(1);
});
