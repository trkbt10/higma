/**
 * @file Argument parsing for the fig-to-web CLI.
 *
 *   fig-to-web --input <path-to-.fig> --out <dir>
 *              [--page <canvas-name>]
 *              [--frame <frame-name> | --all]
 *              [--list]
 *              [--serve [--port <number>]]
 *              [--no-bundle]
 *
 * Defaults:
 *   --page  defaults to "Design" (the page name the request targets)
 *   --all   is the default selector when neither --frame nor --list is given
 *   --port  defaults to 5173 when --serve is set
 *
 * The CLI bundles `main.tsx` → `main.js` after writing files so that
 * the resulting directory is browser-runnable from any static server.
 * `--no-bundle` skips the bundle step (useful when the output is
 * consumed by another build pipeline).
 */

export type CliOptions = {
  readonly input: string;
  readonly out: string;
  readonly page: string;
  readonly mode: "all" | "single" | "list";
  readonly frame?: string;
  readonly serve: boolean;
  readonly port: number;
  readonly bundle: boolean;
  readonly debugAttrs: boolean;
};

const USAGE = [
  "fig-to-web --input <fig-file> --out <dir> [options]",
  "",
  "Options:",
  "  --input <path>      Source .fig file (required)",
  "  --out <dir>         Output directory for generated TSX/CSS (required unless --list)",
  "  --page <name>       Canvas/page name to scan. Default: Design",
  "  --frame <name>      Emit just this top-level frame",
  "  --all               Emit every top-level frame (default when no --frame)",
  "  --list              List the candidate frames under --page and exit",
  "  --serve             Start a static HTTP server on the output after writing",
  "  --port <number>     Port for --serve (default: 5173)",
  "  --no-bundle         Skip bundling main.tsx → main.js (browser preview will not run)",
  "  --debug-attrs       Emit data-fig-name / data-fig-type attrs on every node (default: off)",
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

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n >= 65536) {
    throw new CliUsageError(`--port must be a positive integer, got "${raw}"`);
  }
  return n;
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
    serve: accumulated.serve === true,
    port: accumulated.port ?? 5173,
    bundle: accumulated.bundle !== false,
    debugAttrs: accumulated.debugAttrs === true,
  };
}

type Accumulator = {
  input?: string;
  out?: string;
  page?: string;
  frame?: string;
  all?: boolean;
  list?: boolean;
  help?: boolean;
  serve?: boolean;
  port?: number;
  bundle?: boolean;
  debugAttrs?: boolean;
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
    case "--serve":
      return stepArgs(argv, i + 1, { ...acc, serve: true });
    case "--port":
      return stepArgs(argv, i + 2, { ...acc, port: parsePort(expectValue("--port", argv[i + 1])) });
    case "--no-bundle":
      return stepArgs(argv, i + 1, { ...acc, bundle: false });
    case "--debug-attrs":
      return stepArgs(argv, i + 1, { ...acc, debugAttrs: true });
    default:
      throw new CliUsageError(`Unknown argument: ${token}`);
  }
}

function pickMode(acc: Accumulator): "all" | "single" | "list" {
  if (acc.list) {
    return "list";
  }
  if (acc.frame) {
    return "single";
  }
  return "all";
}

export { CliUsageError, USAGE };
