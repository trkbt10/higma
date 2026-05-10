/**
 * @file Command-line argument parsing for `fig-lint`.
 *
 * The CLI is a thin wrapper around `runFigHealthCheck`. It accepts
 * one or more file paths plus optional `--format` and exit-policy
 * flags. Argument parsing is hand-rolled (no external dep) so the
 * binary stays compatible with any runtime that can execute the
 * shebang on `bin.ts`.
 */

import type { FigHealthFormat } from "../format";

export type FigLintExitPolicy = "errors" | "warnings" | "any";

export type FigLintCliOptions = {
  readonly inputs: readonly string[];
  readonly format: FigHealthFormat;
  readonly exitOn: FigLintExitPolicy;
  readonly help: boolean;
};

export const FIG_LINT_USAGE = `Usage: fig-lint [options] <file.fig> [more.fig ...]

Diagnose .fig files for corruption and Figma-import compatibility.

Options:
  --format <text|json>   Output format (default: text)
  --exit-on <errors|warnings|any>
                         Exit with non-zero status when findings of the
                         chosen severity (or worse) are present.
                         Default: errors.
  -h, --help             Show this help.
`;

/** Thrown when CLI arguments cannot be parsed. */
export class FigLintUsageError extends Error {}

function expectValue(flag: string, value: string | undefined): string {
  if (value === undefined) {
    throw new FigLintUsageError(`Missing value for ${flag}`);
  }
  return value;
}

function parseFormat(value: string): FigHealthFormat {
  if (value === "text" || value === "json") {
    return value;
  }
  throw new FigLintUsageError(`--format must be "text" or "json", got "${value}"`);
}

function parseExitOn(value: string): FigLintExitPolicy {
  if (value === "errors" || value === "warnings" || value === "any") {
    return value;
  }
  throw new FigLintUsageError(`--exit-on must be one of errors|warnings|any, got "${value}"`);
}

type ParseAccumulator = {
  readonly inputs: readonly string[];
  readonly format: FigHealthFormat;
  readonly exitOn: FigLintExitPolicy;
  readonly help: boolean;
  /** When > 0, the next `consume` call treats the token as a value, not a flag. */
  readonly skipNext: number;
  /** Pending flag awaiting its value (one of "--format" | "--exit-on" | null). */
  readonly pendingFlag: "--format" | "--exit-on" | null;
};

const INITIAL_ACC: ParseAccumulator = {
  inputs: [],
  format: "text",
  exitOn: "errors",
  help: false,
  skipNext: 0,
  pendingFlag: null,
};

function applyValue(acc: ParseAccumulator, flag: "--format" | "--exit-on", value: string): ParseAccumulator {
  if (flag === "--format") {
    return { ...acc, format: parseFormat(value), pendingFlag: null };
  }
  return { ...acc, exitOn: parseExitOn(value), pendingFlag: null };
}

function consume(acc: ParseAccumulator, token: string): ParseAccumulator {
  if (acc.pendingFlag) {
    return applyValue(acc, acc.pendingFlag, expectValue(acc.pendingFlag, token));
  }
  if (token === "-h" || token === "--help") {
    return { ...acc, help: true };
  }
  if (token === "--format") {
    return { ...acc, pendingFlag: "--format" };
  }
  if (token.startsWith("--format=")) {
    return applyValue(acc, "--format", token.slice("--format=".length));
  }
  if (token === "--exit-on") {
    return { ...acc, pendingFlag: "--exit-on" };
  }
  if (token.startsWith("--exit-on=")) {
    return applyValue(acc, "--exit-on", token.slice("--exit-on=".length));
  }
  if (token.startsWith("--")) {
    throw new FigLintUsageError(`Unknown option: ${token}`);
  }
  return { ...acc, inputs: [...acc.inputs, token] };
}

/** Parse `process.argv.slice(2)` into typed CLI options. */
export function parseFigLintArgs(argv: readonly string[]): FigLintCliOptions {
  const result = argv.reduce<ParseAccumulator>(consume, INITIAL_ACC);
  if (result.pendingFlag) {
    throw new FigLintUsageError(`Missing value for ${result.pendingFlag}`);
  }
  if (!result.help && result.inputs.length === 0) {
    throw new FigLintUsageError("At least one input file is required");
  }
  return {
    inputs: result.inputs,
    format: result.format,
    exitOn: result.exitOn,
    help: result.help,
  };
}
