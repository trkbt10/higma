/**
 * @file Public entry for the `fig-lint` CLI internals.
 *
 * Other tools may compose argv parsing + runtime without going
 * through the binary shebang.
 */

export {
  FIG_LINT_USAGE,
  FigLintUsageError,
  parseFigLintArgs,
  type FigLintCliOptions,
  type FigLintExitPolicy,
} from "./args";
export { runFigLintCli, type FigLintConsole } from "./run";
