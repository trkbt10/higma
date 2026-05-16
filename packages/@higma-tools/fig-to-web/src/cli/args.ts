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

/**
 * React component export shape selected by the `--export-style` CLI
 * flag. Mirrors `ExportStyle` from `emit/orchestrate.ts`; redeclared
 * here so the CLI module doesn't reach across the public API boundary
 * for a string-literal union it owns the surface for.
 */
export type CliExportStyle = "function-default" | "const-named";

/**
 * CSS strategy selected by the `--css-mode` CLI flag. Mirrors
 * `CssMode` from `emit/orchestrate.ts` for the same reason. The CLI
 * accepts only the strategies implemented today; passing an
 * unimplemented value is rejected here rather than reaching the
 * orchestrator's runtime guard so users see a precise CLI-shaped
 * error.
 */
export type CliCssMode = "inline" | "css-modules" | "external-css" | "tailwind";

/**
 * Stylesheet-import strategy when `--css-mode` is `external-css`.
 * Mirrors `CssImportStrategy` from `emit/orchestrate.ts`.
 */
export type CliCssImport = "direct" | "external";

/**
 * Variant Set emit strategy selected by the `--variant-strategy` CLI
 * flag. Mirrors `VariantStrategy` from `emit/orchestrate.ts`.
 */
export type CliVariantStrategy = "discriminated" | "exploded";

/**
 * Asset-output strategy for vector subtrees selected by the
 * `--asset-strategy` CLI flag. Mirrors `AssetStrategy` from
 * `emit/orchestrate.ts`.
 */
export type CliAssetStrategy = "inline" | "externalize-complex";

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
  readonly exportStyle: CliExportStyle;
  readonly cssMode: CliCssMode;
  readonly cssImport: CliCssImport;
  readonly variantStrategy: CliVariantStrategy;
  readonly assetStrategy: CliAssetStrategy;
  readonly assetComplexityThreshold: number;
};

const USAGE = [
  "fig-to-web --input <fig-file> --out <dir> [options]",
  "",
  "Options:",
  "  --input <path>           Source .fig file (required)",
  "  --out <dir>              Output directory for generated TSX/CSS (required unless --list)",
  "  --page <name>            Canvas/page name to scan. Default: Design",
  "  --frame <name>           Emit just this top-level frame",
  "  --all                    Emit every top-level frame (default when no --frame)",
  "  --list                   List the candidate frames under --page and exit",
  "  --serve                  Start a static HTTP server on the output after writing",
  "  --port <number>          Port for --serve (default: 5173)",
  "  --no-bundle              Skip bundling main.tsx → main.js (browser preview will not run)",
  "  --debug-attrs            Emit data-fig-name / data-fig-type attrs on every node (default: off)",
  "  --export-style <style>   React component export form: function-default (named + default export, default)",
  "                           or const-named (only `export const ComponentName = ...`).",
  "  --css-mode <mode>        CSS delivery strategy: inline (default), css-modules (each TSX gets a",
  "                           sibling .module.css), external-css (one global styles.css), or tailwind",
  "                           (className utility strings; consumer runs Tailwind's JIT).",
  "  --css-import <mode>      Stylesheet-import strategy for --css-mode external-css: direct (default,",
  "                           TSX emits `import \"./styles.css\";`) or external (consumer wires it up).",
  "  --variant-strategy <s>   Variant Set emit strategy: discriminated (default — one component, switch",
  "                           on variant prop) or exploded (one component per variant + a barrel).",
  "  --asset-strategy <s>     Vector subtree handling: inline (default) or externalize-complex",
  "                           (write subtrees above the complexity threshold to assets/icons/<slug>.svg).",
  "  --asset-threshold <N>    Complexity threshold for --asset-strategy externalize-complex (default: 200).",
  "  -h, --help               Show this banner",
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

function parseExportStyle(raw: string): CliExportStyle {
  if (raw === "function-default" || raw === "const-named") {
    return raw;
  }
  throw new CliUsageError(
    `--export-style must be one of "function-default" | "const-named", got "${raw}"`,
  );
}

function parseCssMode(raw: string): CliCssMode {
  if (raw === "inline" || raw === "css-modules" || raw === "external-css" || raw === "tailwind") {
    return raw;
  }
  throw new CliUsageError(
    `--css-mode must be one of "inline" | "css-modules" | "external-css" | "tailwind", got "${raw}"`,
  );
}

function parseCssImport(raw: string): CliCssImport {
  if (raw === "direct" || raw === "external") {
    return raw;
  }
  throw new CliUsageError(
    `--css-import must be one of "direct" | "external", got "${raw}"`,
  );
}

function parseVariantStrategy(raw: string): CliVariantStrategy {
  if (raw === "discriminated" || raw === "exploded") {
    return raw;
  }
  throw new CliUsageError(
    `--variant-strategy must be one of "discriminated" | "exploded", got "${raw}"`,
  );
}

function parseAssetStrategy(raw: string): CliAssetStrategy {
  if (raw === "inline" || raw === "externalize-complex") {
    return raw;
  }
  throw new CliUsageError(
    `--asset-strategy must be one of "inline" | "externalize-complex", got "${raw}"`,
  );
}

function parseAssetThreshold(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new CliUsageError(`--asset-threshold must be a non-negative finite number, got "${raw}"`);
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
    exportStyle: accumulated.exportStyle ?? "function-default",
    cssMode: accumulated.cssMode ?? "inline",
    cssImport: accumulated.cssImport ?? "direct",
    variantStrategy: accumulated.variantStrategy ?? "discriminated",
    assetStrategy: accumulated.assetStrategy ?? "inline",
    assetComplexityThreshold: accumulated.assetComplexityThreshold ?? 200,
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
  exportStyle?: CliExportStyle;
  cssMode?: CliCssMode;
  cssImport?: CliCssImport;
  variantStrategy?: CliVariantStrategy;
  assetStrategy?: CliAssetStrategy;
  assetComplexityThreshold?: number;
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
    case "--export-style":
      return stepArgs(argv, i + 2, {
        ...acc,
        exportStyle: parseExportStyle(expectValue("--export-style", argv[i + 1])),
      });
    case "--css-mode":
      return stepArgs(argv, i + 2, {
        ...acc,
        cssMode: parseCssMode(expectValue("--css-mode", argv[i + 1])),
      });
    case "--css-import":
      return stepArgs(argv, i + 2, {
        ...acc,
        cssImport: parseCssImport(expectValue("--css-import", argv[i + 1])),
      });
    case "--variant-strategy":
      return stepArgs(argv, i + 2, {
        ...acc,
        variantStrategy: parseVariantStrategy(expectValue("--variant-strategy", argv[i + 1])),
      });
    case "--asset-strategy":
      return stepArgs(argv, i + 2, {
        ...acc,
        assetStrategy: parseAssetStrategy(expectValue("--asset-strategy", argv[i + 1])),
      });
    case "--asset-threshold":
      return stepArgs(argv, i + 2, {
        ...acc,
        assetComplexityThreshold: parseAssetThreshold(expectValue("--asset-threshold", argv[i + 1])),
      });
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
