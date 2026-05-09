#!/usr/bin/env bun
/**
 * @file Executable entry point for the web-to-fig CLI.
 *
 * Mirrors fig-to-web/cli/bin.ts: argv → options → runtime.
 */
import { CliUsageError, parseArgs, runCli } from ".";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runCli(options);
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
