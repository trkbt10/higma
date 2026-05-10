/**
 * @file Argument parsing for the fig-to-swiftui CLI.
 *
 *   fig-to-swiftui --input <path-to-.fig> --out <dir>
 *                  [--page <canvas-name>]
 *                  [--frame <frame-name> | --all]
 *                  [--list]
 *
 * Defaults:
 *   --page  defaults to "Design" (the page name fig-to-web also targets)
 *   --all   is the default selector when neither --frame nor --list is given
 */

export type CliMode = "all" | "single" | "list";

export type CliOptions = {
  readonly input: string;
  readonly out: string;
  readonly page: string;
  readonly mode: CliMode;
  readonly frame?: string;
};

const USAGE = [
  "fig-to-swiftui --input <fig-file> --out <dir> [options]",
  "",
  "Options:",
  "  --input <path>      Source .fig file (required)",
  "  --out <dir>         Output directory for generated Swift files (required unless --list)",
  "  --page <name>       Canvas/page name to scan. Default: Design",
  "  --frame <name>      Emit just this top-level frame",
  "  --all               Emit every top-level frame (default when no --frame)",
  "  --list              List the candidate frames under --page and exit",
  "  -h, --help          Show this banner",
].join("\n");

/** Thrown when the CLI receives an argument it cannot interpret. */
class CliUsageError extends Error {
  constructor(message: string) {
    super(`${message}\n\n${USAGE}`);
    this.name = "CliUsageError";
  }
}

function expectValue(name: string, value: string | undefined): string {
  if (value === undefined) {
    throw new CliUsageError(`Missing value for ${name}`);
  }
  return value;
}

type Accumulator = {
  input?: string;
  out?: string;
  page?: string;
  frame?: string;
  all?: boolean;
  list?: boolean;
  help?: boolean;
};

function stepArgs(argv: readonly string[], i: number, acc: Accumulator): Accumulator {
  if (i >= argv.length) {
    return acc;
  }
  const token = argv[i];
  if (token === undefined) {
    return acc;
  }
  switch (token) {
    case "-h":
    case "--help":
      return stepArgs(argv, i + 1, { ...acc, help: true });
    case "--input":
      return stepArgs(argv, i + 2, { ...acc, input: expectValue("--input", argv[i + 1]) });
    case "--out":
      return stepArgs(argv, i + 2, { ...acc, out: expectValue("--out", argv[i + 1]) });
    case "--page":
      return stepArgs(argv, i + 2, { ...acc, page: expectValue("--page", argv[i + 1]) });
    case "--frame":
      return stepArgs(argv, i + 2, { ...acc, frame: expectValue("--frame", argv[i + 1]) });
    case "--all":
      return stepArgs(argv, i + 1, { ...acc, all: true });
    case "--list":
      return stepArgs(argv, i + 1, { ...acc, list: true });
    default:
      throw new CliUsageError(`Unknown argument: ${token}`);
  }
}

function pickMode(acc: Accumulator): CliMode {
  if (acc.list) {
    return "list";
  }
  if (acc.frame) {
    return "single";
  }
  return "all";
}

/** Pure argv parser — no IO, easy to unit-test. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const accumulated = stepArgs(argv, 0, {});
  if (accumulated.help) {
    throw new CliUsageError("Usage:");
  }
  if (!accumulated.input) {
    throw new CliUsageError("--input <path> is required");
  }
  if (!accumulated.out && !accumulated.list) {
    throw new CliUsageError("--out <dir> is required (omit only when using --list)");
  }
  const mode = pickMode(accumulated);
  return {
    input: accumulated.input,
    out: accumulated.out ?? "",
    page: accumulated.page ?? "Design",
    mode,
    frame: accumulated.frame,
  };
}

export { CliUsageError, USAGE };
