/**
 * @file CLI public exports — argv parsing and runtime entry.
 */
export type { CliOptions } from "./args";
export { CliUsageError, parseArgs } from "./args";
export { runCli } from "./run";
