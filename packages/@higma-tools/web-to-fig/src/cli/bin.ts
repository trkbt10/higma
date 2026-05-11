#!/usr/bin/env bun
/**
 * @file Executable entry point for the web-to-fig CLI.
 *
 * Mirrors fig-to-web/cli/bin.ts: argv → options → runtime.
 *
 * The FontResolver picked here is the host-appropriate one — that
 * decision lives in `src/font-resolver/host.ts`, the single source
 * of truth for platform → resolver mapping. Re-implementing the
 * `process.platform` branch here would split that SoT.
 */
import { CliUsageError, parseArgs, runCli } from ".";
import { createHostFontResolver } from "../font-resolver/host";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runCli(options, createHostFontResolver());
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
  process.stderr.write(`web-to-fig: unknown error\n`);
  process.exit(1);
});
