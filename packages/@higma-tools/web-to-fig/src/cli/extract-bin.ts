#!/usr/bin/env bun
/**
 * @file Executable entry point for the `web-to-fig-extract` CLI.
 *
 * Parses argv, runs the extractor, maps usage / runtime errors onto
 * exit codes the shell can branch on:
 *   - `2` — usage error (printable banner)
 *   - `1` — runtime / unknown error
 */
import { CliUsageError } from "./args";
import { parseExtractArgs } from "./extract-args";
import { runExtractCli } from "./extract-run";

async function main(): Promise<void> {
  const options = parseExtractArgs(process.argv.slice(2));
  await runExtractCli(options);
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
  process.stderr.write(`web-to-fig-extract: unknown error\n`);
  process.exit(1);
});
