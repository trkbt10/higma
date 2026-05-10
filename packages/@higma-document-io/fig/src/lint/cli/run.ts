/**
 * @file `fig-lint` CLI runtime.
 *
 * Reads each input file, runs the health check, formats the report,
 * and aggregates exit status across all files. The console
 * dependency is injected so tests can capture output without
 * touching `process.std*`.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runFigHealthCheck } from "../health-check";
import { formatFigHealthReport } from "../format";
import type { FigHealthReport } from "../types";
import type { FigLintCliOptions, FigLintExitPolicy } from "./args";

export type FigLintConsole = {
  readonly info: (message: string) => void;
  readonly error: (message: string) => void;
};

const DEFAULT_CONSOLE: FigLintConsole = {
  info: (message) => process.stdout.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`),
};

function shouldFail(report: FigHealthReport, policy: FigLintExitPolicy): boolean {
  if (policy === "any") {
    return report.findings.length > 0;
  }
  if (policy === "warnings") {
    return report.summary.errors > 0 || report.summary.warnings > 0;
  }
  return report.summary.errors > 0;
}

async function lintOne(input: string, options: FigLintCliOptions, output: FigLintConsole): Promise<boolean> {
  const absolute = resolve(input);
  const buffer = await readFile(absolute);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const report = await runFigHealthCheck(bytes);
  const rendered = formatFigHealthReport(report, { inputLabel: input, format: options.format });
  output.info(rendered);
  return shouldFail(report, options.exitOn);
}

async function lintInSequence(options: FigLintCliOptions, output: FigLintConsole): Promise<readonly boolean[]> {
  return options.inputs.reduce<Promise<readonly boolean[]>>(async (accPromise, input) => {
    const acc = await accPromise;
    const failed = await lintOne(input, options, output);
    return [...acc, failed];
  }, Promise.resolve([] as readonly boolean[]));
}

/**
 * Run the CLI for the supplied options. Returns the desired exit
 * status (0 = clean, 1 = lint failed, 2 = io/usage error). The
 * caller is responsible for translating the number into
 * `process.exit`.
 */
export async function runFigLintCli(options: FigLintCliOptions, output: FigLintConsole = DEFAULT_CONSOLE): Promise<number> {
  const results = await lintInSequence(options, output);
  return results.some((failed) => failed) ? 1 : 0;
}
