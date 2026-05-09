/**
 * @file Argv parser for the web-to-fig CLI.
 *
 * The contract is intentionally rigid (`bun web-to-fig <url> <out>`):
 * extra options arrive as `--flag value` pairs and any unknown flag
 * throws. No defaults beyond what the task spec demands.
 */

/** Thrown for malformed CLI input. The CLI bin maps this to `process.exit(2)`. */
export class CliUsageError extends Error {}

export type CliOptions = {
  readonly url: string;
  readonly outputPath: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly waitUntil: "load" | "domcontentloaded" | "networkidle";
  readonly timeoutMs: number | undefined;
};

const USAGE = "Usage: web-to-fig <url> <out.fig> [--viewport WxH] [--dpr N] [--wait load|domcontentloaded|networkidle] [--timeout MS]";

type ParseState = {
  readonly positional: readonly string[];
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly waitUntil: CliOptions["waitUntil"];
  readonly timeoutMs: number | undefined;
  /** When >0, skip the next N tokens because they were consumed as a value. */
  readonly skip: number;
};

const INITIAL_STATE: ParseState = {
  positional: [],
  viewport: { width: 1280, height: 800 },
  devicePixelRatio: 1,
  waitUntil: "networkidle",
  timeoutMs: undefined,
  skip: 0,
};

/** Parse argv into a CliOptions, throwing CliUsageError on malformed input. */
export function parseArgs(argv: readonly string[]): CliOptions {
  if (argv.length < 2) {
    throw new CliUsageError(USAGE);
  }
  const final = argv.reduce<ParseState>((state, token, index) => {
    if (state.skip > 0) {
      return { ...state, skip: state.skip - 1 };
    }
    return applyToken(state, token, argv[index + 1]);
  }, INITIAL_STATE);

  if (final.positional.length !== 2) {
    throw new CliUsageError("expected exactly two positional arguments: <url> <out.fig>");
  }
  return {
    url: final.positional[0]!,
    outputPath: final.positional[1]!,
    viewport: final.viewport,
    devicePixelRatio: final.devicePixelRatio,
    waitUntil: final.waitUntil,
    timeoutMs: final.timeoutMs,
  };
}

function applyToken(state: ParseState, token: string, value: string | undefined): ParseState {
  if (!token.startsWith("--")) {
    return { ...state, positional: [...state.positional, token] };
  }
  switch (token) {
    case "--viewport":
      return { ...state, viewport: parseViewport(value), skip: 1 };
    case "--dpr":
      return { ...state, devicePixelRatio: parseDpr(value), skip: 1 };
    case "--wait":
      return { ...state, waitUntil: parseWait(value), skip: 1 };
    case "--timeout":
      return { ...state, timeoutMs: parseTimeout(value), skip: 1 };
    default:
      throw new CliUsageError(`Unknown flag "${token}"`);
  }
}

function parseViewport(value: string | undefined): { readonly width: number; readonly height: number } {
  if (!value) {
    throw new CliUsageError("--viewport requires a WxH value");
  }
  const [w, h] = value.split("x");
  if (!w || !h) {
    throw new CliUsageError(`--viewport must be WxH, got "${value}"`);
  }
  return { width: parseInt(w, 10), height: parseInt(h, 10) };
}

function parseDpr(value: string | undefined): number {
  if (!value) {
    throw new CliUsageError("--dpr requires a number");
  }
  return parseFloat(value);
}

function parseWait(value: string | undefined): CliOptions["waitUntil"] {
  if (value !== "load" && value !== "domcontentloaded" && value !== "networkidle") {
    throw new CliUsageError(`--wait must be load|domcontentloaded|networkidle, got "${value}"`);
  }
  return value;
}

function parseTimeout(value: string | undefined): number {
  if (!value) {
    throw new CliUsageError("--timeout requires a number");
  }
  return parseInt(value, 10);
}
