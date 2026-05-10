/**
 * @file Public entry for the CLI internals — exported so other tools
 * can compose programmatic emission without going through argv.
 */
export { CliUsageError, parseArgs, USAGE } from "./args";
export type { CliMode, CliOptions } from "./args";
export { runCli } from "./run";
export type { CliConsole } from "./run";
