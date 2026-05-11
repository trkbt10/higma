#!/usr/bin/env bun
/**
 * @file Executable entry point for the fig-to-image CLI.
 *
 * Kept tiny — argv → options → runtime. All real logic lives in
 * `cli/run.ts` and the WebGL harness it delegates to.
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
  process.stderr.write(`fig-to-image: unknown error\n`);
  process.exit(1);
});
