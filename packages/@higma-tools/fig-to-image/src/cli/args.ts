/**
 * @file Argument parsing for the fig-to-image CLI.
 *
 *   fig-to-image --input <path-to-.fig> --out <dir>
 *                [--page <canvas-name>]
 *                [--frame <name>] (repeatable)
 *                [--all]
 *                [--symbols]
 *                [--scale <N>]
 *                [--force]
 *                [--filename <pattern>]
 *                [--list]
 *
 * Behaviour:
 *
 *   - Yields one PNG per top-level FRAME (a "Variant Set" is a FRAME
 *     with variant metadata; the canonical schema has no COMPONENT or
 *     COMPONENT_SET NodeType — see
 *     `docs/refactor/component-type-cleanup.md`) on the matched
 *     page(s), with optional SYMBOL inclusion via `--symbols`.
 *   - Embeds a fingerprint of the source subtree into the output
 *     PNG's `tEXt` chunk. Re-running the CLI on the same fig
 *     short-circuits any frame whose fingerprint matches the
 *     on-disk PNG — no harness startup unless something changed
 *     or `--force` is set.
 *
 * Format note: the only currently-supported output format is PNG.
 * The name `fig-to-image` (not `fig-to-png`) leaves room for SVG
 * / JPEG / WebP exporters once the SoT renderers can emit them;
 * the CLI surface here doesn't pre-commit to PNG-specific flags.
 */

export type CliMode = "all" | "frames" | "list";

export type CliOptions = {
  readonly input: string;
  readonly out: string;
  /** Canvas/page name to scan. When undefined, every page is included. */
  readonly page?: string;
  readonly mode: CliMode;
  /** Frame / symbol names to rasterise (used when mode is "frames"). */
  readonly frames: readonly string[];
  /** Include SYMBOL nodes alongside top-level FRAME targets. */
  readonly includeSymbols: boolean;
  /**
   * Output pixel ratio. 1 = authored size. 2 = @2x super-sampled.
   * The renderer paints into a physical canvas buffer scaled by
   * this value; the resulting PNG carries `width * scale` pixels.
   */
  readonly scale: number;
  /**
   * Filename template. Supports the `{name}` placeholder which is
   * replaced with the node's slugified name. Defaults to
   * `{name}.png`.
   */
  readonly filename: string;
  /**
   * Force re-rasterisation even when the on-disk PNG's embedded
   * fingerprint still matches the source subtree. Defaults to
   * false — the typical run reuses unchanged PNGs.
   */
  readonly force: boolean;
  /**
   * Background colour. Default is fully transparent
   * (`{r:0, g:0, b:0, a:0}`) — fig-to-image's job is to emit
   * composable sprites, so the renderer must not pre-paint the
   * authored-canvas regions outside the node (e.g. a rounded
   * card's transparent corners) with a fill colour. Pass
   * `--background white` (alias for `{r:1, g:1, b:1, a:1}`) when
   * comparing against the legacy fidelity harness output.
   */
  readonly background: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
};

const USAGE = [
  "fig-to-image --input <fig-file> --out <dir> [options]",
  "",
  "Options:",
  "  --input <path>          Source .fig file (required)",
  "  --out <dir>             Output directory (required unless --list)",
  "  --page <name>           Page name to scan. Default: every page",
  "  --frame <name>          Frame name to rasterise. Repeatable.",
  "  --all                   Rasterise every top-level frame (default)",
  "  --symbols               Also include SYMBOL nodes",
  "  --scale <N>             Output pixel ratio (1 = authored; 2 = @2x). Default 1",
  "  --filename <pattern>    Output filename pattern with {name} placeholder. Default `{name}.png`",
  "  --force                 Re-rasterise even when the on-disk PNG fingerprint matches",
  "  --background <name>     Canvas background. `transparent` (default) | `white`",
  "  --list                  List candidate frame names under --page and exit",
  "  -h, --help              Show this banner",
].join("\n");

/**
 * Thrown when the CLI receives argv it cannot interpret. The
 * `message` is composed with the full `USAGE` banner so the
 * binary entry point can print a single string and exit; the
 * dedicated subclass lets the entry point pick a distinct
 * (non-zero, but non-internal-error) exit code.
 */
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
  frames: string[];
  all?: boolean;
  list?: boolean;
  symbols?: boolean;
  scale?: number;
  filename?: string;
  force?: boolean;
  background?: CliOptions["background"];
  help?: boolean;
};

const BACKGROUND_PRESETS: Record<string, CliOptions["background"]> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

function parseBackground(raw: string): CliOptions["background"] {
  const preset = BACKGROUND_PRESETS[raw.toLowerCase()];
  if (!preset) {
    throw new CliUsageError(
      `--background expects one of "transparent" / "white" / "black", got "${raw}"`,
    );
  }
  return preset;
}

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
      return stepArgs(argv, i + 2, { ...acc, frames: [...acc.frames, expectValue("--frame", argv[i + 1])] });
    case "--all":
      return stepArgs(argv, i + 1, { ...acc, all: true });
    case "--symbols":
      return stepArgs(argv, i + 1, { ...acc, symbols: true });
    case "--scale": {
      const raw = expectValue("--scale", argv[i + 1]);
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new CliUsageError(`--scale expects a positive number, got "${raw}"`);
      }
      return stepArgs(argv, i + 2, { ...acc, scale: value });
    }
    case "--filename":
      return stepArgs(argv, i + 2, { ...acc, filename: expectValue("--filename", argv[i + 1]) });
    case "--force":
      return stepArgs(argv, i + 1, { ...acc, force: true });
    case "--background":
      return stepArgs(argv, i + 2, {
        ...acc,
        background: parseBackground(expectValue("--background", argv[i + 1])),
      });
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
  if (acc.frames.length > 0) {
    return "frames";
  }
  return "all";
}

/**
 * Pure argv parser — no IO, easy to unit-test. Returns a fully
 * resolved `CliOptions` value with defaults applied; throws
 * `CliUsageError` on any malformed input so the binary entry
 * point can print the usage banner and exit cleanly.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  const accumulated = stepArgs(argv, 0, { frames: [] });
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
    page: accumulated.page,
    mode,
    frames: accumulated.frames,
    includeSymbols: accumulated.symbols === true,
    scale: accumulated.scale ?? 1,
    filename: accumulated.filename ?? "{name}.png",
    force: accumulated.force === true,
    background: accumulated.background ?? BACKGROUND_PRESETS.transparent!,
  };
}

export { CliUsageError, USAGE };
