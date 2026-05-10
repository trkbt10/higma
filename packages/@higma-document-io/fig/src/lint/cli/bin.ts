#!/usr/bin/env bun
/**
 * @file Executable entry for `fig-lint`.
 *
 * Tiny shim: parse argv, run the CLI, translate the result into a
 * process exit code. All logic lives in `args.ts` and `run.ts` so
 * this file is safe to edit only for shebang/IO semantics.
 */

import { FIG_LINT_USAGE, FigLintUsageError, parseFigLintArgs, runFigLintCli } from ".";

async function main(): Promise<void> {
  const options = parseFigLintArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(FIG_LINT_USAGE);
    return;
  }
  const status = await runFigLintCli(options);
  process.exit(status);
}

main().catch((error: unknown) => {
  if (error instanceof FigLintUsageError) {
    process.stderr.write(`fig-lint: ${error.message}\n\n`);
    process.stderr.write(FIG_LINT_USAGE);
    process.exit(2);
  }
  if (error instanceof Error) {
    process.stderr.write(`fig-lint: ${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`fig-lint: unknown error\n`);
  process.exit(2);
});
